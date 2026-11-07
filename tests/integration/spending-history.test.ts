import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import { UNCATEGORISED } from '../../src/shared/categories'
import type { BudgetDto, SpendingHistoryDto, TransactionPage } from '../../src/shared/types'
import { createTestApp, type TestApp } from '../helpers/app'
import { local, seedAccount, seedCategories, seedEvents, seedTx } from '../helpers/budget-seed'

const NOW = new Date(local('2026-04-10', '12:00'))
// Six finished pays from 15 Jan to 8 Apr, an older one before them, and the current one.
const PAYS = ['2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12', '2026-02-26', '2026-03-12', '2026-03-26', '2026-04-09']

let t: TestApp
let owner: string
let partner: string
let ownerId: string
let partnerId: string

const me = async (cookie: string) => (await t.json('/api/me', { cookie })).json() as Promise<{ id: string }>
const budgets = async (cookie = owner) => (await (await t.json('/api/budgets', { cookie })).json()) as BudgetDto[]
const history = (id: string, cookie = owner) => t.json(`/api/budgets/${id}/spending-history`, { cookie })
const mine = async () => {
  const b = (await budgets()).find((x) => x.kind === 'personal' && x.ownerUserId === ownerId)!
  return (await (await history(b.id)).json()) as SpendingHistoryDto
}
const spend = (id: string, amountCents: number, date: string, categoryId: string | null = null, parentCategoryId: string | null = null) =>
  seedTx(t.db, { id, accountId: 'acc-spend', amountCents, createdAt: local(date), categoryId, parentCategoryId })

beforeEach(async () => {
  t = createTestApp({ now: NOW })
  owner = await t.setupOwner()
  ownerId = (await me(owner)).id
  partner = await t.addPartner(owner)
  partnerId = (await me(partner)).id
  seedAccount(t.db, { id: 'acc-spend', owner: ownerId })
  seedCategories(t.db, [
    { id: 'home', name: 'Home', parentId: null },
    { id: 'groceries', name: 'Groceries', parentId: 'home' },
    { id: 'fuel', name: 'Fuel', parentId: 'home' },
    { id: 'cafe', name: 'Cafe', parentId: 'home' },
  ])
})

test('ranks categories by spend over the last six finished pays, less refunds', async () => {
  seedEvents(t.db, ownerId, PAYS)
  spend('g1', -60_000, '2026-02-01', 'groceries', 'home')
  spend('g2', -60_000, '2026-03-01', 'groceries', 'home')
  spend('g3', 6_000, '2026-03-02', 'groceries', 'home')
  spend('f1', -30_000, '2026-02-01', 'fuel', 'home')
  // A refund alone isn't spending.
  spend('c1', 500, '2026-02-01', 'cafe', 'home')
  // Before the six pays, and in the current one.
  spend('old', -99_900, '2026-01-10', 'cafe', 'home')
  spend('now', -99_900, '2026-04-10', 'cafe', 'home')

  expect(await mine()).toEqual({
    from: '2026-01-15',
    to: '2026-04-08',
    payCount: 6,
    categories: [
      { categoryId: 'groceries', perPayCents: 19_000 },
      { categoryId: 'fuel', perPayCents: 5_000 },
    ],
    uncategorised: { count: 0, cents: 0 },
  })
})

test('averages to whole dollars and drops what rounds to nothing', async () => {
  seedEvents(t.db, ownerId, PAYS)
  spend('g1', -1_234, '2026-02-01', 'groceries', 'home')
  spend('f1', -100, '2026-02-01', 'fuel', 'home')
  expect((await mine()).categories).toEqual([{ categoryId: 'groceries', perPayCents: 200 }])
})

