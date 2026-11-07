import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import { createScheduleFromTransaction, listPayEvents, rederiveAll } from '../../src/server/budgets/pay-schedule'
import { createEngineHarness, type EngineHarness } from '../helpers/engine'

const TOKEN = 'up:yeah:owner'
const NOW = new Date('2026-10-29T00:00:00Z')
const daysAgo = (n: number, from = NOW) => new Date(from.getTime() - n * 86_400_000).toISOString()

let h: EngineHarness
let connId: string

const tx = (id: string, createdAt: string, extra: Partial<Parameters<EngineHarness['buildTransaction']>[0]> = {}) =>
  h.fake.addTransaction(h.buildTransaction({ id, accountId: 'acc-1', amountCents: -1000, createdAt, ...extra }))
const row = (id: string) => h.db.select().from(s.transactions).where(eq(s.transactions.id, id)).get()
const transactionRequests = () => h.fake.requests.filter((r) => r.url.pathname.endsWith('/transactions'))

beforeEach(async () => {
  h = createEngineHarness(NOW)
  h.addUser('u1')
  h.fake.addAccount(h.buildAccount({ id: 'acc-1', balanceCents: 5000 }))
  h.fake.addCustomer(TOKEN, ['acc-1'])
  tx('old', daysAgo(40))
  connId = (await h.engine.connect('u1', TOKEN)).id
  await h.engine.backfill(connId)
})

test('incremental fetches the last 3 days and refreshes balances', async () => {
  tx('new', daysAgo(1))
  h.fake.setBalance('acc-1', 4000)
  const before = transactionRequests().length
  const result = await h.engine.incremental(connId)
  expect(result).toMatchObject({ status: 'ok', upserted: 1 })
  expect(transactionRequests()[before].url.searchParams.get('filter[since]')).toBe('2026-10-26T00:00:00.000Z')
  expect(row('new')).toBeDefined()
  expect(h.db.select().from(s.accounts).get()?.balanceCents).toBe(4000)
})

test('re-checks old HELD transactions by id', async () => {
  tx('h1', daysAgo(10), { status: 'HELD' })
  tx('h2', daysAgo(10), { status: 'HELD' })
  await h.engine.reconcile(connId)
  h.fake.settle('h1', -4210)
  h.fake.remove('h2')
  const result = await h.engine.incremental(connId)
  expect(result).toMatchObject({ status: 'ok', deleted: 1 })
  expect(row('h1')).toMatchObject({ status: 'SETTLED', amountCents: -4210, deletedAt: null })
  expect(row('h2')?.deletedAt).toBe(NOW.toISOString())
})

test('refreshes the catalogue at most daily', async () => {
  const categoryRequests = () => h.fake.requests.filter((r) => r.url.pathname.endsWith('/categories')).length
  expect(categoryRequests()).toBe(1) // from connect
  h.setNow(new Date(NOW.getTime() + 3_600_000))
  await h.engine.incremental(connId)
  expect(categoryRequests()).toBe(1)
  h.setNow(new Date(NOW.getTime() + 25 * 3_600_000))
  await h.engine.incremental(connId)
  expect(categoryRequests()).toBe(2)
})

test('reconcile soft-deletes transactions missing from the 30-day window', async () => {
  tx('r1', daysAgo(5))
  tx('r2', daysAgo(5))
  await h.engine.reconcile(connId)
  h.fake.remove('r1')
  h.fake.remove('old')
  const result = await h.engine.reconcile(connId)
  expect(result).toMatchObject({ status: 'ok', deleted: 1 })
  expect(row('r1')?.deletedAt).toBe(NOW.toISOString())
  expect(row('r2')?.deletedAt).toBeNull()
  expect(row('old')?.deletedAt).toBeNull()
  expect(h.db.select().from(s.upConnections).get()?.lastReconciledAt).toBe(NOW.toISOString())
})

test('reconcile deletes nothing when a page fails', async () => {
  tx('r1', daysAgo(5))
  await h.engine.reconcile(connId)
  h.db.update(s.upConnections).set({ lastReconciledAt: null }).run()
  h.fake.remove('r1')
  h.fake.failNext(/transactions/, 500, 4)
  const result = await h.engine.reconcile(connId)
  expect(result).toMatchObject({ status: 'failed', deleted: 0 })
  expect(row('r1')?.deletedAt).toBeNull()
  expect(h.db.select().from(s.upConnections).get()?.lastReconciledAt).toBeNull()
})

test('reconcile prunes sync_runs older than 30 days', async () => {
  h.db.insert(s.syncRuns)
    .values({ id: 'ancient', connectionId: connId, kind: 'incremental', status: 'ok', startedAt: daysAgo(31) })
    .run()
  await h.engine.reconcile(connId)
  const ids = h.db.select().from(s.syncRuns).all().map((r) => r.id)
  expect(ids).not.toContain('ancient')
  expect(ids.length).toBeGreaterThan(0)
})

