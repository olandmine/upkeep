import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import { listBudgetRows, setJointAnchor } from '../../src/server/budgets/budgets'
import { putTemplate } from '../../src/server/budgets/plans'
import * as s from '../../src/server/db/schema'
import type { BudgetDto, BudgetPeriodDto, GoalDetailDto, GoalDto, GoalsDto, PlanItemInput, TransactionPage } from '../../src/shared/types'
import { projectedSaverCents } from '../../src/server/goals/detail'
import { goalCaption, recentPeriods } from '../../src/server/goals/goals'
import { debtFall, debtLeft } from '../../src/server/goals/debt-goal'
import { otherRate, planComparison, tryResult } from '../../src/web/components/goals/plan'
import { createTestApp, type TestApp } from '../helpers/app'
import { local, seedAccount, seedEvents, seedTx } from '../helpers/budget-seed'

const NOW = new Date('2026-10-30T01:00:00Z')
const PAYDAYS = ['2026-09-11', '2026-09-25', '2026-10-09', '2026-10-23']

let t: TestApp
let owner: string
let partner: string
let ownerId: string
let partnerId: string

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await t.json(path, { cookie: owner, ...init })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const goals = async (scope: string, cookie = owner) =>
  ((await call(`/api/goals?scope=${scope}`, { cookie })).body as GoalsDto).goals
const put = (accountId: string, body: unknown, cookie = owner) =>
  call(`/api/goals/${accountId}`, { method: 'PUT', body, cookie })
const holiday = { name: 'Holiday', targetCents: 100_000, targetDate: null }
const TODAY = '2026-10-30'
const TZ = 'Australia/Sydney'
const goalOf = async (accountId: string, cookie = owner) =>
  (await goals('everyone', cookie)).find((g) => g.accountId === accountId)!

const debtBody = (over: Record<string, unknown> = {}) => ({
  name: 'Car loan',
  kind: 'loan',
  ownerUserId: ownerId,
  rateBp: 649,
  repaymentCents: 45_000,
  repaymentFrequency: 'monthly',
  balanceCents: 1_000_000,
  asOf: '2026-10-01',
  interest: { calc: 'daily', charge: 'monthly', chargeDay: 1, chargeDate: null },
  ...over,
})
async function newDebt(over: Record<string, unknown> = {}, cookie = owner): Promise<string> {
  const res = await call('/api/debts', { method: 'POST', body: debtBody(over), cookie })
  expect(res.status).toBe(201)
  return res.body.id
}
/** What's left on a debt as the Debts page shows it. */
const leftOn = async (id: string) => {
  const d = (await call(`/api/debts/${id}`)).body
  return d.balanceCents + d.accruingCents
}
const pay = (id: string, amountCents: number) =>
  call(`/api/debts/${id}/entries`, { method: 'POST', body: { kind: 'payment', date: TODAY, amountCents } })
const setLevel = (userId: string, level: string | null) =>
  t.db.update(s.users).set({ sharingLevel: level as never }).where(eq(s.users.id, userId)).run()
const schedule = (userId: string, frequencyDays: number) =>
  t.db
    .insert(s.paySchedules)
    .values({
      userId,
      accountId: 'acc-spend',
      descriptionMatch: 'acme pay',
      minAmountCents: 1,
      frequencyDays,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })
    .run()

beforeEach(async () => {
  t = createTestApp({ now: NOW })
  owner = await t.setupOwner()
  partner = await t.addPartner(owner)
  ownerId = (await call('/api/me')).body.id
  partnerId = (await call('/api/me', { cookie: partner })).body.id
  seedAccount(t.db, { id: 'acc-spend', owner: ownerId })
  seedAccount(t.db, {
    id: 'acc-holiday',
    owner: ownerId,
    type: 'SAVER',
    name: 'Holiday',
    balanceCents: 62_000,
  })
  seedAccount(t.db, { id: 'acc-p-saver', owner: partnerId, type: 'SAVER', name: 'Car fund' })
  seedAccount(t.db, { id: 'acc-j-saver', owner: null, ownership: 'JOINT', type: 'SAVER', name: 'House' })
})

test('set goal on own saver', async () => {
  expect((await put('acc-holiday', holiday)).status).toBe(204)
  const [g] = await goals('me')
  expect(g).toMatchObject({
    accountId: 'acc-holiday',
    saverName: 'Holiday',
    balanceCents: 62_000,
    goal: { kind: 'save', ...holiday },
    progress: 0.62,
    toGoCents: 38_000,
    debt: null,
    belowCents: null,
    debtFallCents: null,
    followedDebtName: null,
    canEdit: true,
    accountMissing: false,
  })
  expect((await goals('everyone')).map((x) => x.accountId).sort()).toEqual([
    'acc-holiday',
    'acc-j-saver',
    'acc-p-saver',
  ])
})

test('non-saver rejected', async () => {
  expect(await put('acc-spend', holiday)).toMatchObject({
    status: 400,
    body: { error: 'Goals can only be set on Savers.' },
  })
  expect(await put('acc-holiday', { ...holiday, targetCents: 0 })).toMatchObject({
    status: 400,
    body: { error: 'Target must be more than $0.' },
  })
  expect(await put('acc-holiday', { ...holiday, targetDate: '2026-10-29' })).toMatchObject({
    status: 400,
    body: { error: "Target date can't be in the past." },
  })
})

test('partner saver is read-only', async () => {
  expect((await goals('partner'))[0]?.canEdit).toBe(false)
  expect(await put('acc-p-saver', holiday)).toMatchObject({
    status: 403,
    body: { error: 'Only Partner can edit that.' },
  })
})

test('joint saver editable by both', async () => {
  expect((await put('acc-j-saver', holiday, partner)).status).toBe(204)
  expect((await call('/api/goals/acc-j-saver', { method: 'DELETE' })).status).toBe(204)
  expect((await goals('joint'))[0]?.goal).toBeNull()
})

test('recent rate excludes round-ups', async () => {
  schedule(ownerId, 14)
  seedEvents(t.db, ownerId, PAYDAYS)
  PAYDAYS.slice(0, 3).forEach((d, i) => {
    seedTx(t.db, {
      id: `in${i}`,
      accountId: 'acc-holiday',
      amountCents: 10_000,
      createdAt: local(d, '10:00'),
      transferAccountId: 'acc-spend',
    })
    seedTx(t.db, {
      id: `ru${i}`,
      accountId: 'acc-holiday',
      amountCents: 196,
      createdAt: local(d, '11:00'),
      transactionType: 'Round Up',
    })
  })
  t.db.update(s.accounts).set({ balanceCents: 0 }).where(eq(s.accounts.id, 'acc-holiday')).run()
  await put('acc-holiday', { ...holiday, targetDate: '2026-12-31' })
  // Needs 25,000 a pay (6 Nov, 20 Nov, 4 Dec, 18 Dec); the recent rate is exactly 10,000.
  expect((await goals('me'))[0]).toMatchObject({
    status: 'behind',
    neededCents: 25_000,
    neededPer: 'pay',
    behindCents: 15_000,
    recentRateCents: 10_000,
    debtFallCents: null,
  })
})

test('saver not found', async () => {
  await put('acc-holiday', holiday)
  t.db.delete(s.accounts).where(eq(s.accounts.id, 'acc-holiday')).run()
  expect(await goals('me')).toEqual([])
  const missing = (await goals('everyone')).find((g) => g.accountId === 'acc-holiday')
  expect(missing).toMatchObject({ accountMissing: true, saverName: null, canEdit: true, goal: { kind: 'save', ...holiday } })
  expect((await call('/api/goals/acc-holiday', { method: 'DELETE' })).status).toBe(204)
  expect((await goals('everyone')).find((g) => g.accountId === 'acc-holiday')).toBeUndefined()
})

test('fund line shows the goal caption', async () => {
  seedEvents(t.db, ownerId, PAYDAYS)
  const mine = ((await call('/api/budgets')).body as BudgetDto[]).find((b) => b.name === 'Mine')!
  const line = await call(`/api/budgets/${mine.id}/lines`, {
    method: 'POST',
    body: {
      kind: 'fund',
      name: 'Holiday',
      amountCents: 10_000,
      categoryIds: [],
      saverAccountId: 'acc-holiday',
    },
  })
  expect(line.status).toBe(201)
  await put('acc-holiday', holiday)
  const period = (await call(`/api/budgets/${mine.id}/period`)).body as BudgetPeriodDto
  expect(period.lines[0]?.goal).toEqual({ name: 'Holiday', percent: 62, reached: false })
})

test('a goal whose date has passed can still be edited', async () => {
  t.db
    .insert(s.goals)
    .values({
      accountId: 'acc-holiday',
      name: 'Holiday',
      targetCents: 100_000,
      targetDate: '2026-10-01',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })
    .run()
  expect(
    (await put('acc-holiday', { name: 'Japan', targetCents: 120_000, targetDate: '2026-10-01' })).status,
  ).toBe(204)
  expect((await goals('me'))[0]).toMatchObject({
    goal: { name: 'Japan', targetDate: '2026-10-01' },
    status: 'date-passed',
  })
  expect((await put('acc-holiday', { ...holiday, targetDate: '2026-10-02' })).status).toBe(400)
})

test('the Save Up Challenge saver defaults to a $1,000 goal', async () => {
  seedAccount(t.db, {
    id: 'acc-challenge',
    owner: ownerId,
    type: 'SAVER',
    name: '⛰️ Save Up Challenge',
    balanceCents: 25_000,
  })
  const challenge = async () => (await goals('me')).find((g) => g.accountId === 'acc-challenge')!
  expect(await challenge()).toMatchObject({
    goal: { kind: 'save', name: 'Save Up Challenge', targetCents: 100_000, targetDate: null, isDefault: true },
    progress: 0.25,
  })
  expect(goalCaption(t.db, 'acc-challenge', TODAY, TZ)).toEqual({ name: 'Save Up Challenge', percent: 25, reached: false })
  // Other Savers get no default.
  expect((await goals('me')).find((g) => g.accountId === 'acc-holiday')?.goal).toBeNull()

  expect((await put('acc-challenge', { name: 'Challenge', targetCents: 50_000, targetDate: null })).status).toBe(204)
  expect((await challenge()).goal).toEqual({
    kind: 'save',
    name: 'Challenge',
    targetCents: 50_000,
    targetDate: null,
    isDefault: false,
  })

  expect((await call('/api/goals/acc-challenge', { method: 'DELETE' })).status).toBe(204)
  expect((await challenge()).goal).toMatchObject({ targetCents: 100_000, isDefault: true })
})