test('counts uncategorised spending that can be categorised, and the filter lists the same ones', async () => {
  seedEvents(t.db, ownerId, PAYS)
  spend('u1', -1_000, '2026-02-01')
  spend('u2', -2_500, '2026-03-01')
  spend('deposit', 5_000, '2026-02-01')
  seedTx(t.db, { id: 'transfer', accountId: 'acc-spend', amountCents: -700, createdAt: local('2026-02-01'), transferAccountId: 'acc-spend' })
  spend('locked', -800, '2026-02-01')
  t.db.update(s.transactions).set({ isCategorizable: false }).where(eq(s.transactions.id, 'locked')).run()
  seedTx(t.db, { id: 'gone', accountId: 'acc-spend', amountCents: -900, createdAt: local('2026-02-01'), deletedAt: local('2026-02-02') })
  spend('old', -1_100, '2026-01-10')
  spend('named', -1_200, '2026-02-01', 'groceries', 'home')

  const dto = await mine()
  expect(dto.uncategorised).toEqual({ count: 2, cents: 3_500 })

  const from = new Date(local(dto.from, '00:00')).toISOString()
  const to = new Date(local('2026-04-09', '00:00')).toISOString()
  const query = new URLSearchParams({ scope: 'me', categoryId: UNCATEGORISED, from, to })
  const page = (await (await t.json(`/api/transactions?${query}`, { cookie: owner })).json()) as TransactionPage
  expect(page.items.map((i) => i.id).sort()).toEqual(['u1', 'u2'])
})

test('with no finished pay, it uses the current one up to today', async () => {
  seedEvents(t.db, ownerId, ['2026-04-09'])
  spend('g1', -4_000, '2026-04-10', 'groceries', 'home')
  spend('u1', -1_500, '2026-04-10')
  expect(await mine()).toEqual({
    from: '2026-04-09',
    to: '2026-04-10',
    payCount: 1,
    categories: [{ categoryId: 'groceries', perPayCents: 4_000 }],
    uncategorised: { count: 1, cents: 1_500 },
  })
})

test('the joint budget reads joint accounts', async () => {
  seedEvents(t.db, ownerId, PAYS)
  seedAccount(t.db, { id: 'acc-joint', owner: null, ownership: 'JOINT' })
  spend('g1', -60_000, '2026-02-01', 'groceries', 'home')
  seedTx(t.db, { id: 'j1', accountId: 'acc-joint', amountCents: -12_000, createdAt: local('2026-02-01'), categoryId: 'fuel', parentCategoryId: 'home' })
  seedTx(t.db, { id: 'j2', accountId: 'acc-joint', amountCents: -600, createdAt: local('2026-02-01') })
  const joint = (await budgets()).find((b) => b.kind === 'joint')!
  await t.json(`/api/budgets/${joint.id}`, { method: 'PATCH', body: { anchorUserId: ownerId }, cookie: owner })

  const dto = (await (await history(joint.id)).json()) as SpendingHistoryDto
  expect(dto.categories).toEqual([{ categoryId: 'fuel', perPayCents: 2_000 }])
  expect(dto.uncategorised).toEqual({ count: 1, cents: 600 })
})

test("the partner's budget is 404 at every level, even at full", async () => {
  seedEvents(t.db, partnerId, PAYS)
  seedAccount(t.db, { id: 'acc-partner', owner: partnerId })
  const theirs = (await budgets(partner)).find((b) => b.kind === 'personal')!
  expect((await history(theirs.id, partner)).status).toBe(200)
  for (const level of ['full', 'hide-transactions', 'balances', 'none'] as const) {
    t.db.update(s.users).set({ sharingLevel: level }).where(eq(s.users.id, partnerId)).run()
    expect((await history(theirs.id)).status, level).toBe(404)
  }
})

test('a budget with no pays yet is 404, and it needs a login', async () => {
  const b = (await budgets()).find((x) => x.kind === 'personal' && x.ownerUserId === ownerId)!
  expect((await history(b.id)).status).toBe(404)
  expect((await t.json(`/api/budgets/${b.id}/spending-history`)).status).toBe(401)
})
