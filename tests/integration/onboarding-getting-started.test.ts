import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import type { BudgetDto, GettingStartedDto } from '../../src/shared/types'
import { createTestApp, type TestApp } from '../helpers/app'
import { seedAccount, seedConnection } from '../helpers/budget-seed'

const NOW = new Date('2026-10-30T01:00:00Z')
const STAMP = NOW.toISOString()

let t: TestApp
let owner: string
let partner: string
let ownerId: string
let partnerId: string

const get = (cookie?: string) => t.json('/api/getting-started', { cookie })
const dto = async (cookie = owner) => (await (await get(cookie)).json()) as GettingStartedDto
const states = (res: GettingStartedDto) => Object.fromEntries(res.items.map((i) => [i.key, i.state]))
const me = async (cookie: string) => (await t.json('/api/me', { cookie })).json()

const finishImport = (userId: string) =>
  t.db
    .update(s.upConnections)
    .set({ backfillCompletedAt: STAMP })
    .where(eq(s.upConnections.userId, userId))
    .run()

const schedule = (userId: string) =>
  t.db
    .insert(s.paySchedules)
    .values({
      userId,
      accountId: 'acc-spend',
      descriptionMatch: 'acme pay',
      minAmountCents: 1,
      frequencyDays: 14,
      createdAt: STAMP,
      updatedAt: STAMP,
    })
    .run()

const budgetId = (kind: 'personal' | 'joint', ownerUserId: string | null = null) =>
  t.db
    .select()
    .from(s.budgets)
    .all()
    .find((b) => b.kind === kind && b.ownerUserId === ownerUserId)!.id

const lineOn = (id: string, onBudget: string, archivedAt: string | null = null) =>
  t.db
    .insert(s.budgetLines)
    .values({ id, budgetId: onBudget, kind: 'spending', name: 'Groceries', amountCents: 60_000, sortOrder: 0, createdAt: STAMP, archivedAt })
    .run()

const savedPlan = (userId: string) =>
  t.db
    .insert(s.planTemplateItems)
    .values({ id: `item-${userId}`, userId, targetKind: 'buffer', amountCents: 10_000, sortOrder: 0 })
    .run()

const goalRow = (accountId: string) =>
  t.db
    .insert(s.goals)
    .values({ accountId, name: 'Holiday', targetCents: 100_000, createdAt: STAMP, updatedAt: STAMP })
    .run()

const archivedGoalRow = (id: string, ownerUserId: string | null) =>
  t.db
    .insert(s.archivedGoals)
    .values({
      id,
      accountId: `sv-gone-${id}`,
      ownerUserId,
      saverName: 'Gone',
      name: 'Old',
      kind: 'save',
      targetCents: 1000,
      reachedOn: '2026-09-01',
      archivedAt: STAMP,
    })
    .run()

const debtRow = (id: string, ownerUserId: string | null) =>
  t.db
    .insert(s.debts)
    .values({
      id,
      ownerUserId,
      kind: 'loan',
      name: 'Car loan',
      repaymentCents: 45_000,
      repaymentFrequency: 'monthly',
      createdByUserId: ownerId,
      createdAt: STAMP,
      updatedAt: STAMP,
    })
    .run()

beforeEach(async () => {
  t = createTestApp({ now: NOW })
  owner = await t.setupOwner()
  ownerId = (await me(owner)).id
  partner = await t.addPartner(owner)
  partnerId = (await me(partner)).id
  seedAccount(t.db, { id: 'acc-spend', owner: ownerId })
})

test("the partner sees their own connection, not the owner's", async () => {
  seedConnection(t.db, ownerId)
  const asPartner = await dto(partner)
  const partnerStates = states(asPartner)
  expect(partnerStates['connect-up']).toBe('open')
  expect(partnerStates.partner).toBeUndefined()
  expect(partnerStates.password).toBe('open')
  expect(states(await dto(owner))['connect-up']).toBe('done')
})