test("debtLeft agrees with the debt's balance plus accruing interest", async () => {
  const body = {
    name: 'Car loan',
    kind: 'loan',
    ownerUserId: ownerId,
    rateBp: 649,
    repaymentCents: 45_000,
    repaymentFrequency: 'monthly',
    balanceCents: 1_000_000,
    asOf: '2026-10-01',
    interest: { calc: 'daily', charge: 'monthly', chargeDay: 1, chargeDate: null },
  }
  const created = await call('/api/debts', { method: 'POST', body })
  expect(created.status).toBe(201)
  const dto = (await call(`/api/debts/${created.body.id}`)).body
  expect(dto.accruingCents).toBeGreaterThan(0)
  const debt = t.db.select().from(s.debts).where(eq(s.debts.id, created.body.id)).get()!
  const { leftCents, days } = debtLeft(t.db, debt, '2026-10-30', 'Australia/Sydney')
  expect(leftCents).toBe(dto.balanceCents + dto.accruingCents)
  expect(days.length).toBeGreaterThan(0)
})

test('buffer goal', async () => {
  t.db.update(s.accounts).set({ balanceCents: 36_000 }).where(eq(s.accounts.id, 'acc-holiday')).run()
  expect((await put('acc-holiday', { kind: 'buffer', name: 'Food', targetCents: 40_000 })).status).toBe(204)
  expect(await goalOf('acc-holiday')).toMatchObject({
    goal: { kind: 'buffer', name: 'Food', targetCents: 40_000, targetDate: null },
    status: 'below',
    progress: 0.9,
    belowCents: 4_000,
    toGoCents: null,
    expectedProgress: null,
    recentRateCents: null,
    debt: null,
  })
  expect(
    await put('acc-holiday', { kind: 'buffer', name: 'Food', targetCents: 40_000, targetDate: '2026-12-01' }),
  ).toMatchObject({ status: 400, body: { error: 'A buffer has no date.' } })
  expect(await put('acc-holiday', { kind: 'buffer', name: 'Food', targetCents: 0 })).toMatchObject({
    status: 400,
    body: { error: 'Target must be more than $0.' },
  })
  expect(await put('acc-holiday', { kind: 'save', name: 'Food' })).toMatchObject({
    status: 400,
    body: { error: 'Target must be more than $0.' },
  })
  t.db.update(s.accounts).set({ balanceCents: 45_000 }).where(eq(s.accounts.id, 'acc-holiday')).run()
  expect(await goalOf('acc-holiday')).toMatchObject({ status: 'topped-up', progress: 1, belowCents: null })
})

test('debt goal follows the debt', async () => {
  const id = await newDebt()
  const left = await leftOn(id)
  expect(left).toBeGreaterThan(1_000_000)
  expect((await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id, targetDate: null })).status).toBe(204)
  expect(await goalOf('acc-holiday')).toMatchObject({
    goal: { kind: 'debt', name: 'Car', targetCents: left, targetDate: null },
    debt: { id, name: 'Car loan', leftCents: left, startTargetCents: left, paidOff: false },
    toGoCents: left - 62_000,
    belowCents: null,
    debtFallCents: 0,
    recentRateCents: 0,
    status: 'not-growing',
  })
  // The stored target is what was left when it was saved.
  expect(t.db.select().from(s.goals).where(eq(s.goals.accountId, 'acc-holiday')).get()).toMatchObject({
    kind: 'debt',
    debtId: id,
    targetCents: left,
    startCents: 62_000,
    startTargetCents: left,
    startedAt: NOW.toISOString(),
  })

  expect((await pay(id, 100_000)).status).toBe(204)
  const after = await leftOn(id)
  expect(after).toBe(left - 100_000)
  expect(await goalOf('acc-holiday')).toMatchObject({
    goal: { targetCents: after },
    debt: { leftCents: after, startTargetCents: left },
    toGoCents: after - 62_000,
  })
})

test("a debt goal's rate adds how much the debt fell", async () => {
  const id = await newDebt({ asOf: '2026-07-01' })
  await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
  const debt = t.db.select().from(s.debts).where(eq(s.debts.id, id)).get()!
  const fall = debtFall(debtLeft(t.db, debt, TODAY, TZ).days, recentPeriods({ kind: 'month' }, TODAY))
  expect(fall).toBeGreaterThan(0)
  expect(await goalOf('acc-holiday')).toMatchObject({ debtFallCents: fall, recentRateCents: fall, status: 'projected' })
})

test('debt paid off is reached', async () => {
  const id = await newDebt({ rateBp: 0, balanceCents: 500_000 })
  await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id, targetDate: '2027-06-30' })
  expect((await goalOf('acc-holiday')).status).toBe('behind')
  expect((await pay(id, 500_000)).status).toBe(204)
  expect(await goalOf('acc-holiday')).toMatchObject({
    goal: { targetCents: 0 },
    status: 'reached',
    progress: 1,
    toGoCents: null,
    expectedProgress: null,
    debt: { leftCents: 0, startTargetCents: 500_000, paidOff: true },
  })
})

test('link rules', async () => {
  const mine = await newDebt()
  const joint = await newDebt({ ownerUserId: null, name: 'Joint loan' })
  const theirs = await newDebt({ ownerUserId: partnerId, name: 'Their loan' }, partner)
  const debtGoal = (debtId?: string) => ({ kind: 'debt', name: 'Pay it', debtId })
  expect(await put('acc-holiday', debtGoal(theirs))).toMatchObject({
    status: 400,
    body: { error: "This Saver can only follow Owner's debts or joint debts." },
  })
  expect(await put('acc-j-saver', debtGoal(mine))).toMatchObject({
    status: 400,
    body: { error: 'A joint Saver can only follow a joint debt.' },
  })
  expect((await put('acc-j-saver', debtGoal(joint))).status).toBe(204)
  expect(await put('acc-holiday', debtGoal())).toMatchObject({ status: 400, body: { error: 'Choose a debt.' } })
  expect(await put('acc-holiday', debtGoal(''))).toMatchObject({ status: 400, body: { error: 'Choose a debt.' } })
  expect(await put('acc-holiday', debtGoal('nope'))).toMatchObject({ status: 404, body: { error: 'Debt not found' } })
  // A debt the viewer can't see looks the same as one that doesn't exist.
  setLevel(partnerId, 'balances')
  expect(await put('acc-holiday', debtGoal(theirs))).toMatchObject({ status: 404, body: { error: 'Debt not found' } })
  // A debt goal allows a date; a past one is refused as for Save up to.
  expect(await put('acc-holiday', { ...debtGoal(mine), targetDate: '2026-10-01' })).toMatchObject({
    status: 400,
    body: { error: "Target date can't be in the past." },
  })
})

test('one Saver per debt', async () => {
  seedAccount(t.db, { id: 'acc-car', owner: ownerId, type: 'SAVER', name: 'Car' })
  const id = await newDebt()
  const debtGoal = { kind: 'debt', name: 'Pay it', debtId: id }
  expect((await put('acc-holiday', debtGoal)).status).toBe(204)
  expect(await put('acc-car', debtGoal)).toMatchObject({
    status: 400,
    body: { error: 'Holiday already follows Car loan.' },
  })
  expect((await put('acc-holiday', { ...debtGoal, name: 'Renamed' })).status).toBe(204)

  // A follower the viewer can't see isn't named.
  const joint = await newDebt({ ownerUserId: null, name: 'Joint loan' })
  expect((await put('acc-p-saver', { ...debtGoal, debtId: joint }, partner)).status).toBe(204)
  expect(await put('acc-car', { ...debtGoal, debtId: joint })).toMatchObject({
    status: 400,
    body: { error: 'Car fund already follows Joint loan.' },
  })
  setLevel(partnerId, 'balances')
  expect(await put('acc-car', { ...debtGoal, debtId: joint })).toMatchObject({
    status: 400,
    body: { error: 'Another Saver already follows Joint loan.' },
  })
})

test('changing to another kind frees the debt and clears the followed name', async () => {
  const id = await newDebt()
  await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
  t.db.update(s.goals).set({ followedDebtName: 'Old loan' }).where(eq(s.goals.accountId, 'acc-holiday')).run()
  expect((await put('acc-holiday', holiday)).status).toBe(204)
  expect(t.db.select().from(s.goals).where(eq(s.goals.accountId, 'acc-holiday')).get()).toMatchObject({
    kind: 'save',
    debtId: null,
    startTargetCents: null,
    followedDebtName: null,
  })
  seedAccount(t.db, { id: 'acc-car', owner: ownerId, type: 'SAVER', name: 'Car' })
  expect((await put('acc-car', { kind: 'debt', name: 'Car', debtId: id })).status).toBe(204)
})

test('renaming keeps the start', async () => {
  const dated = { name: 'Holiday', targetCents: 100_000, targetDate: '2026-12-31' }
  expect((await put('acc-holiday', dated)).status).toBe(204)
  expect(await goalOf('acc-holiday')).toMatchObject({ status: 'behind', expectedProgress: 0.62 })
  t.db.update(s.accounts).set({ balanceCents: 80_000 }).where(eq(s.accounts.id, 'acc-holiday')).run()
  expect((await put('acc-holiday', { ...dated, name: 'Japan' })).status).toBe(204)
  expect((await goalOf('acc-holiday')).expectedProgress).toBe(0.62)
  expect((await put('acc-holiday', { ...dated, name: 'Japan', targetDate: '2027-01-31' })).status).toBe(204)
  expect((await goalOf('acc-holiday')).expectedProgress).toBe(0.8)
})

test('expected progress only for on-track or behind goals', async () => {
  await put('acc-holiday', holiday)
  expect(await goalOf('acc-holiday')).toMatchObject({ status: 'not-growing', expectedProgress: null })
})

