import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import { upsertAccounts, upsertCategories, upsertTransactions } from '../../src/server/sync/upsert'
import type { UpCategory } from '../../src/server/up/schemas'
import categories from '../fixtures/up/categories.json'
import { createTestApp, type TestApp } from '../helpers/app'

let t: TestApp
let cookie: string
const NOW = '2026-11-15T00:00:00.000Z'

type TxInput = Parameters<TestApp['buildTransaction']>[0]
const seed = (...txs: (Partial<TxInput> & { id: string })[]) =>
  upsertTransactions(
    t.db,
    txs.map((p) => t.buildTransaction({ accountId: 'acc-me', amountCents: -1000, createdAt: '2026-11-05T00:00:00Z', ...p })),
    NOW,
  )

async function overview(query = 'month=2026-11') {
  const res = await t.json(`/api/overview?${query}`, { cookie })
  expect(res.status).toBe(200)
  return res.json()
}

beforeEach(async () => {
  t = createTestApp({ now: new Date(NOW) })
  cookie = await t.setupOwner()
  const userId = (await (await t.json('/api/me', { cookie })).json()).id
  t.db.insert(s.upConnections).values({ id: 'c1', userId, tokenCiphertext: 'v1:x', status: 'ok', createdAt: NOW }).run()
  upsertAccounts(t.db, { id: 'c1', userId }, [
    t.buildAccount({ id: 'acc-me', displayName: 'Spending', balanceCents: 100000 }),
    t.buildAccount({ id: 'acc-s', displayName: 'Savings', accountType: 'SAVER', balanceCents: 50000 }),
    t.buildAccount({ id: 'acc-j', displayName: '2Up', ownershipType: 'JOINT', balanceCents: 20000 }),
  ])
  upsertCategories(t.db, categories as unknown as UpCategory[])
})

test('totals include HELD and exclude transfers and deleted', async () => {
  seed(
    { id: 'g1', amountCents: -5000, categoryId: 'groceries', parentCategoryId: 'home' },
    { id: 'held', amountCents: -1000, status: 'HELD' },
    { id: 'xfer', amountCents: -10000, transferAccountId: 'acc-s' },
    { id: 'roundup-in', accountId: 'acc-s', amountCents: 70, transferAccountId: 'acc-me', description: 'Round Up' },
    { id: 'del', amountCents: -999 },
    { id: 'pay', amountCents: 300000, createdAt: '2026-11-01T00:00:00Z' },
  )
  t.db.update(s.transactions).set({ deletedAt: NOW }).where(eq(s.transactions.id, 'del')).run()
  const o = await overview()
  expect(o.month).toEqual({ spentCents: 6000, incomeCents: 300000, netCents: 294000 })
})

test('counts by local month, not UTC month', async () => {
  seed({ id: 'nov', amountCents: -700, createdAt: '2026-10-31T13:30:00Z' }, { id: 'oct', amountCents: -800, createdAt: '2026-10-31T12:30:00Z' })
  const o = await overview()
  expect(o.month.spentCents).toBe(700)
  expect(o.previousMonth.spentCents).toBe(800)
})

test('foreign purchases use the AUD amount', async () => {
  seed({ id: 'fx', amountCents: -1530, foreignAmountCents: -1000, foreignCurrency: 'USD' })
  expect((await overview()).month.spentCents).toBe(1530)
})

test('home loan is reported separately from total balance', async () => {
  expect((await overview()).homeLoanCents).toBeNull()
  upsertAccounts(t.db, { id: 'c1', userId: (await (await t.json('/api/me', { cookie })).json()).id }, [
    t.buildAccount({ id: 'acc-hl', displayName: 'Home Loan', accountType: 'HOME_LOAN', balanceCents: -40000000 }),
  ])
  const o = await overview()
  expect(o.totalBalanceCents).toBe(170000)
  expect(o.homeLoanCents).toBe(-40000000)
  expect(o.balancesByAccount.map((a: { accountId: string }) => a.accountId)).toEqual(['acc-me', 'acc-s', 'acc-j'])
})

test('spending by parent and top categories', async () => {
  seed(
    { id: 'g1', amountCents: -5000, categoryId: 'groceries', parentCategoryId: 'home' },
    { id: 'u1', amountCents: -1200, categoryId: 'utilities', parentCategoryId: 'home' },
    { id: 'r1', amountCents: -2000, categoryId: 'restaurants-and-cafes', parentCategoryId: 'good-life' },
    { id: 'n1', amountCents: -3000 },
    { id: 'refund', amountCents: 400, categoryId: 'groceries', parentCategoryId: 'home' },
  )
  const o = await overview()
  expect(o.spendingByParent).toEqual([
    { parentId: 'home', name: 'Home', colorToken: 'cat-blue', cents: 6200 },
    { parentId: null, name: 'Uncategorised', colorToken: 'cat-slate', cents: 3000 },
    { parentId: 'good-life', name: 'Good Life', colorToken: 'cat-orange', cents: 2000 },
  ])
  expect(o.topCategories[0]).toEqual({ categoryId: 'groceries', name: 'Groceries', parentId: 'home', colorToken: 'cat-blue', cents: 5000 })
  expect(o.topCategories.map((c: { categoryId: string | null }) => c.categoryId)).toEqual(['groceries', null, 'restaurants-and-cafes', 'utilities'])
})

test('six monthly buckets, previous month and recent transactions', async () => {
  seed(
    { id: 'jun', amountCents: -100, createdAt: '2026-06-10T00:00:00Z' },
    { id: 'may', amountCents: -100, createdAt: '2026-05-10T00:00:00Z' },
    { id: 'oct', amountCents: -4000, createdAt: '2026-10-10T00:00:00Z' },
    { id: 'nov', amountCents: -1000 },
    { id: 'pay', amountCents: 5000 },
  )
  const o = await overview()
  expect(o.monthly.map((m: { month: string }) => m.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
  expect(o.monthly[0]).toEqual({ month: '2026-06', spentCents: 100, incomeCents: 0 })
  expect(o.monthly[5]).toEqual({ month: '2026-11', spentCents: 1000, incomeCents: 5000 })
  expect(o.previousMonth).toEqual({ spentCents: 4000, incomeCents: 0, netCents: -4000 })
  expect(o.recent.map((r: { id: string }) => r.id)).toEqual(['pay', 'nov', 'oct', 'jun', 'may'])
})

test('defaults to the current local month', async () => {
  seed({ id: 'nov', amountCents: -1000 })
  expect((await overview('')).month.spentCents).toBe(1000)
})

test('respects scope', async () => {
  seed({ id: 'mine', amountCents: -1000 }, { id: 'ours', accountId: 'acc-j', amountCents: -2500 })
  const joint = await overview('month=2026-11&scope=joint')
  expect(joint.month.spentCents).toBe(2500)
  expect(joint.totalBalanceCents).toBe(20000)
  expect(joint.recent.map((r: { id: string }) => r.id)).toEqual(['ours'])
  const partner = await overview('month=2026-11&scope=partner')
  expect(partner).toMatchObject({ totalBalanceCents: 0, month: { spentCents: 0 }, balancesByAccount: [], recent: [] })
})

test('rejects a malformed month', async () => {
  expect((await t.json('/api/overview?month=2026-13', { cookie })).status).toBe(400)
})