test("imported means the viewer's own connection has finished", async () => {
  seedConnection(t.db, ownerId)
  seedConnection(t.db, partnerId)
  finishImport(ownerId)
  expect(states(await dto(partner)).budget).toBe('locked')
  finishImport(partnerId)
  expect(states(await dto(partner)).budget).toBe('open')
})

test('a user added since the server started gets budget rows', async () => {
  seedConnection(t.db, partnerId)
  schedule(partnerId)
  savedPlan(partnerId)
  const res = await get(partner)
  expect(res.status).toBe(200)
  expect(states(await res.json()).budget).toBe('done')
})

test("marking pay doesn't tick a budget row until something is planned", async () => {
  seedAccount(t.db, { id: 'acc-joint', owner: null, ownership: 'JOINT' })
  seedConnection(t.db, ownerId)
  finishImport(ownerId)
  const setups = async () => {
    const budgets = (await (await t.json('/api/budgets', { cookie: owner })).json()) as BudgetDto[]
    return Object.fromEntries(budgets.map((b) => [b.name, b.setup]))
  }

  expect(await setups()).toMatchObject({ Mine: 'needs-pay', Joint: 'needs-pay' })
  expect(states(await dto())).toMatchObject({ budget: 'open', 'joint-budget': 'open' })

  schedule(ownerId)
  expect(await setups()).toMatchObject({ Mine: 'ready', Joint: 'ready' })
  expect(states(await dto())).toMatchObject({ budget: 'open', 'joint-budget': 'open' })

  lineOn('l-mine', budgetId('personal', ownerId))
  expect(states(await dto())).toMatchObject({ budget: 'done', 'joint-budget': 'open' })

  lineOn('l-joint', budgetId('joint'))
  expect(states(await dto())).toMatchObject({ budget: 'done', 'joint-budget': 'done' })
})

test('a saved plan ticks the pay row, but not the joint one', async () => {
  seedAccount(t.db, { id: 'acc-joint', owner: null, ownership: 'JOINT' })
  seedConnection(t.db, ownerId)
  finishImport(ownerId)
  schedule(ownerId)
  savedPlan(ownerId)
  expect(states(await dto())).toMatchObject({ budget: 'done', 'joint-budget': 'open' })
})

test("planning without a pay schedule doesn't tick a budget row", async () => {
  seedAccount(t.db, { id: 'acc-joint', owner: null, ownership: 'JOINT' })
  seedConnection(t.db, ownerId)
  finishImport(ownerId)
  await dto()
  lineOn('l-mine', budgetId('personal', ownerId))
  lineOn('l-joint', budgetId('joint'))
  expect(states(await dto())).toMatchObject({ budget: 'open', 'joint-budget': 'open' })
})

test('an archived bucket is not a plan', async () => {
  seedAccount(t.db, { id: 'acc-joint', owner: null, ownership: 'JOINT' })
  seedConnection(t.db, ownerId)
  finishImport(ownerId)
  schedule(ownerId)
  await dto()
  lineOn('l-mine', budgetId('personal', ownerId), STAMP)
  lineOn('l-joint', budgetId('joint'), STAMP)
  expect(states(await dto())).toMatchObject({ budget: 'open', 'joint-budget': 'open' })
})

test("the partner's own plan doesn't tick the viewer's pay row", async () => {
  seedConnection(t.db, ownerId)
  finishImport(ownerId)
  schedule(ownerId)
  await dto()
  savedPlan(partnerId)
  await dto(partner)
  lineOn('l-partner', budgetId('personal', partnerId))
  expect(states(await dto(owner)).budget).toBe('open')
})

test('joint budget appears with a joint account', async () => {
  expect(states(await dto())['joint-budget']).toBeUndefined()
  seedAccount(t.db, { id: 'acc-joint', owner: null, ownership: 'JOINT' })
  expect(states(await dto())['joint-budget']).toBeDefined()
  t.db.update(s.accounts).set({ hidden: true }).where(eq(s.accounts.id, 'acc-joint')).run()
  expect(states(await dto())['joint-budget']).toBeUndefined()
})