test('debt options', async () => {
  const mine = await newDebt()
  const joint = await newDebt({ ownerUserId: null, name: 'Joint loan' })
  await newDebt({ ownerUserId: partnerId, name: 'Their loan' }, partner)
  const options = (accountId: string, cookie = owner) => call(`/api/goals/${accountId}/debts`, { cookie })
  expect((await put('acc-p-saver', { kind: 'debt', name: 'Joint', debtId: joint }, partner)).status).toBe(204)
  expect((await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: mine })).status).toBe(204)

  expect(await options('acc-holiday')).toEqual({
    status: 200,
    body: [
      { id: mine, name: 'Car loan', leftCents: await leftOn(mine), followedBy: null },
      { id: joint, name: 'Joint loan', leftCents: await leftOn(joint), followedBy: 'Car fund' },
    ],
  })
  expect((await options('acc-j-saver')).body).toEqual([
    { id: joint, name: 'Joint loan', leftCents: await leftOn(joint), followedBy: 'Car fund' },
  ])
  expect((await options('acc-p-saver', partner)).body.map((d: { name: string }) => d.name)).toEqual([
    'Joint loan',
    'Their loan',
  ])
  expect(await options('acc-p-saver')).toMatchObject({ status: 403, body: { error: 'Only Partner can edit that.' } })
  expect(await options('acc-spend')).toMatchObject({ status: 400, body: { error: 'Goals can only be set on Savers.' } })
  expect(await options('acc-nope')).toMatchObject({ status: 404, body: { error: 'Saver not found' } })

  // A follower whose Saver the viewer can no longer see, or that has gone, isn't named.
  setLevel(partnerId, 'balances')
  expect(await options('acc-p-saver')).toMatchObject({ status: 404, body: { error: 'Saver not found' } })
  expect((await options('acc-j-saver')).body[0].followedBy).toBe('another Saver')
  setLevel(partnerId, 'full')
  t.db.delete(s.accounts).where(eq(s.accounts.id, 'acc-p-saver')).run()
  expect((await options('acc-j-saver')).body[0].followedBy).toBe('another Saver')
})

test('fund caption follows a debt goal', async () => {
  const id = await newDebt({ balanceCents: 124_000, rateBp: 0 })
  await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
  expect(goalCaption(t.db, 'acc-holiday', TODAY, TZ)).toEqual({ name: 'Car', percent: 50, reached: false })
  await pay(id, 62_000)
  expect(goalCaption(t.db, 'acc-holiday', TODAY, TZ)).toEqual({ name: 'Car', percent: 100, reached: true })
})

test('deleting a followed debt keeps the goal', async () => {
  const id = await newDebt()
  await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
  expect((await pay(id, 100_000)).status).toBe(204)
  const left = await leftOn(id)
  expect((await call(`/api/debts/${id}`, { method: 'DELETE' })).status).toBe(204)
  expect(await goalOf('acc-holiday')).toMatchObject({
    goal: { kind: 'save', targetCents: left },
    debt: null,
    followedDebtName: 'Car loan',
  })
  expect(t.db.select().from(s.goals).where(eq(s.goals.accountId, 'acc-holiday')).get()).toMatchObject({
    debtId: null,
    startTargetCents: null,
  })
  expect((await put('acc-holiday', { name: 'Car', targetCents: left })).status).toBe(204)
  expect((await goalOf('acc-holiday')).followedDebtName).toBeNull()
})

test('deleting an unfollowed debt leaves other goals alone', async () => {
  const id = await newDebt()
  await put('acc-holiday', holiday)
  expect((await call(`/api/debts/${id}`, { method: 'DELETE' })).status).toBe(204)
  expect(await goalOf('acc-holiday')).toMatchObject({ goal: { kind: 'save', targetCents: 100_000 }, followedDebtName: null })
})

test('a Saver name keeps its capitals in the already-follows error', async () => {
  seedAccount(t.db, { id: 'acc-isaver', owner: ownerId, type: 'SAVER', name: 'iSaver' })
  seedAccount(t.db, { id: 'acc-car', owner: ownerId, type: 'SAVER', name: 'Car' })
  const id = await newDebt()
  const debtGoal = { kind: 'debt', name: 'Pay it', debtId: id }
  expect((await put('acc-isaver', debtGoal)).status).toBe(204)
  expect(await put('acc-car', debtGoal)).toMatchObject({
    status: 400,
    body: { error: 'iSaver already follows Car loan.' },
  })
})

test('re-saving a debt goal after a payment keeps its start', async () => {
  const id = await newDebt()
  const body = { kind: 'debt', name: 'Car', debtId: id, targetDate: '2026-12-31' }
  await put('acc-holiday', body)
  const start = (await goalOf('acc-holiday')).debt!.startTargetCents
  const row = () => t.db.select().from(s.goals).where(eq(s.goals.accountId, 'acc-holiday')).get()!
  const before = row()
  expect((await pay(id, 100_000)).status).toBe(204)
  expect((await put('acc-holiday', body)).status).toBe(204)
  expect((await goalOf('acc-holiday')).debt!.startTargetCents).toBe(start)
  expect(row()).toMatchObject({ startTargetCents: before.startTargetCents, startedAt: before.startedAt })
})

test('changing a Save up to target resets the start', async () => {
  const dated = { name: 'Holiday', targetCents: 100_000, targetDate: '2026-12-31' }
  await put('acc-holiday', dated)
  expect((await goalOf('acc-holiday')).expectedProgress).toBe(0.62)
  t.db.update(s.accounts).set({ balanceCents: 80_000 }).where(eq(s.accounts.id, 'acc-holiday')).run()
  expect((await put('acc-holiday', { ...dated, targetCents: 120_000 })).status).toBe(204)
  expect(t.db.select().from(s.goals).where(eq(s.goals.accountId, 'acc-holiday')).get()).toMatchObject({
    startCents: 80_000,
  })
})