test('incremental marks unauthorized on 401', async () => {
  h.fake.revokeToken(TOKEN)
  const result = await h.engine.incremental(connId)
  expect(result.status).toBe('failed')
  expect(h.db.select().from(s.upConnections).get()?.status).toBe('unauthorized')
})

/** Same id, but Up now sends it in a shape our schema rejects (e.g. a renamed field). */
function malformed(id: string, createdAt: string, status: 'HELD' | 'SETTLED' = 'SETTLED') {
  const raw = structuredClone(h.buildTransaction({ id, accountId: 'acc-1', amountCents: -1000, createdAt, status })) as unknown as {
    attributes: Record<string, unknown>
  }
  delete raw.attributes.amount
  h.fake.addTransaction(raw as never)
}

test('reconcile does not delete transactions Up returned in a shape we could not parse', async () => {
  tx('r1', daysAgo(5))
  await h.engine.reconcile(connId)
  malformed('r1', daysAgo(5))
  const result = await h.engine.reconcile(connId)
  expect(result).toMatchObject({ status: 'ok', deleted: 0 })
  expect(row('r1')?.deletedAt).toBeNull()
})

test('a malformed stale hold does not fail the incremental', async () => {
  tx('h1', daysAgo(10), { status: 'HELD' })
  await h.engine.reconcile(connId)
  malformed('h1', daysAgo(10), 'HELD')
  const result = await h.engine.incremental(connId)
  expect(result.status).toBe('ok')
  expect(row('h1')).toMatchObject({ status: 'HELD', deletedAt: null })
  expect(h.db.select().from(s.upConnections).get()?.status).toBe('ok')
})

test('after weeks offline, incremental catches up from the last complete sync', async () => {
  // The PC was off for 40 days: a purchase 35 days ago is outside both the 3-day and 30-day windows.
  const later = new Date(NOW.getTime() + 40 * 86_400_000)
  h.setNow(later)
  tx('while-away', daysAgo(35, later))
  const before = transactionRequests().length
  expect(await h.engine.incremental(connId)).toMatchObject({ status: 'ok' })
  expect(row('while-away')).toBeDefined()
  // resumes a day before the last complete sync (the backfill at NOW)
  expect(transactionRequests()[before].url.searchParams.get('filter[since]')).toBe(daysAgo(1))
  // and the next run is back to the normal 3-day window
  const next = transactionRequests().length
  await h.engine.incremental(connId)
  expect(transactionRequests()[next].url.searchParams.get('filter[since]')).toBe(daysAgo(3, later))
})

test('a hold Up deleted inside the 3-day window is removed by the next incremental', async () => {
  tx('preauth', daysAgo(1), { status: 'HELD', amountCents: -15000 })
  await h.engine.incremental(connId)
  expect(row('preauth')?.deletedAt).toBeNull()
  h.fake.remove('preauth')
  const result = await h.engine.incremental(connId)
  expect(result).toMatchObject({ status: 'ok', deleted: 1 })
  expect(row('preauth')?.deletedAt).toBe(NOW.toISOString())
})

test('sync runs re-derive pay events', async () => {
  const tz = 'Australia/Sydney'
  const g = createEngineHarness(NOW, { afterRun: () => rederiveAll(g.db, g.now(), tz) })
  g.addUser('u1')
  g.fake.addAccount(g.buildAccount({ id: 'acc-1' }))
  g.fake.addCustomer(TOKEN, ['acc-1'])
  const pay = (id: string, createdAt: string) =>
    g.fake.addTransaction(g.buildTransaction({ id, accountId: 'acc-1', amountCents: 400000, createdAt, description: 'ACME PAY' }))
  pay('p1', '2026-10-15T09:00:00+11:00')
  const conn = await g.engine.connect('u1', TOKEN)
  await g.engine.backfill(conn.id)
  createScheduleFromTransaction(g.db, 'u1', 'p1', g.now(), tz)
  expect(listPayEvents(g.db, 'u1')).toHaveLength(1)

  pay('p2', '2026-10-29T09:00:00+11:00')
  expect(await g.engine.incremental(conn.id)).toMatchObject({ status: 'ok' })
  expect(listPayEvents(g.db, 'u1').map((e) => e.payDate)).toEqual(['2026-10-29', '2026-10-15'])
})

test("afterRun failures don't fail the sync", async () => {
  const g = createEngineHarness(NOW, {
    afterRun: () => {
      throw new Error('boom')
    },
  })
  g.addUser('u1')
  g.fake.addAccount(g.buildAccount({ id: 'acc-1' }))
  g.fake.addCustomer(TOKEN, ['acc-1'])
  const conn = await g.engine.connect('u1', TOKEN)
  expect(await g.engine.incremental(conn.id)).toMatchObject({ status: 'ok' })
})
