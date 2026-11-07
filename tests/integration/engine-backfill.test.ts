import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import { pickConnectionForAccount } from '../../src/server/sync/connections'
import { UpUnauthorizedError } from '../../src/server/up/errors'
import { createEngineHarness, type EngineHarness } from '../helpers/engine'

const TOKEN = 'up:yeah:owner'
let h: EngineHarness

beforeEach(() => {
  h = createEngineHarness()
  h.addUser('u1')
  h.fake.addAccount(h.buildAccount({ id: 'acc-1', balanceCents: 12345 }))
  h.fake.addCustomer(TOKEN, ['acc-1'])
})

const txCount = () => h.db.select().from(s.transactions).all().length
const runs = () => h.db.select().from(s.syncRuns).all()

test('connect rejects a bad token and stores nothing', async () => {
  await expect(h.engine.connect('u1', 'up:yeah:wrong')).rejects.toBeInstanceOf(UpUnauthorizedError)
  expect(h.db.select().from(s.upConnections).all()).toEqual([])
})

test('connect stores an encrypted token and the catalogue', async () => {
  const conn = await h.engine.connect('u1', TOKEN)
  expect(conn).toMatchObject({ userId: 'u1', status: 'ok', lastError: null })
  expect(conn.tokenCiphertext).not.toContain(TOKEN)
  expect(h.secrets.decrypt(conn.tokenCiphertext)).toBe(TOKEN)
  expect(h.db.select().from(s.categories).all().length).toBeGreaterThan(0)
  expect(h.db.select().from(s.accounts).get()).toMatchObject({ id: 'acc-1', balanceCents: 12345, ownerUserId: 'u1' })
  expect(runs()).toMatchObject([{ kind: 'connect', status: 'ok' }])
})

test('reconnecting replaces the token on the same connection', async () => {
  const first = await h.engine.connect('u1', TOKEN)
  h.fake.addCustomer('up:yeah:new', ['acc-1'])
  const second = await h.engine.connect('u1', 'up:yeah:new')
  expect(second.id).toBe(first.id)
  expect(h.secrets.decrypt(second.tokenCiphertext)).toBe('up:yeah:new')
})

test('backfill imports all pages with progress', async () => {
  h.addDailyTransactions('acc-1', 250)
  const conn = await h.engine.connect('u1', TOKEN)
  const result = await h.engine.backfill(conn.id)
  expect(result).toMatchObject({ status: 'ok', upserted: 250, deleted: 0 })
  expect(txCount()).toBe(250)
  const run = runs().find((r) => r.id === result.runId)
  expect(run).toMatchObject({ kind: 'backfill', status: 'ok', transactionsUpserted: 250 })
  const after = h.db.select().from(s.upConnections).get()
  expect(after?.backfillCompletedAt).toBe(h.now().toISOString())
  expect(after?.lastSyncedAt).toBe(h.now().toISOString())
})

test('backfill resumes after an interruption', async () => {
  h.addDailyTransactions('acc-1', 250)
  const conn = await h.engine.connect('u1', TOKEN)
  h.fake.failNext(/transactions.*page\[after\]/, 500, 4)
  const failed = await h.engine.backfill(conn.id)
  expect(failed.status).toBe('failed')
  expect(txCount()).toBe(100)
  expect(h.db.select().from(s.upConnections).get()?.backfillCompletedAt).toBeNull()

  const requestsBefore = h.fake.requests.length
  const resumed = await h.engine.backfill(conn.id)
  expect(resumed.status).toBe('ok')
  expect(txCount()).toBe(250)
  const firstResumeRequest = h.fake.requests.slice(requestsBefore).find((r) => r.url.pathname.endsWith('/transactions'))
  // newest page held t249..t150, so the resume point is t150's createdAt
  expect(firstResumeRequest?.url.searchParams.get('filter[until]')).toBe(new Date(Date.parse('2026-01-01T00:00:00Z') + 150 * 86_400_000).toISOString())
})