describe('plan amounts', () => {
  const template = (userId: string, items: PlanItemInput[]) =>
    putTemplate(t.db, userId, { expectedIncomeCents: 400_000, items }, NOW, TZ)
  const planOn = (userId: string, saverAccountId: string, amountCents: number) =>
    template(userId, [{ targetKind: 'saver', lineId: null, saverAccountId, amountCents }])
  const PAY_CADENCE = { kind: 'pay', frequencyDays: 14, lastPayDate: '2026-10-23' }
  /** A goal on the joint Saver: the owner, the Joint anchor, is paid every 14 days and the partner every 7. */
  const jointGoal = async () => {
    await call('/api/budgets')
    schedule(ownerId, 14)
    schedule(partnerId, 7)
    seedEvents(t.db, ownerId, PAYDAYS)
    expect((await put('acc-j-saver', holiday)).status).toBe(204)
  }

  test('plan on a personal Saver', async () => {
    schedule(ownerId, 14)
    seedEvents(t.db, ownerId, PAYDAYS)
    planOn(ownerId, 'acc-holiday', 20_000)
    await put('acc-holiday', holiday)
    const g = await goalOf('acc-holiday')
    expect(g.plan).toEqual({
      amountCents: 20_000,
      mineCents: 20_000,
      partnerCents: null,
      partnerName: null,
      partial: false,
    })
    // toEqual, so the paydays behind the cadence stay on the server.
    expect(g.cadence).toEqual(PAY_CADENCE)
    expect(g.today).toBe(TODAY)
    expect(g.saverOutCents).toBeNull()
  })

  test('plan through a bucket', async () => {
    const mine = ((await call('/api/budgets')).body as BudgetDto[]).find((b) => b.name === 'Mine')!
    const line = await call(`/api/budgets/${mine.id}/lines`, {
      method: 'POST',
      body: { kind: 'fund', name: 'Holiday', amountCents: 10_000, categoryIds: [], saverAccountId: 'acc-holiday' },
    })
    expect(line.status).toBe(201)
    template(ownerId, [{ targetKind: 'line', lineId: line.body.id, saverAccountId: null, amountCents: 15_000 }])
    await put('acc-holiday', holiday)
    expect((await goalOf('acc-holiday')).plan).toMatchObject({ amountCents: 15_000, mineCents: 15_000 })
  })

  test('joint Saver adds both plans across pay cycles', async () => {
    await jointGoal()
    planOn(ownerId, 'acc-j-saver', 16_000)
    planOn(partnerId, 'acc-j-saver', 5_000)
    const seenByOwner = await goalOf('acc-j-saver')
    expect(seenByOwner.cadence).toEqual(PAY_CADENCE)
    expect(seenByOwner.plan).toEqual({
      amountCents: 26_000,
      mineCents: 16_000,
      partnerCents: 10_000,
      partnerName: 'Partner',
      partial: false,
    })
    const seenByPartner = await goalOf('acc-j-saver', partner)
    expect(seenByPartner.cadence).toEqual(PAY_CADENCE)
    expect(seenByPartner.plan).toEqual({
      amountCents: 26_000,
      mineCents: 10_000,
      partnerCents: 16_000,
      partnerName: 'Owner',
      partial: false,
    })
  })

  test('only one person has planned on a joint Saver', async () => {
    await jointGoal()
    planOn(ownerId, 'acc-j-saver', 16_000)
    expect((await goalOf('acc-j-saver')).plan).toEqual({
      amountCents: 16_000,
      mineCents: 16_000,
      partnerCents: null,
      partnerName: null,
      partial: false,
    })
    expect((await goalOf('acc-j-saver', partner)).plan).toEqual({
      amountCents: 16_000,
      mineCents: 0,
      partnerCents: 16_000,
      partnerName: 'Owner',
      partial: false,
    })
  })

  test('monthly cadence converts', async () => {
    schedule(ownerId, 14)
    planOn(ownerId, 'acc-holiday', 10_000)
    await put('acc-holiday', holiday)
    const g = await goalOf('acc-holiday')
    expect(g.cadence).toEqual({ kind: 'month' })
    expect(g.plan).toMatchObject({ amountCents: 21_726, mineCents: 21_726 })
  })

  test('no schedule means no conversion', async () => {
    planOn(ownerId, 'acc-holiday', 10_000)
    await put('acc-holiday', holiday)
    const g = await goalOf('acc-holiday')
    expect(g.cadence).toEqual({ kind: 'month' })
    expect(g.plan).toMatchObject({ amountCents: 10_000 })
  })

  test.each(['balances', 'none', null])('a partner hiding finances at %s leaves their plan out', async (level) => {
    await jointGoal()
    planOn(ownerId, 'acc-j-saver', 16_000)
    planOn(partnerId, 'acc-j-saver', 5_000)
    setLevel(partnerId, level)
    const hidden = {
      amountCents: 16_000,
      mineCents: 16_000,
      partnerCents: null,
      partnerName: null,
      partial: true,
    }
    expect((await goalOf('acc-j-saver')).plan).toEqual(hidden)
    // Nothing tells a partner who planned something from one who didn't.
    template(partnerId, [])
    expect((await goalOf('acc-j-saver')).plan).toEqual(hidden)
    planOn(partnerId, 'acc-j-saver', 5_000)
    template(ownerId, [])
    expect((await goalOf('acc-j-saver')).plan).toBeNull()
  })

  test('a partner sharing finances but not transactions still shows their plan', async () => {
    await jointGoal()
    planOn(partnerId, 'acc-j-saver', 5_000)
    setLevel(partnerId, 'hide-transactions')
    expect((await goalOf('acc-j-saver')).plan).toEqual({
      amountCents: 10_000,
      mineCents: 0,
      partnerCents: 10_000,
      partnerName: 'Partner',
      partial: false,
    })
  })

  test("a partner's own Saver", async () => {
    planOn(partnerId, 'acc-p-saver', 8_000)
    expect((await put('acc-p-saver', holiday, partner)).status).toBe(204)
    expect((await goalOf('acc-p-saver')).plan).toEqual({
      amountCents: 8_000,
      mineCents: 0,
      partnerCents: 8_000,
      partnerName: 'Partner',
      partial: false,
    })
    expect((await goalOf('acc-p-saver', partner)).plan).toEqual({
      amountCents: 8_000,
      mineCents: 8_000,
      partnerCents: null,
      partnerName: null,
      partial: false,
    })
  })

  test('no plan', async () => {
    await put('acc-holiday', holiday)
    expect((await goalOf('acc-holiday')).plan).toBeNull()
    template(ownerId, [])
    expect((await goalOf('acc-holiday')).plan).toBeNull()
    planOn(ownerId, 'acc-holiday', 0)
    const g = await goalOf('acc-holiday')
    expect(g.plan).toBeNull()
    expect(g.cadence).toEqual({ kind: 'month' })
  })

  test('a Saver with no goal, and a goal whose Saver has gone, have no plan or cadence', async () => {
    planOn(ownerId, 'acc-holiday', 20_000)
    expect(await goalOf('acc-holiday')).toMatchObject({ goal: null, plan: null, cadence: null, today: TODAY })
    await put('acc-holiday', holiday)
    t.db.delete(s.accounts).where(eq(s.accounts.id, 'acc-holiday')).run()
    expect(await goalOf('acc-holiday')).toMatchObject({ accountMissing: true, plan: null, cadence: null, today: TODAY })
  })

  test('a buffer has a plan and cadence', async () => {
    schedule(ownerId, 14)
    seedEvents(t.db, ownerId, PAYDAYS)
    planOn(ownerId, 'acc-holiday', 20_000)
    await put('acc-holiday', { kind: 'buffer', name: 'Food', targetCents: 70_000 })
    const g = await goalOf('acc-holiday')
    expect(g).toMatchObject({ status: 'below', belowCents: 8_000, saverOutCents: null, today: TODAY })
    expect(g.plan).toMatchObject({ amountCents: 20_000 })
    expect(g.cadence).toEqual(PAY_CADENCE)
  })

  test('money out on a debt goal', async () => {
    schedule(ownerId, 14)
    seedEvents(t.db, ownerId, PAYDAYS)
    PAYDAYS.slice(0, 3).forEach((d, i) => {
      seedTx(t.db, { id: `out${i}`, accountId: 'acc-holiday', amountCents: -30_000, createdAt: local(d, '10:00') })
      seedTx(t.db, { id: `in${i}`, accountId: 'acc-holiday', amountCents: 5_000, createdAt: local(d, '10:30') })
      seedTx(t.db, {
        id: `ru${i}`,
        accountId: 'acc-holiday',
        amountCents: -196,
        createdAt: local(d, '11:00'),
        transactionType: 'Round Up',
      })
    })
    const id = await newDebt()
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
    expect((await goalOf('acc-holiday')).saverOutCents).toBe(30_000)
    await put('acc-holiday', holiday)
    expect((await goalOf('acc-holiday')).saverOutCents).toBeNull()
  })

  test('real DTOs agree with the web plan maths', async () => {
    const dated = { name: 'Holiday', targetCents: 124_000, targetDate: '2026-12-31' }
    const agree = (g: GoalDto, per: string) => {
      const enough = g.neededCents! - otherRate(g)
      expect(tryResult(g, enough)).toMatch(/^Enough/)
      expect(tryResult(g, enough - 100)).toBe(`Short by $1.00 ${per}`)
    }
    // A pay goal.
    schedule(ownerId, 14)
    seedEvents(t.db, ownerId, PAYDAYS)
    planOn(ownerId, 'acc-holiday', 20_000)
    await put('acc-holiday', dated)
    const payGoal = await goalOf('acc-holiday')
    expect(payGoal.cadence?.kind).toBe('pay')
    agree(payGoal, 'a pay')
    // A debt goal on the same pay cadence, with money leaving the Saver.
    const id = await newDebt({ rateBp: 0, balanceCents: 500_000 })
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id, targetDate: '2026-12-31' })
    seedTx(t.db, { id: 'out1', accountId: 'acc-holiday', amountCents: -30_000, createdAt: local(PAYDAYS[2]!, '10:00') })
    const debtGoal = await goalOf('acc-holiday')
    expect(debtGoal.goal?.kind).toBe('debt')
    agree(debtGoal, 'a pay')
    expect(planComparison(debtGoal)).not.toBeNull()
    // A month goal: the partner has no pay schedule.
    planOn(partnerId, 'acc-p-saver', 10_000)
    await put('acc-p-saver', dated, partner)
    const monthGoal = await goalOf('acc-p-saver', partner)
    expect(monthGoal.cadence).toEqual({ kind: 'month' })
    agree(monthGoal, 'a month')
  })

  test("a joint plan converts to the new Joint anchor's cadence", async () => {
    await jointGoal()
    planOn(ownerId, 'acc-j-saver', 16_000)
    const before = await goalOf('acc-j-saver')
    expect(before.cadence).toEqual(PAY_CADENCE)
    expect(before.plan?.amountCents).toBe(16_000)
    seedEvents(t.db, partnerId, ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23'])
    const jointId = listBudgetRows(t.db).find((b) => b.kind === 'joint')!.id
    setJointAnchor(t.db, jointId, partnerId, '2026-10-02')
    const after = await goalOf('acc-j-saver')
    expect(after.cadence).toEqual({ kind: 'pay', frequencyDays: 7, lastPayDate: '2026-10-23' })
    expect(after.plan?.amountCents).toBe(8_000)
  })
})

describe('sparklines', () => {
  const deposit = (id: string, cents: number, date: string, accountId = 'acc-holiday') =>
    seedTx(t.db, { id, accountId, amountCents: cents, createdAt: local(date, '10:00') })
  /** A Saver whose history is complete: 50,000 at the start, then 10,000 and 2,000 for 62,000 today. */
  const history = () => {
    deposit('open', 50_000, '2026-06-01')
    deposit('d1', 10_000, '2026-10-20')
    deposit('d2', 2_000, '2026-10-27')
  }

  test('sparkline follows the balance', async () => {
    history()
    await put('acc-holiday', holiday)
    const { sparkline } = await goalOf('acc-holiday')
    expect(sparkline!.balance.at(-1)).toBe(62_000)
    // Weekly points back from 30 Oct: 16 Oct is before the 20 Oct deposit.
    expect(sparkline!.balance.at(-3)).toBe(50_000)
    expect(sparkline!.balance.at(-2)).toBe(60_000)
    expect(sparkline!.target).toBeNull()
  })

  test('debt goal sparkline has the debt', async () => {
    history()
    const id = await newDebt()
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
    const g = await goalOf('acc-holiday')
    expect(g.sparkline!.target!.at(-1)).toBe(g.debt!.leftCents)
    expect(g.sparkline!.target!).toHaveLength(g.sparkline!.balance.length)
  })

  test('buffer sparkline has the level', async () => {
    history()
    await put('acc-holiday', { kind: 'buffer', name: 'Food', targetCents: 70_000 })
    const { sparkline } = await goalOf('acc-holiday')
    expect(sparkline!.target!.length).toBeGreaterThan(1)
    expect(sparkline!.target!.every((v) => v === 70_000)).toBe(true)
  })

  test('early history is not invented', async () => {
    t.db.update(s.accounts).set({ balanceCents: 500_000 }).where(eq(s.accounts.id, 'acc-holiday')).run()
    deposit('d1', 1_000, '2026-10-20')
    await put('acc-holiday', holiday)
    const g = await goalOf('acc-holiday')
    expect(g.sparkline!.balance.length).toBe(2)
    expect(g.sparkline!.balance.at(-1)).toBe(500_000)
    // Points start at the first transaction's week, not six months back.
    expect(g.sparkline!.balance[0]).toBe(500_000)
  })

  test('a new Saver has no sparkline', async () => {
    await put('acc-p-saver', holiday, partner)
    const g = await goalOf('acc-p-saver')
    expect(g.sparkline).toBeNull()
    expect(g.goal?.name).toBe('Holiday')
  })
})