test("a goal counts when set or archived, but the built-in one doesn't", async () => {
  seedAccount(t.db, { id: 'sv-challenge', owner: ownerId, type: 'SAVER', name: 'Save Up Challenge' })
  expect(states(await dto()).goal).not.toBe('done')

  seedAccount(t.db, { id: 'sv-own', owner: ownerId, type: 'SAVER' })
  goalRow('sv-own')
  expect(states(await dto()).goal).toBe('done')
  t.db.delete(s.goals).where(eq(s.goals.accountId, 'sv-own')).run()
  expect(states(await dto()).goal).not.toBe('done')

  seedAccount(t.db, { id: 'sv-joint', owner: null, ownership: 'JOINT', type: 'SAVER' })
  goalRow('sv-joint')
  expect(states(await dto()).goal).toBe('done')
  t.db.delete(s.goals).where(eq(s.goals.accountId, 'sv-joint')).run()
  expect(states(await dto()).goal).not.toBe('done')

  t.db
    .insert(s.archivedGoals)
    .values({
      id: 'ag1',
      accountId: 'sv-gone',
      ownerUserId: ownerId,
      saverName: 'Gone',
      name: 'Old',
      kind: 'save',
      targetCents: 1000,
      reachedOn: '2026-09-01',
      archivedAt: STAMP,
    })
    .run()
  expect(states(await dto()).goal).toBe('done')
})

test("the partner's personal debt and goal don't tick the viewer's rows, at any level", async () => {
  seedAccount(t.db, { id: 'sv-partner', owner: partnerId, type: 'SAVER' })
  goalRow('sv-partner')
  archivedGoalRow('ag-partner', partnerId)
  debtRow('d-partner', partnerId)
  for (const level of ['full', 'hide-transactions', 'balances', 'none'] as const) {
    t.db.update(s.users).set({ sharingLevel: level }).where(eq(s.users.id, partnerId)).run()
    const res = states(await dto(owner))
    expect(res.debt, level).toBe('open')
    expect(res.goal, level).not.toBe('done')
  }
  debtRow('d-joint', null)
  expect(states(await dto(owner)).debt).toBe('done')
})

test('an archived goal with no owner ticks the goal row', async () => {
  expect(states(await dto(owner)).goal).not.toBe('done')
  archivedGoalRow('ag-joint', null)
  expect(states(await dto(owner)).goal).toBe('done')
})

test('disconnecting brings the card back unless hidden', async () => {
  seedConnection(t.db, ownerId)
  finishImport(ownerId)
  schedule(ownerId)
  savedPlan(ownerId)
  await t.json('/api/me', { method: 'PATCH', body: { connectUpSkipped: true, upDisplayName: '$sam' }, cookie: owner })
  const done = await dto()
  expect(done.show).toBe(false)

  const res = await t.json('/api/settings/up-token', { method: 'DELETE', cookie: owner })
  expect(res.status).toBe(200)
  const after = await dto()
  expect(after.show).toBe(true)
  expect(states(after)['connect-up']).toBe('open')
  expect((await me(owner)).connectUpAnswered).toBe(true)

  await t.json('/api/me', { method: 'PATCH', body: { gettingStartedHidden: true }, cookie: owner })
  expect((await dto()).show).toBe(false)
})

test("adding a partner ticks the owner's row", async () => {
  const fresh = createTestApp({ now: NOW })
  const cookie = await fresh.setupOwner()
  const before = await (await fresh.json('/api/getting-started', { cookie })).json()
  expect(states(before).partner).toBe('open')
  await fresh.addPartner(cookie)
  const after = await (await fresh.json('/api/getting-started', { cookie })).json()
  expect(states(after).partner).toBe('done')
})

test('needs a login', async () => {
  expect((await get()).status).toBe(401)
})