test('refreshes accounts when a page references an unknown account', async () => {
  const conn = await h.engine.connect('u1', TOKEN)
  h.fake.addAccount(h.buildAccount({ id: 'acc-2', accountType: 'SAVER' }))
  h.fake.addCustomer(TOKEN, ['acc-2'])
  h.addDailyTransactions('acc-2', 3, '2026-05-01T00:00:00Z', 's')
  const result = await h.engine.backfill(conn.id)
  expect(result).toMatchObject({ status: 'ok', upserted: 3 })
  expect(h.db.select().from(s.accounts).where(eq(s.accounts.id, 'acc-2')).get()?.accountType).toBe('SAVER')
})

test('joint transactions from two connections are not duplicated', async () => {
  h.addUser('u2')
  h.fake.addAccount(h.buildAccount({ id: 'acc-2' }))
  h.fake.addAccount(h.buildAccount({ id: 'acc-j', ownershipType: 'JOINT' }))
  h.fake.addCustomer(TOKEN, ['acc-j'])
  h.fake.addCustomer('up:yeah:partner', ['acc-2', 'acc-j'])
  h.addDailyTransactions('acc-1', 5, '2026-01-01T00:00:00Z', 'a')
  h.addDailyTransactions('acc-2', 5, '2026-01-01T00:00:00Z', 'b')
  h.addDailyTransactions('acc-j', 5, '2026-01-01T00:00:00Z', 'j')

  const a = await h.engine.connect('u1', TOKEN)
  await h.engine.backfill(a.id)
  expect(txCount()).toBe(10)
  const b = await h.engine.connect('u2', 'up:yeah:partner')
  await h.engine.backfill(b.id)
  expect(txCount()).toBe(15)
  const jointVisibility = h.db.select().from(s.accountConnections).where(eq(s.accountConnections.accountId, 'acc-j')).all()
  expect(jointVisibility).toHaveLength(2)
  expect(h.db.select().from(s.accounts).where(eq(s.accounts.id, 'acc-j')).get()?.ownerUserId).toBeNull()
})

test('401 marks the connection unauthorized', async () => {
  h.addDailyTransactions('acc-1', 5)
  const conn = await h.engine.connect('u1', TOKEN)
  h.fake.revokeToken(TOKEN)
  const result = await h.engine.backfill(conn.id)
  expect(result.status).toBe('failed')
  expect(h.db.select().from(s.upConnections).get()).toMatchObject({ status: 'unauthorized', lastError: 'Up rejected the token' })
})

test('other failures mark the connection as errored with the message', async () => {
  const conn = await h.engine.connect('u1', TOKEN)
  h.fake.failNext(/transactions/, 500, 4)
  const result = await h.engine.backfill(conn.id)
  expect(result.status).toBe('failed')
  expect(result.error).toMatch(/500/)
  expect(h.db.select().from(s.upConnections).get()?.status).toBe('error')
})

test('pickConnectionForAccount prefers the acting user', async () => {
  h.addUser('u2')
  h.fake.addAccount(h.buildAccount({ id: 'acc-j', ownershipType: 'JOINT' }))
  h.fake.addCustomer(TOKEN, ['acc-j'])
  h.fake.addCustomer('up:yeah:partner', ['acc-j'])
  const a = await h.engine.connect('u1', TOKEN)
  const b = await h.engine.connect('u2', 'up:yeah:partner')
  expect(pickConnectionForAccount(h.db, 'acc-j', 'u2')?.id).toBe(b.id)
  expect(pickConnectionForAccount(h.db, 'acc-j', 'u1')?.id).toBe(a.id)
  // acc-1 is only visible to u1's token
  expect(pickConnectionForAccount(h.db, 'acc-1', 'u2')?.id).toBe(a.id)
  h.db.update(s.upConnections).set({ status: 'unauthorized' }).where(eq(s.upConnections.id, a.id)).run()
  expect(pickConnectionForAccount(h.db, 'acc-1', 'u2')).toBeNull()
})

test('disconnect removes the connection and its visibility but keeps data', async () => {
  h.addDailyTransactions('acc-1', 3)
  const conn = await h.engine.connect('u1', TOKEN)
  await h.engine.backfill(conn.id)
  h.engine.disconnect('u1')
  expect(h.db.select().from(s.upConnections).all()).toEqual([])
  expect(h.db.select().from(s.accountConnections).all()).toEqual([])
  expect(txCount()).toBe(3)
})