describe('goal page', () => {
  const page = async (accountId: string, query = '', cookie = owner) => {
    const res = await call(`/api/goals/${accountId}${query}`, { cookie })
    return { status: res.status, body: res.body as GoalDetailDto }
  }
  const NOT_FOUND = { status: 404, body: { error: 'Goal not found' } }
  const tx = (id: string, cents: number, date: string, accountId = 'acc-holiday') =>
    seedTx(t.db, { id, accountId, amountCents: cents, createdAt: local(date, '10:00') })
  /** 62,000 built from an opening deposit in June, then 15,000 in and 3,000 out this month. */
  const history = () => {
    tx('open', 50_000, '2026-06-01')
    tx('d1', 10_000, '2026-10-20')
    tx('out', -3_000, '2026-10-22')
    tx('d2', 5_000, '2026-10-27')
  }
  /** The rows the Money in and out table would list for a month. */
  const rowsIn = async (m: GoalDetailDto['months'][number], accountId = 'acc-holiday') => {
    const query = new URLSearchParams({ accountId, from: m.fromIso, to: m.toIso })
    const { items } = (await call(`/api/transactions?${query}`)).body as TransactionPage
    return items.map((i) => i.id).sort()
  }

  test('goal page for a save goal', async () => {
    history()
    tx('gone', 99_999, '2026-10-21')
    t.db.update(s.transactions).set({ deletedAt: NOW.toISOString() }).where(eq(s.transactions.id, 'gone')).run()
    await put('acc-holiday', { name: 'Holiday', targetCents: 100_000, targetDate: '2026-12-31' })
    t.db
      .update(s.goals)
      .set({ startCents: 20_000, startedAt: '2026-07-01T02:00:00.000Z' })
      .where(eq(s.goals.accountId, 'acc-holiday'))
      .run()
    const { status, body } = await page('acc-holiday')
    expect(status).toBe(200)
    expect(body).toMatchObject({
      range: '6m',
      goal: { accountId: 'acc-holiday', goal: { kind: 'save', name: 'Holiday' }, balanceCents: 62_000 },
      expected: { from: { date: '2026-07-01', cents: 20_000 }, to: { date: '2026-12-31', cents: 100_000 } },
      projected: null,
      debt: null,
      transactionsHidden: false,
    })
    expect(body.points.every((p) => p.targetCents === 100_000)).toBe(true)
    expect(body.points.at(-1)).toEqual({ date: TODAY, balanceCents: 62_000, targetCents: 100_000 })
    expect(body.months).toEqual([
      {
        month: '2026-10',
        fromIso: '2026-09-30T14:00:00.000Z',
        toIso: '2026-10-31T13:00:00.000Z',
        inCents: 15_000,
        outCents: 3_000,
      },
      {
        month: '2026-06',
        fromIso: '2026-05-31T14:00:00.000Z',
        toIso: '2026-06-30T14:00:00.000Z',
        inCents: 50_000,
        outCents: 0,
      },
    ])
  })

  test('a point mid-range counts a round-up and leaves out a deleted transaction, as Net worth does', async () => {
    tx('open', 50_000, '2026-06-01')
    tx('d1', 10_000, '2026-10-20')
    tx('buy', -3_000, '2026-10-22')
    tx('d2', 5_000, '2026-10-27')
    tx('gone', 99_999, '2026-10-21')
    t.db.update(s.transactions).set({ deletedAt: NOW.toISOString() }).where(eq(s.transactions.id, 'gone')).run()
    t.db.update(s.transactions).set({ roundUpCents: -200 }).where(eq(s.transactions.id, 'buy')).run()
    t.db.update(s.accounts).set({ balanceCents: 61_800 }).where(eq(s.accounts.id, 'acc-holiday')).run()
    await put('acc-holiday', { name: 'Holiday', targetCents: 100_000, targetDate: '2026-12-31' })
    const { body } = await page('acc-holiday')
    // End of 23 Oct: the opening deposit, 20 Oct's, and the purchase with its round-up.
    expect(body.points.find((p) => p.date === '2026-10-23')!.balanceCents).toBe(56_800)
    // Rebuilt backwards from today, so a point before the purchase takes it, and its round-up, back off.
    expect(body.points.find((p) => p.date === '2026-10-16')!.balanceCents).toBe(50_000)
    expect(body.points.at(-1)!.balanceCents).toBe(61_800)
  })

  test('ranges', async () => {
    tx('old', 40_000, '2025-11-15')
    tx('jun', 10_000, '2026-06-15')
    tx('jul', 12_000, '2026-07-02')
    await put('acc-holiday', holiday)
    const [three, six, year, all] = await Promise.all(
      ['3m', '', '1y', 'all'].map(async (r) => (await page('acc-holiday', r && `?range=${r}`)).body),
    )
    expect(three!.range).toBe('3m')
    expect(six!.range).toBe('6m')
    expect(three!.points.length).toBeLessThan(six!.points.length)
    expect(six!.points.length).toBeLessThan(year!.points.length)
    expect(all!.range).toBe('all')
    // The first transaction's day starts it, then the month ends.
    expect(all!.points.slice(0, 2).map((p) => p.date)).toEqual(['2025-11-15', '2025-11-30'])
    expect(all!.points[0]!.balanceCents).toBe(40_000)
    expect(three!.months.map((m) => m.month)).toEqual(['2026-07'])
    expect(six!.months.map((m) => m.month)).toEqual(['2026-07', '2026-06'])
    expect(year!.months.map((m) => m.month)).toEqual(['2026-07', '2026-06', '2025-11'])
    expect(all!.months.map((m) => m.month)).toEqual(['2026-07', '2026-06', '2025-11'])
    expect((await page('acc-holiday', '?range=5y')).status).toBe(400)
  })

  test('the oldest month is whole, so its totals match its rows', async () => {
    // 3 months back from 30 Oct is 30 Jul; a deposit earlier that month is still July's, and June's isn't listed.
    tx('jun', 1_000, '2026-06-30')
    tx('jul-early', 12_000, '2026-07-02')
    tx('jul-late', 3_000, '2026-07-31')
    await put('acc-holiday', holiday)
    const { months } = (await page('acc-holiday', '?range=3m')).body
    expect(months).toMatchObject([{ month: '2026-07', inCents: 15_000, outCents: 0 }])
    expect(await rowsIn(months[0]!)).toEqual(['jul-early', 'jul-late'])
  })

  test('a month in local time', async () => {
    // 00:30 on 1 Oct in Sydney, but still September in UTC.
    seedTx(t.db, { id: 'midnight', accountId: 'acc-holiday', amountCents: 7_000, createdAt: '2026-09-30T14:30:00Z' })
    // 23:30 on 30 Sep in Sydney.
    seedTx(t.db, { id: 'sep', accountId: 'acc-holiday', amountCents: 500, createdAt: '2026-09-30T13:30:00Z' })
    const { months } = (await page('acc-holiday')).body
    expect(months.map((m) => [m.month, m.inCents])).toEqual([
      ['2026-10', 7_000],
      ['2026-09', 500],
    ])
    const [october, september] = months
    expect(october!.fromIso <= '2026-09-30T14:30:00Z' && '2026-09-30T14:30:00Z' < october!.toIso).toBe(true)
    expect(await rowsIn(october!)).toEqual(['midnight'])
    expect(await rowsIn(september!)).toEqual(['sep'])
  })

  test('goal page for a debt goal', async () => {
    const id = await newDebt({ asOf: '2026-07-01' })
    // The Saver also grows, so the two lines meet partway.
    tx('jul', 6_000, '2026-07-15')
    tx('aug', 6_000, '2026-08-15')
    tx('sep', 6_000, '2026-09-15')
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
    const { body } = await page('acc-holiday')
    const { goal } = body
    expect(goal.status).toBe('projected')
    expect(body.points.at(-1)!.targetCents).toBe(goal.debt!.leftCents)
    expect(body.debt).toEqual({
      id,
      name: 'Car loan',
      leftCents: goal.debt!.leftCents,
      startTargetCents: goal.debt!.startTargetCents,
      fallCents: goal.debtFallCents,
      nextDue: '2026-11-01',
    })
    expect(body.debt!.fallCents).toBeGreaterThan(0)
    expect(body.expected).toBeNull()
    const combined = goal.recentRateCents!
    const net = combined - goal.debtFallCents!
    expect(net).toBe(6_000)
    expect(body.projected).toEqual({
      date: goal.projectedDate,
      saverCents: Math.round(62_000 + (goal.toGoCents! * net) / combined),
    })
    expect(body.projected!.saverCents).toBeGreaterThan(62_000)
    expect(body.projected!.saverCents).toBeLessThan(goal.goal!.targetCents)
  })

  test("a debt goal's projection stops at the target when the debt is growing", async () => {
    // Interest outruns the repayment, so the Saver's own rate is more than the combined rate.
    const id = await newDebt({ asOf: '2026-07-01', rateBp: 2_000, repaymentCents: 100 })
    tx('jul', 900_000, '2026-07-15')
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
    const { goal, projected } = (await page('acc-holiday')).body
    expect(goal.status).toBe('projected')
    expect(goal.debtFallCents!).toBeLessThan(0)
    expect(projected!.saverCents).toBe(goal.goal!.targetCents)
  })

  test("a debt goal's projection stops at $0 when the Saver is draining", async () => {
    // The debt falls fast enough that the goal still closes while money leaves the Saver.
    const id = await newDebt({ asOf: '2026-07-01', rateBp: 0, repaymentCents: 90_000 })
    tx('jul', -12_000, '2026-07-15')
    t.db.update(s.accounts).set({ balanceCents: 10_000 }).where(eq(s.accounts.id, 'acc-holiday')).run()
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
    const { goal, projected } = (await page('acc-holiday')).body
    expect(goal.status).toBe('projected')
    expect(goal.recentRateCents! - goal.debtFallCents!).toBe(-4_000)
    expect(projected!.saverCents).toBe(0)
  })

  test('the projection holds still on a combined rate of 0', () => {
    expect(projectedSaverCents(10_000, 50_000, 0, 0)).toBe(10_000)
    expect(projectedSaverCents(60_000, 50_000, 0, 0)).toBe(50_000)
    expect(projectedSaverCents(-5_000, 50_000, 0, 0)).toBe(0)
    // Half the rate is the Saver's, so it covers half the gap.
    expect(projectedSaverCents(10_000, 50_000, 2_000, 1_000)).toBe(30_000)
  })

  test('a debt newer than the chart starts when the debt does', async () => {
    history()
    const id = await newDebt({ asOf: '2026-10-01' })
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id, targetDate: '2027-06-30' })
    const { body } = await page('acc-holiday')
    expect(body.points[0]!.targetCents).toBeNull()
    expect(body.points.at(-1)!.targetCents).toBe(body.debt!.leftCents)
    expect(body.expected).toEqual({
      from: { date: TODAY, cents: 62_000 },
      to: { date: '2027-06-30', cents: body.debt!.leftCents },
    })
    expect(body.projected).toBeNull()
  })

  test('next due follows the schedule, and a debt with no starting point has none', async () => {
    const id = await newDebt({ asOf: '2026-10-01', repaymentFrequency: 'fortnightly' })
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
    // 1 Oct, then every 14 days: 15 Oct, 29 Oct, 12 Nov.
    expect((await page('acc-holiday')).body.debt!.nextDue).toBe('2026-11-12')
    t.db.delete(s.debtBalances).where(eq(s.debtBalances.debtId, id)).run()
    const { status, body } = await page('acc-holiday')
    expect(status).toBe(200)
    expect(body.debt).toMatchObject({ id, leftCents: 0, nextDue: null })
  })

  test('no goal', async () => {
    history()
    const { status, body } = await page('acc-holiday')
    expect(status).toBe(200)
    expect(body).toMatchObject({ goal: { goal: null }, expected: null, projected: null, debt: null })
    expect(body.points.length).toBeGreaterThan(1)
    expect(body.points.every((p) => p.targetCents === null)).toBe(true)
    expect(body.months.map((m) => m.month)).toEqual(['2026-10', '2026-06'])
  })

  test('a Saver with no transactions', async () => {
    expect((await page('acc-p-saver')).body).toMatchObject({
      goal: { goal: null },
      points: [{ date: TODAY, balanceCents: 0, targetCents: null }],
      months: [],
    })
  })

  test('a buffer has a flat level and no paths', async () => {
    history()
    await put('acc-holiday', { kind: 'buffer', name: 'Food', targetCents: 40_000 })
    const { body } = await page('acc-holiday')
    expect(body).toMatchObject({ expected: null, projected: null, debt: null })
    expect(body.points.every((p) => p.targetCents === 40_000)).toBe(true)
  })

  test('the built-in goal has a page', async () => {
    seedAccount(t.db, { id: 'acc-challenge', owner: ownerId, type: 'SAVER', name: 'Save Up Challenge', balanceCents: 25_000 })
    const { body } = await page('acc-challenge')
    expect(body).toMatchObject({ goal: { goal: { isDefault: true } }, expected: null })
    expect(body.points.at(-1)!.targetCents).toBe(100_000)
  })

  test('expected and projected follow the status', async () => {
    tx('jul', 10_000, '2026-07-15')
    await put('acc-holiday', holiday)
    // Undated and growing: a save goal's Saver reaches the target itself.
    const growing = (await page('acc-holiday')).body
    expect(growing.goal.status).toBe('projected')
    expect(growing.expected).toBeNull()
    expect(growing.projected).toEqual({ date: growing.goal.projectedDate, saverCents: 100_000 })

    // Undated and not growing: nothing to project.
    t.db.delete(s.transactions).where(eq(s.transactions.id, 'jul')).run()
    expect((await page('acc-holiday')).body).toMatchObject({ goal: { status: 'not-growing' }, projected: null, expected: null })

    // Reached, with a date still ahead.
    await put('acc-holiday', { name: 'Holiday', targetCents: 50_000, targetDate: '2026-12-31' })
    expect((await page('acc-holiday')).body).toMatchObject({ goal: { status: 'reached' }, expected: null, projected: null })

    // The date has passed.
    t.db.update(s.goals).set({ targetCents: 100_000, targetDate: '2026-10-01' }).where(eq(s.goals.accountId, 'acc-holiday')).run()
    expect((await page('acc-holiday')).body).toMatchObject({ goal: { status: 'date-passed' }, expected: null, projected: null })
  })

  test('not a Saver', async () => {
    expect(await page('acc-spend')).toEqual(NOT_FOUND)
  })

  test('missing', async () => {
    expect(await page('acc-nope')).toEqual(NOT_FOUND)
    // A goal whose Saver has gone has no page either.
    await put('acc-holiday', holiday)
    t.db.delete(s.accounts).where(eq(s.accounts.id, 'acc-holiday')).run()
    expect(await page('acc-holiday')).toEqual(NOT_FOUND)
  })

  describe('sharing', () => {
    const seedPartner = async () => {
      seedTx(t.db, {
        id: 'p-in',
        accountId: 'acc-p-saver',
        amountCents: 8_000,
        createdAt: local('2026-10-05', '10:00'),
        description: 'ZZSECRETSHOP',
      })
      expect((await put('acc-p-saver', holiday, partner)).status).toBe(204)
    }

    test('a partner at hide-transactions shows totals and no rows', async () => {
      await seedPartner()
      setLevel(partnerId, 'hide-transactions')
      const { status, body } = await page('acc-p-saver')
      expect(status).toBe(200)
      expect(body.transactionsHidden).toBe(true)
      expect(body.goal.goal?.name).toBe('Holiday')
      expect(body.months).toMatchObject([{ month: '2026-10', inCents: 8_000, outCents: 0 }])
      expect(JSON.stringify(body)).not.toMatch(/ZZSECRETSHOP|p-in/)
      // The rows themselves stay behind their own check.
      expect(await rowsIn(body.months[0]!, 'acc-p-saver')).toEqual([])
    })

    test('at full, the partner shows rows too', async () => {
      await seedPartner()
      const { body } = await page('acc-p-saver')
      expect(body.transactionsHidden).toBe(false)
      expect(await rowsIn(body.months[0]!, 'acc-p-saver')).toEqual(['p-in'])
    })

    test.each(['balances', 'none', null])('a partner at %s looks the same as no Saver at all', async (level) => {
      await seedPartner()
      setLevel(partnerId, level)
      expect(await page('acc-p-saver')).toEqual(NOT_FOUND)
      expect(await page('acc-p-saver')).toEqual(await page('acc-nope'))
      expect(await page('acc-p-saver', '?range=all')).toEqual(NOT_FOUND)
      // Their own view doesn't change.
      expect(await page('acc-p-saver', '', partner)).toMatchObject({ status: 200, body: { transactionsHidden: false } })
    })

    test.each(['balances', 'none', null])('a debt goal goes with its Saver at %s', async (level) => {
      const theirs = await newDebt({ ownerUserId: partnerId, name: 'Their loan' }, partner)
      expect((await put('acc-p-saver', { kind: 'debt', name: 'Pay it', debtId: theirs }, partner)).status).toBe(204)
      expect((await page('acc-p-saver')).body.debt?.name).toBe('Their loan')
      setLevel(partnerId, 'hide-transactions')
      expect((await page('acc-p-saver')).body.debt?.name).toBe('Their loan')
      setLevel(partnerId, level)
      expect(await page('acc-p-saver')).toEqual(NOT_FOUND)
    })

    test.each(['hide-transactions', 'balances', 'none', null])('a joint Saver stays open at %s', async (level) => {
      tx('j-in', 2_000, '2026-10-05', 'acc-j-saver')
      const joint = await newDebt({ ownerUserId: null, name: 'Joint loan' })
      expect((await put('acc-j-saver', { kind: 'debt', name: 'Joint', debtId: joint })).status).toBe(204)
      setLevel(partnerId, level)
      const { status, body } = await page('acc-j-saver')
      expect(status).toBe(200)
      expect(body.transactionsHidden).toBe(false)
      expect(body.months).toMatchObject([{ month: '2026-10', inCents: 2_000 }])
      expect(body.debt?.name).toBe('Joint loan')
      expect(await rowsIn(body.months[0]!, 'acc-j-saver')).toEqual(['j-in'])
    })
  })
})

