import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import type { Db } from '../../src/server/db/client'
import * as s from '../../src/server/db/schema'
import type { RunResult, SyncEngine } from '../../src/server/sync/engine'
import { createScheduler } from '../../src/server/sync/scheduler'
import { createTestDb } from '../helpers/db'
import { silentLogger } from '../helpers/engine'

type Kind = 'backfill' | 'incremental' | 'reconcile'
const ok: RunResult = { runId: 'r', status: 'ok', upserted: 0, deleted: 0 }

function stubEngine(opts: { manual?: boolean } = {}) {
  const calls: [string, Kind][] = []
  const pending: (() => void)[] = []
  const run = (kind: Kind) => (id: string) => {
    calls.push([id, kind])
    if (!opts.manual) return Promise.resolve(ok)
    return new Promise<RunResult>((resolve) => pending.push(() => resolve(ok)))
  }
  const engine = {
    connect: async () => {
      throw new Error('unused')
    },
    disconnect: () => {},
    backfill: run('backfill'),
    incremental: run('incremental'),
    reconcile: run('reconcile'),
  } as unknown as SyncEngine
  return { engine, calls, releaseAll: () => pending.splice(0).forEach((r) => r()) }
}

let db: Db
// 2026-10-28T16:30Z is 03:30 AEDT on 29 Oct in Australia/Sydney
const AT_RECONCILE_HOUR = new Date('2026-10-28T16:30:00Z')
const MIDDAY = new Date('2026-10-29T01:00:00Z')

function addConnection(id: string, values: Partial<typeof s.upConnections.$inferInsert> = {}) {
  db.insert(s.users).values({ id: `u-${id}`, username: id, displayName: id, passwordHash: 'x', createdAt: MIDDAY.toISOString() }).run()
  db.insert(s.upConnections)
    .values({
      id,
      userId: `u-${id}`,
      tokenCiphertext: 'v1:x',
      status: 'ok',
      createdAt: MIDDAY.toISOString(),
      backfillCompletedAt: MIDDAY.toISOString(),
      lastReconciledAt: MIDDAY.toISOString(),
      ...values,
    })
    .run()
}

function scheduler(engine: SyncEngine, now: Date) {
  return createScheduler({ db, engine, now: () => now, tz: 'Australia/Sydney', intervalMinutes: 5, reconcileHour: 3, logger: silentLogger })
}

beforeEach(() => {
  db = createTestDb()
})

test('single-flight: a second trigger while running is skipped', async () => {
  addConnection('c1')
  const stub = stubEngine({ manual: true })
  const sch = scheduler(stub.engine, MIDDAY)
  sch.trigger('c1', 'incremental')
  sch.trigger('c1', 'incremental')
  sch.trigger('c1', 'backfill')
  expect(stub.calls).toEqual([['c1', 'incremental']])
  stub.releaseAll()
})

test('runNow awaits an in-flight run instead of starting another', async () => {
  addConnection('c1')
  const stub = stubEngine({ manual: true })
  const sch = scheduler(stub.engine, MIDDAY)
  sch.trigger('c1', 'backfill')
  let done = false
  const p = sch.runNow().then(() => (done = true))
  await Promise.resolve()
  expect(done).toBe(false)
  stub.releaseAll()
  await p
  expect(stub.calls).toEqual([['c1', 'backfill']])
})

test('runNow runs incremental for every usable connection', async () => {
  addConnection('c1')
  addConnection('c2', { status: 'error' })
  addConnection('c3', { status: 'unauthorized' })
  const stub = stubEngine()
  await scheduler(stub.engine, MIDDAY).runNow()
  expect(stub.calls.sort()).toEqual([
    ['c1', 'incremental'],
    ['c2', 'incremental'],
  ])
})

test('tick skips unauthorized, retries errored and resumes incomplete backfills', async () => {
  addConnection('ok')
  addConnection('errored', { status: 'error' })
  addConnection('revoked', { status: 'unauthorized' })
  addConnection('partial', { backfillCompletedAt: null })
  const stub = stubEngine()
  await scheduler(stub.engine, MIDDAY).tick()
  expect(stub.calls.sort()).toEqual([
    ['errored', 'incremental'],
    ['ok', 'incremental'],
    ['partial', 'backfill'],
  ])
})

test('reconciles at RECONCILE_HOUR local time once per day', async () => {
  addConnection('due', { lastReconciledAt: new Date(AT_RECONCILE_HOUR.getTime() - 21 * 3_600_000).toISOString() })
  addConnection('fresh', { lastReconciledAt: new Date(AT_RECONCILE_HOUR.getTime() - 2 * 3_600_000).toISOString() })
  const stub = stubEngine()
  await scheduler(stub.engine, AT_RECONCILE_HOUR).tick()
  expect(stub.calls.filter(([, k]) => k === 'reconcile')).toEqual([['due', 'reconcile']])
  stub.calls.length = 0
  db.update(s.upConnections).set({ lastReconciledAt: null }).where(eq(s.upConnections.id, 'fresh')).run()
  await scheduler(stub.engine, MIDDAY).tick()
  expect(stub.calls.filter(([, k]) => k === 'reconcile')).toEqual([])
})

test('startup resumes backfill, catches up a missed reconcile and fails stale runs', async () => {
  addConnection('partial', { backfillCompletedAt: null })
  addConnection('stale', { lastReconciledAt: new Date(MIDDAY.getTime() - 25 * 3_600_000).toISOString() })
  addConnection('current')
  db.insert(s.syncRuns).values({ id: 'zombie', connectionId: 'current', kind: 'incremental', status: 'running', startedAt: MIDDAY.toISOString() }).run()
  const stub = stubEngine()
  await scheduler(stub.engine, MIDDAY).startup()
  expect(stub.calls.sort()).toEqual([
    ['partial', 'backfill'],
    ['stale', 'reconcile'],
  ])
  expect(db.select().from(s.syncRuns).where(eq(s.syncRuns.id, 'zombie')).get()).toMatchObject({
    status: 'failed',
    error: 'Interrupted by restart',
  })
})

test('daily task runs on the first tick of each local day, even with no usable connection', async () => {
  addConnection('c1', { status: 'unauthorized' })
  const stub = stubEngine()
  let now = MIDDAY
  const runs: string[] = []
  const sch = createScheduler({
    db,
    engine: stub.engine,
    now: () => now,
    tz: 'Australia/Sydney',
    intervalMinutes: 5,
    reconcileHour: 3,
    logger: silentLogger,
    daily: () => runs.push(now.toISOString()),
  })
  await sch.tick()
  now = new Date(MIDDAY.getTime() + 3_600_000)
  await sch.tick()
  expect(runs).toHaveLength(1)
  now = new Date(MIDDAY.getTime() + 24 * 3_600_000)
  await sch.tick()
  expect(runs).toHaveLength(2)
  expect(stub.calls).toEqual([])
})