describe('reached goals', () => {
  const setBalance = (id: string, balanceCents: number) =>
    t.db.update(s.accounts).set({ balanceCents }).where(eq(s.accounts.id, id)).run()
  const seen = (accountId: string, cookie = owner) =>
    call(`/api/goals/${accountId}/seen`, { method: 'POST', cookie })
  const stored = (id: string) => t.db.select().from(s.goals).where(eq(s.goals.accountId, id)).get()

  test('reached is recorded once', async () => {
    await put('acc-holiday', holiday)
    setBalance('acc-holiday', 100_000)
    expect(await goalOf('acc-holiday')).toMatchObject({ status: 'reached', reachedOn: '2026-10-30', celebrate: true })
    t.setNow(new Date('2026-11-06T01:00:00Z'))
    expect(await goalOf('acc-holiday')).toMatchObject({ reachedOn: '2026-10-30', celebrate: true })
    expect(stored('acc-holiday')?.reachedOn).toBe('2026-10-30')
  })

  test('the built-in goal records nothing', async () => {
    seedAccount(t.db, { id: 'acc-suc', owner: ownerId, type: 'SAVER', name: 'Save Up Challenge', balanceCents: 100_000 })
    expect(await goalOf('acc-suc')).toMatchObject({ status: 'reached', reachedOn: null, celebrate: false })
    expect(stored('acc-suc')).toBeUndefined()
  })

  test('a buffer never records', async () => {
    await put('acc-holiday', { kind: 'buffer', name: 'Cushion', targetCents: 50_000 })
    expect(await goalOf('acc-holiday')).toMatchObject({ status: 'topped-up', reachedOn: null, celebrate: false })
    expect(stored('acc-holiday')?.reachedOn).toBeNull()
  })

  test('a debt goal records when covered or paid off', async () => {
    const id = await newDebt()
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
    setBalance('acc-holiday', (await leftOn(id)) + 1)
    expect(await goalOf('acc-holiday')).toMatchObject({ status: 'reached', reachedOn: '2026-10-30', celebrate: true })
    // Paid off: nothing left, so any balance covers it.
    const other = await newDebt({ name: 'Other', ownerUserId: partnerId }, partner)
    await put('acc-p-saver', { kind: 'debt', name: 'Other', debtId: other }, partner)
    await call(`/api/debts/${other}/entries`, {
      method: 'POST',
      cookie: partner,
      body: { kind: 'payment', date: TODAY, amountCents: await leftOn(other) },
    })
    expect(await goalOf('acc-p-saver', partner)).toMatchObject({ status: 'reached', reachedOn: '2026-10-30' })
  })

  test("a dip and recovery don't celebrate again", async () => {
    await put('acc-holiday', holiday)
    setBalance('acc-holiday', 100_000)
    expect((await goalOf('acc-holiday')).celebrate).toBe(true)
    await seen('acc-holiday')
    setBalance('acc-holiday', 50_000)
    const dip = await goalOf('acc-holiday')
    expect(dip.status).not.toBe('reached')
    expect(dip).toMatchObject({ reachedOn: '2026-10-30', celebrate: false })
    setBalance('acc-holiday', 100_000)
    expect(await goalOf('acc-holiday')).toMatchObject({ reachedOn: '2026-10-30', celebrate: false })
  })

  test('a dip before seeing it hides the banner until it recovers', async () => {
    await put('acc-holiday', holiday)
    setBalance('acc-holiday', 100_000)
    await goals('me')
    setBalance('acc-holiday', 50_000)
    expect(await goalOf('acc-holiday')).toMatchObject({ reachedOn: '2026-10-30', celebrate: false })
    setBalance('acc-holiday', 100_000)
    expect(await goalOf('acc-holiday')).toMatchObject({ reachedOn: '2026-10-30', celebrate: true })
  })

  test('each person sees it once', async () => {
    setBalance('acc-j-saver', 150_000)
    await put('acc-j-saver', holiday)
    expect((await goalOf('acc-j-saver')).celebrate).toBe(true)
    expect((await goalOf('acc-j-saver', partner)).celebrate).toBe(true)
    expect((await seen('acc-j-saver')).status).toBe(204)
    expect((await goalOf('acc-j-saver')).celebrate).toBe(false)
    expect((await goalOf('acc-j-saver', partner)).celebrate).toBe(true)
    expect((await seen('acc-j-saver', partner)).status).toBe(204)
    expect((await goalOf('acc-j-saver', partner)).celebrate).toBe(false)
    // The goal page agrees.
    expect(((await call('/api/goals/acc-j-saver')).body as GoalDetailDto).goal.celebrate).toBe(false)
  })

  test('changing the target clears it', async () => {
    await put('acc-holiday', holiday)
    setBalance('acc-holiday', 100_000)
    await goals('me')
    await seen('acc-holiday')
    expect((await put('acc-holiday', { ...holiday, targetCents: 150_000 })).status).toBe(204)
    expect(await goalOf('acc-holiday')).toMatchObject({ reachedOn: null, celebrate: false })
    t.setNow(new Date('2026-11-06T01:00:00Z'))
    setBalance('acc-holiday', 150_000)
    expect(await goalOf('acc-holiday')).toMatchObject({ reachedOn: '2026-11-06', celebrate: true })
  })

  test('a new target celebrates when reached again on the same day', async () => {
    await put('acc-holiday', holiday)
    setBalance('acc-holiday', 100_000)
    await goals('me')
    await seen('acc-holiday')
    expect((await goalOf('acc-holiday')).celebrate).toBe(false)
    await put('acc-holiday', { ...holiday, targetCents: 150_000 })
    expect(t.db.select().from(s.goalCelebrationsSeen).all()).toEqual([])
    setBalance('acc-holiday', 150_000)
    expect(await goalOf('acc-holiday')).toMatchObject({ reachedOn: '2026-10-30', celebrate: true })
  })

  test('deleting a goal forgets who had seen it', async () => {
    await put('acc-j-saver', holiday)
    setBalance('acc-j-saver', 150_000)
    await goals('everyone')
    await seen('acc-j-saver')
    await seen('acc-j-saver', partner)
    await put('acc-holiday', holiday)
    setBalance('acc-holiday', 100_000)
    await goals('me')
    await seen('acc-holiday')
    expect((await call('/api/goals/acc-holiday', { method: 'DELETE' })).status).toBe(204)
    expect(t.db.select().from(s.goalCelebrationsSeen).all().map((r) => r.accountId)).toEqual([
      'acc-j-saver',
      'acc-j-saver',
    ])
    expect((await call('/api/goals/acc-j-saver', { method: 'DELETE' })).status).toBe(204)
    expect(t.db.select().from(s.goalCelebrationsSeen).all()).toEqual([])
    // A goal set afterwards, reached the same day, celebrates.
    await put('acc-holiday', holiday)
    expect(await goalOf('acc-holiday')).toMatchObject({ reachedOn: '2026-10-30', celebrate: true })
  })

  test('renaming keeps it', async () => {
    await put('acc-holiday', holiday)
    setBalance('acc-holiday', 100_000)
    await goals('me')
    await put('acc-holiday', { ...holiday, name: 'Trip' })
    expect((await goalOf('acc-holiday')).reachedOn).toBe('2026-10-30')
  })

  test('the seen route', async () => {
    await put('acc-holiday', holiday)
    expect((await seen('acc-holiday')).status).toBe(204)
    expect(t.db.select().from(s.goalCelebrationsSeen).all()).toEqual([])
    setBalance('acc-holiday', 100_000)
    await goals('me')
    await seen('acc-holiday')
    expect(t.db.select().from(s.goalCelebrationsSeen).all()).toEqual([
      { accountId: 'acc-holiday', userId: ownerId, reachedOn: '2026-10-30' },
    ])
    // A partner who can see it may dismiss their own banner without being able to edit.
    expect((await seen('acc-holiday', partner)).status).toBe(204)
    expect(t.db.select().from(s.goalCelebrationsSeen).all()).toHaveLength(2)
  })

  test('the seen route hides what is hidden', async () => {
    setLevel(partnerId, 'balances')
    const hidden = await seen('acc-p-saver')
    expect(hidden).toEqual({ status: 404, body: { error: 'Goal not found' } })
    expect(await seen('acc-nope')).toEqual(hidden)
    expect(await seen('acc-spend')).toEqual(hidden)
  })

  test('ownerName', async () => {
    await put('acc-p-saver', holiday, partner)
    await put('acc-holiday', holiday)
    expect((await goalOf('acc-p-saver')).ownerName).toBe('Partner')
    expect((await goalOf('acc-holiday')).ownerName).toBeNull()
    expect((await goalOf('acc-j-saver')).ownerName).toBeNull()
    expect((await goalOf('acc-p-saver', partner)).ownerName).toBeNull()
  })
})

describe('new target, archive and archived goals', () => {
  const setBalance = (id: string, balanceCents: number) =>
    t.db.update(s.accounts).set({ balanceCents }).where(eq(s.accounts.id, id)).run()
  const stored = (id: string) => t.db.select().from(s.goals).where(eq(s.goals.accountId, id)).get()
  const newTarget = (accountId: string, targetCents: number, cookie = owner) =>
    call(`/api/goals/${accountId}/new-target`, { method: 'POST', body: { targetCents }, cookie })
  const archive = (accountId: string, cookie = owner) =>
    call(`/api/goals/${accountId}/archive`, { method: 'POST', cookie })
  const archived = async (scope = 'everyone', cookie = owner) =>
    ((await call(`/api/goals?scope=${scope}`, { cookie })).body as GoalsDto).archived
  const remove = (id: string, cookie = owner) => call(`/api/goals/archived/${id}`, { method: 'DELETE', cookie })
  const reach = async (accountId = 'acc-holiday', cookie = owner) => {
    await put(accountId, holiday, cookie)
    setBalance(accountId, 100_000)
    await goals('everyone', cookie)
  }
  const row = (over: Partial<typeof s.archivedGoals.$inferInsert>) => ({
    id: 'a1',
    accountId: 'acc-holiday',
    ownerUserId: null as string | null,
    saverName: 'Holiday',
    name: 'Trip',
    kind: 'save' as const,
    targetCents: 100_000,
    debtName: null,
    debtPaidOff: false,
    reachedOn: '2026-10-01',
    archivedAt: '2026-10-02T00:00:00.000Z',
    ...over,
  })

  test('set a new target', async () => {
    await reach()
    t.setNow(new Date('2026-11-06T01:00:00Z'))
    expect((await newTarget('acc-holiday', 150_000)).status).toBe(204)
    expect(await goalOf('acc-holiday')).toMatchObject({
      goal: { kind: 'save', name: 'Holiday', targetCents: 150_000, targetDate: null },
      reachedOn: null,
      celebrate: false,
    })
    expect(stored('acc-holiday')).toMatchObject({ startCents: 100_000, reachedOn: null, startedAt: '2026-11-06T01:00:00.000Z' })
  })

  test('a new target must be more than the balance, and the goal reached', async () => {
    await reach()
    const tooLow = { status: 400, body: { error: 'The new target must be more than the balance.' } }
    expect(await newTarget('acc-holiday', 100_000)).toEqual(tooLow)
    expect(await newTarget('acc-holiday', 5)).toEqual(tooLow)
    const notReached = { status: 400, body: { error: 'Only a reached goal can have a new target.' } }
    await put('acc-p-saver', holiday, partner)
    expect(await newTarget('acc-p-saver', 500_000, partner)).toEqual(notReached)
    // A buffer never counts as reached; a debt goal is refused even when reached.
    await put('acc-p-saver', { kind: 'buffer', name: 'Cushion', targetCents: 100 }, partner)
    expect(await newTarget('acc-p-saver', 500_000, partner)).toEqual(notReached)
    const id = await newDebt()
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
    setBalance('acc-holiday', (await leftOn(id)) + 1)
    expect(await newTarget('acc-holiday', 5_000_000)).toEqual(notReached)
    expect(stored('acc-holiday')?.kind).toBe('debt')
  })

  test('a built-in goal gets its first row', async () => {
    seedAccount(t.db, { id: 'acc-suc', owner: ownerId, type: 'SAVER', name: 'Save Up Challenge', balanceCents: 100_000 })
    expect(stored('acc-suc')).toBeUndefined()
    expect((await newTarget('acc-suc', 200_000)).status).toBe(204)
    expect(await goalOf('acc-suc')).toMatchObject({
      goal: { kind: 'save', name: 'Save Up Challenge', targetCents: 200_000, targetDate: null },
    })
    expect(stored('acc-suc')).toMatchObject({ startCents: 100_000, reachedOn: null })
  })

  test('archive', async () => {
    await reach()
    await call('/api/goals/acc-holiday/seen', { method: 'POST' })
    expect(t.db.select().from(s.goalCelebrationsSeen).all()).toHaveLength(1)
    t.setNow(new Date('2026-11-06T01:00:00Z'))
    expect((await archive('acc-holiday')).status).toBe(204)
    expect(stored('acc-holiday')).toBeUndefined()
    expect(t.db.select().from(s.goalCelebrationsSeen).all()).toEqual([])
    expect(await goalOf('acc-holiday')).toMatchObject({ saverName: 'Holiday', goal: null })
    const rows = await archived()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      accountId: 'acc-holiday',
      saverName: 'Holiday',
      name: 'Holiday',
      kind: 'save',
      targetCents: 100_000,
      debtName: null,
      debtPaidOff: false,
      reachedOn: '2026-10-30',
      canEdit: true,
    })
    expect(t.db.select().from(s.archivedGoals).get()).toMatchObject({
      ownerUserId: ownerId,
      archivedAt: '2026-11-06T01:00:00.000Z',
    })
  })

  test('only a reached saved goal can be archived', async () => {
    const refused = { status: 400, body: { error: 'Only a reached goal can be archived.' } }
    await put('acc-holiday', holiday)
    expect(await archive('acc-holiday')).toEqual(refused)
    await put('acc-holiday', { kind: 'buffer', name: 'Cushion', targetCents: 100 })
    expect(await archive('acc-holiday')).toEqual(refused)
    seedAccount(t.db, { id: 'acc-suc', owner: ownerId, type: 'SAVER', name: 'Save Up Challenge', balanceCents: 100_000 })
    expect(await archive('acc-suc')).toEqual(refused)
    expect(await archive('acc-j-saver')).toEqual(refused)
    expect(t.db.select().from(s.archivedGoals).all()).toEqual([])
  })

  test('a joint goal archives with no owner, and either person may', async () => {
    setBalance('acc-j-saver', 150_000)
    await put('acc-j-saver', holiday, partner)
    expect((await archive('acc-j-saver', partner)).status).toBe(204)
    expect(t.db.select().from(s.archivedGoals).get()).toMatchObject({ ownerUserId: null, saverName: 'House' })
  })

  test("someone else's goal can't be changed", async () => {
    await reach('acc-p-saver', partner)
    const denied = { status: 403, body: { error: 'Only Partner can edit that.' } }
    expect(await archive('acc-p-saver')).toEqual(denied)
    expect(await newTarget('acc-p-saver', 500_000)).toEqual(denied)
    expect(stored('acc-p-saver')).toBeDefined()
  })

  test('archiving a debt goal frees the debt', async () => {
    const id = await newDebt()
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
    const left = await leftOn(id)
    setBalance('acc-holiday', left + 1)
    seedAccount(t.db, { id: 'acc-second', owner: ownerId, type: 'SAVER', name: 'Second' })
    const blocked = await put('acc-second', { kind: 'debt', name: 'Car', debtId: id })
    expect(blocked.status).toBe(400)
    expect((await archive('acc-holiday')).status).toBe(204)
    // Covered but not paid off: the archived row keeps what was left.
    expect((await archived())[0]).toMatchObject({ kind: 'debt', targetCents: left, debtName: 'Car loan', debtPaidOff: false })
    expect((await put('acc-second', { kind: 'debt', name: 'Car', debtId: id })).status).toBe(204)
    expect((await call(`/api/debts/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await archived())[0]).toMatchObject({ debtName: 'Car loan', targetCents: left })
  })

  test('a paid-off debt keeps what it started at', async () => {
    const id = await newDebt({ ownerUserId: partnerId }, partner)
    await put('acc-p-saver', { kind: 'debt', name: 'Car', debtId: id }, partner)
    const start = await leftOn(id)
    await call(`/api/debts/${id}/entries`, {
      method: 'POST',
      cookie: partner,
      body: { kind: 'payment', date: TODAY, amountCents: start },
    })
    expect((await archive('acc-p-saver', partner)).status).toBe(204)
    expect((await archived('me', partner))[0]).toMatchObject({
      kind: 'debt',
      targetCents: start,
      debtPaidOff: true,
      debtName: 'Car loan',
    })
  })

  test('a paid-off debt that is then deleted still archives as paid off', async () => {
    const id = await newDebt({ ownerUserId: partnerId }, partner)
    await put('acc-p-saver', { kind: 'debt', name: 'Car', debtId: id }, partner)
    const start = await leftOn(id)
    await call(`/api/debts/${id}/entries`, {
      method: 'POST',
      cookie: partner,
      body: { kind: 'payment', date: TODAY, amountCents: start },
    })
    expect((await call(`/api/debts/${id}`, { method: 'DELETE', cookie: partner })).status).toBe(204)
    expect((await archive('acc-p-saver', partner)).status).toBe(204)
    expect((await archived('me', partner))[0]).toMatchObject({
      kind: 'save',
      targetCents: start,
      debtPaidOff: true,
      debtName: 'Car loan',
    })
  })

  test('a new target on a goal that followed a debt forgets the debt', async () => {
    const id = await newDebt()
    await put('acc-holiday', { kind: 'debt', name: 'Car', debtId: id })
    const left = await leftOn(id)
    setBalance('acc-holiday', left + 1)
    expect((await call(`/api/debts/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect(stored('acc-holiday')).toMatchObject({ kind: 'save', followedDebtName: 'Car loan' })
    expect((await newTarget('acc-holiday', left + 50_000)).status).toBe(204)
    expect(stored('acc-holiday')).toMatchObject({ followedDebtName: null, targetCents: left + 50_000 })
    setBalance('acc-holiday', left + 50_000)
    expect((await archive('acc-holiday')).status).toBe(204)
    expect((await archived())[0]).toMatchObject({ kind: 'save', targetCents: left + 50_000, debtName: null, debtPaidOff: false })
  })

  test('a reached goal whose balance has dipped refuses a new target and archive', async () => {
    await reach()
    setBalance('acc-holiday', 50_000)
    const before = stored('acc-holiday')
    expect(before?.reachedOn).toBe('2026-10-30')
    expect(await newTarget('acc-holiday', 150_000)).toEqual({
      status: 400,
      body: { error: 'Only a reached goal can have a new target.' },
    })
    expect(await archive('acc-holiday')).toEqual({
      status: 400,
      body: { error: 'Only a reached goal can be archived.' },
    })
    expect(stored('acc-holiday')).toEqual(before)
    expect(t.db.select().from(s.archivedGoals).all()).toEqual([])
  })

  test('archived goals by scope, newest first', async () => {
    t.db
      .insert(s.archivedGoals)
      .values([
        row({ id: 'mine-old', ownerUserId: ownerId, archivedAt: '2026-10-01T00:00:00.000Z' }),
        row({ id: 'mine-new', ownerUserId: ownerId, archivedAt: '2026-10-05T00:00:00.000Z' }),
        row({ id: 'theirs', ownerUserId: partnerId, saverName: 'Car fund', archivedAt: '2026-10-03T00:00:00.000Z' }),
        row({ id: 'joint', ownerUserId: null, saverName: 'House', archivedAt: '2026-10-04T00:00:00.000Z' }),
      ])
      .run()
    const ids = async (scope: string, cookie = owner) => (await archived(scope, cookie)).map((r) => r.id)
    expect(await ids('me')).toEqual(['mine-new', 'mine-old'])
    expect(await ids('partner')).toEqual(['theirs'])
    expect(await ids('joint')).toEqual(['joint'])
    expect(await ids('everyone')).toEqual(['mine-new', 'joint', 'theirs', 'mine-old'])
    expect(await ids('joint', partner)).toEqual(['joint'])
    expect(await ids('partner', partner)).toEqual(['mine-new', 'mine-old'])
    expect((await archived('everyone')).find((r) => r.id === 'theirs')?.canEdit).toBe(false)
    expect((await archived('everyone')).find((r) => r.id === 'joint')?.canEdit).toBe(true)
  })

  test('a Saver that has gone keeps its archived rows', async () => {
    t.db.insert(s.archivedGoals).values(row({ id: 'kept', accountId: 'acc-gone', ownerUserId: ownerId })).run()
    expect((await archived('me')).map((r) => r.id)).toEqual(['kept'])
  })

  test('delete an archived goal', async () => {
    t.db.insert(s.archivedGoals).values(row({ ownerUserId: ownerId })).run()
    expect((await remove('a1')).status).toBe(204)
    expect(t.db.select().from(s.archivedGoals).all()).toEqual([])
    expect(await remove('a1')).toEqual({ status: 404, body: { error: 'Goal not found' } })
    t.db.insert(s.archivedGoals).values(row({ id: 'a2', ownerUserId: null })).run()
    expect((await remove('a2', partner)).status).toBe(204)
  })

  test("a partner can't delete the owner's archived goal", async () => {
    t.db.insert(s.archivedGoals).values(row({ ownerUserId: ownerId })).run()
    expect(await remove('a1', partner)).toEqual({ status: 403, body: { error: 'Only Owner can edit that.' } })
    expect(t.db.select().from(s.archivedGoals).all()).toHaveLength(1)
  })

  test.each(['balances', 'none', null])('a hidden partner at %s: the same 404 everywhere', async (level) => {
    await reach('acc-p-saver', partner)
    t.db.insert(s.archivedGoals).values(row({ ownerUserId: partnerId, saverName: 'Car fund' })).run()
    setLevel(partnerId, level)
    const hidden = { status: 404, body: { error: 'Goal not found' } }
    expect(await call('/api/goals/acc-p-saver/seen', { method: 'POST' })).toEqual(hidden)
    expect(await newTarget('acc-p-saver', 500_000)).toEqual(hidden)
    expect(await archive('acc-p-saver')).toEqual(hidden)
    expect(await remove('a1')).toEqual(hidden)
    // The same as for something that doesn't exist.
    expect(await newTarget('acc-nope', 500_000)).toEqual(hidden)
    expect(await archive('acc-nope')).toEqual(hidden)
    expect(await remove('nope')).toEqual(hidden)
    expect(await archived('everyone')).toEqual([])
    expect(await archived('partner')).toEqual([])
    expect(stored('acc-p-saver')).toBeDefined()
    expect(t.db.select().from(s.archivedGoals).all()).toHaveLength(1)
  })
})
