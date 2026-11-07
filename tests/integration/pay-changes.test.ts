import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import type { Db } from '../../src/server/db/client'
import * as s from '../../src/server/db/schema'
import type { PayChangesInput, PlanItemInput } from '../../src/shared/types'
import { ensureBudgets, listBudgetRows, setJointAnchor } from '../../src/server/budgets/budgets'
import { BudgetError } from '../../src/server/budgets/errors'
import { activeLines, archiveLine, createLine, type LineInput } from '../../src/server/budgets/lines'
import { applyPayChanges } from '../../src/server/budgets/pay-changes'
import { createScheduleFromTransaction, rederivePayEvents } from '../../src/server/budgets/pay-schedule'
import { getPayPlan, getTemplate, putPayPlan, putTemplate } from '../../src/server/budgets/plans'
import { getBudgetPeriod } from '../../src/server/budgets/status'
import { listAccounts } from '../../src/server/queries/accounts'
import { buildPayView, draftChanges, startDraft, type PayDraft, type PayView } from '../../src/web/lib/pay-view'
import { createTestDb } from '../helpers/db'
import { local, seedAccount, seedCategories, seedEvents, seedPays, seedTx, seedUser, TZ } from '../helpers/budget-seed'

const PAY = '2026-01-15'
const NOW = new Date(local('2026-01-20', '12:00'))
const NEXT_PAY = '2026-01-29'
const LATER = new Date(local('2026-02-01', '12:00'))

let db: Db
let rentLine: string
let groceriesLine: string

const budgetId = (match: (b: ReturnType<typeof listBudgetRows>[number]) => boolean) =>
  listBudgetRows(db).find(match)!.id
const mine = () => budgetId((b) => b.ownerUserId === 'u1')
const theirs = () => budgetId((b) => b.ownerUserId === 'u2')
const joint = () => budgetId((b) => b.kind === 'joint')

beforeEach(() => {
  db = createTestDb()
  seedUser(db, 'u1', 'Owner', '2026-01-01T00:00:00.000Z')
  seedUser(db, 'u2', 'Partner', '2026-01-02T00:00:00.000Z')
  seedAccount(db, { id: 'acc-1', owner: 'u1', name: 'Spending' })
  seedAccount(db, { id: 'saver-rent', owner: 'u1', type: 'SAVER', name: 'Rent' })
  seedAccount(db, { id: 'saver-food', owner: 'u1', type: 'SAVER', name: 'Food' })
  seedAccount(db, { id: 'saver-car', owner: 'u1', type: 'SAVER', name: 'Car' })
  seedAccount(db, { id: 'saver-u2', owner: 'u2', type: 'SAVER', name: 'Theirs' })
  seedAccount(db, { id: 'joint-saver', owner: null, ownership: 'JOINT', type: 'SAVER', name: 'Bills' })
  seedCategories(db, [
    { id: 'home', name: 'Home', parentId: null },
    { id: 'groceries', name: 'Groceries', parentId: 'home' },
    { id: 'good-life', name: 'Good Life', parentId: null },
    { id: 'takeaway', name: 'Takeaway', parentId: 'good-life' },
  ])
  seedPays(db, 'acc-1', '2026-01-01', 2)
  ensureBudgets(db, NOW)
  createScheduleFromTransaction(db, 'u1', 'pay1', NOW, TZ)
  rentLine = line(mine(), fund('Rent', 80000, 'saver-rent'))
  groceriesLine = line(mine(), spending('Groceries', 60000, ['groceries']))
})

function spending(name: string, amountCents: number, categoryIds: string[]): LineInput {
  return { kind: 'spending', name, amountCents, categoryIds, saverAccountId: null }
}
function fund(name: string, amountCents: number, saverAccountId: string): LineInput {
  return { kind: 'fund', name, amountCents, categoryIds: [], saverAccountId }
}
function line(budget: string, input: LineInput, userId = 'u1') {
  return createLine(db, budget, userId, input, NOW, TZ).id
}

const savers = (food = 20000, bills = 30000, rent = 80000): PlanItemInput[] => [
  { targetKind: 'line', lineId: rentLine, saverAccountId: null, amountCents: rent },
  { targetKind: 'saver', lineId: null, saverAccountId: 'saver-food', amountCents: food },
  { targetKind: 'saver', lineId: null, saverAccountId: 'joint-saver', amountCents: bills },
]
const seedTemplate = (items = savers()) => putTemplate(db, 'u1', { expectedIncomeCents: 400000, items }, NOW, TZ)
const onLineItem = (lineId: string): PlanItemInput => ({ targetKind: 'line', lineId, saverAccountId: null, amountCents: 1 })

type Over = Partial<Pick<PayChangesInput, 'payDate' | 'applyTo' | 'limits'>> & {
  savers?: Partial<PayChangesInput['savers']>
  lines?: Partial<PayChangesInput['lines']>
}
const apply = (over: Over, userId = 'u1') =>
  applyPayChanges(
    db,
    userId,
    {
      payDate: over.payDate ?? PAY,
      applyTo: over.applyTo ?? 'every-pay',
      limits: over.limits ?? [],
      savers: { set: [], remove: [], ...over.savers },
      lines: { create: [], update: [], archive: [], ...over.lines },
    },
    NOW,
    TZ,
  )
const setSaver = (saverAccountId: string, amountCents: number) => ({ saverAccountId, amountCents })

const plan = () => getPayPlan(db, 'u1', PAY, NOW, TZ)
const template = () => getTemplate(db, 'u1')
const toSaver = (items: { resolvedSaverId: string | null; amountCents: number }[] | undefined, saver: string) =>
  items?.find((i) => i.resolvedSaverId === saver)?.amountCents
const toLine = (items: { lineId: string | null; amountCents: number }[] | undefined, lineId: string) =>
  items?.find((i) => i.lineId === lineId)?.amountCents
const lineRow = (id: string) => db.select().from(s.budgetLines).where(eq(s.budgetLines.id, id)).get()!
const periodLine = (budget: string, lineId: string, date = PAY) =>
  getBudgetPeriod(db, { budgetId: budget, date, now: NOW, tz: TZ })!.lines.find((l) => l.lineId === lineId)
const nextPeriodLine = (budget: string, lineId: string) => {
  rederivePayEvents(db, 'u1', LATER, TZ)
  return getBudgetPeriod(db, { budgetId: budget, date: NEXT_PAY, now: LATER, tz: TZ })!.lines.find(
    (l) => l.lineId === lineId,
  )
}

function expectError(fn: () => unknown, status: number, message?: string) {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(BudgetError)
    expect((err as BudgetError).status).toBe(status)
    if (message) expect((err as BudgetError).message).toBe(message)
    return
  }
  throw new Error('expected a BudgetError')
}

test('every pay: a Saver changes in the template and the current plan', () => {
  seedTemplate()
  apply({ savers: { set: [setSaver('saver-food', 25000), setSaver('joint-saver', 35000)] } })
  expect(toSaver(template()?.items, 'saver-food')).toBe(25000)
  expect(toSaver(template()?.items, 'joint-saver')).toBe(35000)
  expect(toSaver(plan().items, 'saver-food')).toBe(25000)
  expect(toSaver(plan().items, 'joint-saver')).toBe(35000)
  expect(toSaver(plan().items, 'saver-rent')).toBe(80000)
  expect(plan().customised).toBe(false)
})

test('every pay: the current plan keeps its customised state', () => {
  seedTemplate()
  putPayPlan(db, 'u1', PAY, savers(21000, 31000, 70000), NOW, TZ)
  apply({ savers: { set: [setSaver('saver-food', 25000)] } })
  expect(plan().customised).toBe(true)
  expect(toSaver(plan().items, 'saver-food')).toBe(25000)
  expect(toSaver(plan().items, 'saver-rent')).toBe(70000)
  expect(toSaver(plan().items, 'joint-saver')).toBe(31000)
  expect(toSaver(template()?.items, 'saver-food')).toBe(25000)
  expect(toSaver(template()?.items, 'saver-rent')).toBe(80000)
})

test('every pay: creates a template if there is none', () => {
  expect(template()).toBeNull()
  apply({ savers: { set: [setSaver('saver-food', 25000)] } })
  expect(template()).toMatchObject({
    expectedIncomeCents: 400000,
    items: [{ resolvedSaverId: 'saver-food', amountCents: 25000 }],
  })
  expect(plan()).toMatchObject({
    customised: false,
    items: [{ resolvedSaverId: 'saver-food', amountCents: 25000 }],
  })
})

test('every pay: an existing template keeps its expected income', () => {
  putTemplate(db, 'u1', { expectedIncomeCents: 123456, items: savers() }, NOW, TZ)
  apply({ savers: { set: [setSaver('saver-food', 25000)] } })
  expect(template()?.expectedIncomeCents).toBe(123456)
})

test('every pay: removes a buffer item', () => {
  seedTemplate([...savers(), { targetKind: 'buffer', lineId: null, saverAccountId: null, amountCents: 5000 }])
  expect(plan().items.some((i) => i.targetKind === 'buffer')).toBe(true)
  apply({ savers: { set: [setSaver('saver-food', 25000)] } })
  expect(template()?.items.some((i) => i.targetKind === 'buffer')).toBe(false)
  expect(plan().items.some((i) => i.targetKind === 'buffer')).toBe(false)
})

test('this pay: a Saver changes only the current plan and marks it customised', () => {
  seedTemplate()
  apply({ applyTo: 'this-pay', savers: { set: [setSaver('saver-rent', 90000)] } })
  expect(plan().customised).toBe(true)
  expect(toSaver(plan().items, 'saver-rent')).toBe(90000)
  expect(toSaver(plan().items, 'saver-food')).toBe(20000)
  expect(toSaver(template()?.items, 'saver-rent')).toBe(80000)
  expect(lineRow(rentLine).amountCents).toBe(80000)
  expect(periodLine(mine(), rentLine)?.amountCents).toBe(80000)
})

test('every pay: a limit changes the line, the period, and later periods', () => {
  expect(periodLine(mine(), groceriesLine, '2026-01-01')?.amountCents).toBe(60000)
  apply({ limits: [{ lineId: groceriesLine, amountCents: 70000 }] })
  expect(lineRow(groceriesLine).amountCents).toBe(70000)
  expect(periodLine(mine(), groceriesLine)?.amountCents).toBe(70000)
  expect(nextPeriodLine(mine(), groceriesLine)?.amountCents).toBe(70000)
  expect(periodLine(mine(), groceriesLine, '2026-01-01')?.amountCents).toBe(60000)
})

test('this pay: a limit changes only the period snapshot', () => {
  seedTemplate()
  apply({ applyTo: 'this-pay', limits: [{ lineId: groceriesLine, amountCents: 70000 }] })
  expect(periodLine(mine(), groceriesLine)?.amountCents).toBe(70000)
  expect(lineRow(groceriesLine).amountCents).toBe(60000)
  expect(plan().customised).toBe(true)
  expect(plan().items.find((i) => i.lineId === groceriesLine)).toMatchObject({ targetKind: 'line', amountCents: 70000 })
  expect(toLine(template()?.items, groceriesLine)).toBeUndefined()
  expect(nextPeriodLine(mine(), groceriesLine)?.amountCents).toBe(60000)
})

test('this pay: a joint limit changes the joint period and marks nothing customised', () => {
  seedTemplate()
  const shared = line(joint(), spending('Shop', 30000, ['groceries']))
  apply({ applyTo: 'this-pay', limits: [{ lineId: shared, amountCents: 45000 }] })
  expect(periodLine(joint(), shared)?.amountCents).toBe(45000)
  expect(lineRow(shared).amountCents).toBe(30000)
  expect(plan().customised).toBe(false)
})

test('a one-off limit survives an every-pay change to another line', () => {
  seedTemplate()
  const eatingOut = line(mine(), spending('Eating out', 25000, ['takeaway']))
  apply({ applyTo: 'this-pay', limits: [{ lineId: groceriesLine, amountCents: 70000 }] })

  apply({
    limits: [{ lineId: eatingOut, amountCents: 30000 }],
    savers: { set: [setSaver('saver-rent', 90000)] },
  })

  expect(periodLine(mine(), groceriesLine)?.amountCents).toBe(70000)
  expect(lineRow(groceriesLine).amountCents).toBe(60000)
  expect(periodLine(mine(), eatingOut)?.amountCents).toBe(30000)
  expect(periodLine(mine(), rentLine)?.amountCents).toBe(90000)
  expect(toLine(plan().items, groceriesLine)).toBe(70000)
})

test('an every-pay change to a line replaces its own one-off', () => {
  apply({ applyTo: 'this-pay', limits: [{ lineId: groceriesLine, amountCents: 70000 }] })
  apply({ limits: [{ lineId: groceriesLine, amountCents: 65000 }] })
  expect(periodLine(mine(), groceriesLine)?.amountCents).toBe(65000)
  expect(lineRow(groceriesLine).amountCents).toBe(65000)
})

test('renaming a line leaves its one-off limit alone', () => {
  apply({ applyTo: 'this-pay', limits: [{ lineId: groceriesLine, amountCents: 70000 }] })
  apply({ lines: { update: [{ lineId: groceriesLine, name: 'Food shop' }] } })
  expect(periodLine(mine(), groceriesLine)).toMatchObject({ name: 'Food shop', amountCents: 70000 })
  expect(lineRow(groceriesLine).amountCents).toBe(60000)
})

test('a personal limit change writes a line plan item', () => {
  seedTemplate()
  apply({ limits: [{ lineId: groceriesLine, amountCents: 70000 }] })
  expect(toLine(template()?.items, groceriesLine)).toBe(70000)
  expect(toLine(plan().items, groceriesLine)).toBe(70000)
  // Written again, it replaces the item instead of adding a second one.
  apply({ limits: [{ lineId: groceriesLine, amountCents: 75000 }] })
  expect(template()?.items.filter((i) => i.lineId === groceriesLine)).toMatchObject([{ amountCents: 75000 }])
  expect(plan().items.filter((i) => i.lineId === groceriesLine)).toMatchObject([{ amountCents: 75000 }])
})

test('a joint limit change does not', () => {
  const shared = line(joint(), spending('Shop', 30000, ['groceries']))
  apply({ limits: [{ lineId: shared, amountCents: 45000 }] })
  expect(lineRow(shared).amountCents).toBe(45000)
  expect(periodLine(joint(), shared)?.amountCents).toBe(45000)
  expect(template()).toBeNull()
  expect(plan().items).toEqual([])
})

test('a personal fund line follows its Saver amount; a joint line does not', () => {
  seedTemplate()
  const bills = line(joint(), fund('Bills', 30000, 'joint-saver'))
  apply({ savers: { set: [setSaver('saver-rent', 90000), setSaver('joint-saver', 45000)] } })

  expect(lineRow(rentLine).amountCents).toBe(90000)
  expect(periodLine(mine(), rentLine)?.amountCents).toBe(90000)
  expect(toSaver(template()?.items, 'saver-rent')).toBe(90000)

  expect(lineRow(bills).amountCents).toBe(30000)
  expect(periodLine(joint(), bills)?.amountCents).toBe(30000)
  expect(toSaver(template()?.items, 'joint-saver')).toBe(45000)
})

test('a personal spending line with a Saver keeps its limit and plan item apart', () => {
  const shop = line(mine(), { ...spending('Shop', 50000, ['takeaway']), saverAccountId: 'saver-car' })
  seedTemplate([{ targetKind: 'line', lineId: shop, saverAccountId: null, amountCents: 40000 }])

  apply({ savers: { set: [setSaver('saver-car', 45000)] } })
  expect(lineRow(shop).amountCents).toBe(50000)
  expect(toSaver(template()?.items, 'saver-car')).toBe(45000)

  apply({ limits: [{ lineId: shop, amountCents: 55000 }] })
  expect(lineRow(shop).amountCents).toBe(55000)
  expect(toSaver(template()?.items, 'saver-car')).toBe(45000)
})

test('a fund line with no plan item gets one when its Saver changes', () => {
  apply({ savers: { set: [setSaver('saver-rent', 90000)] } })
  expect(plan().items).toMatchObject([{ targetKind: 'line', lineId: rentLine, amountCents: 90000 }])
  expect(lineRow(rentLine).amountCents).toBe(90000)
})

test('a Saver removal takes it out of the plan', () => {
  seedTemplate()
  apply({ savers: { remove: ['saver-food'] } })
  expect(toSaver(template()?.items, 'saver-food')).toBeUndefined()
  expect(toSaver(plan().items, 'saver-food')).toBeUndefined()
  expect(toSaver(plan().items, 'saver-rent')).toBe(80000)
})

test('a Saver removal with lines.archive archives its fund line', () => {
  seedTemplate()
  apply({ savers: { remove: ['saver-rent'] }, lines: { archive: [rentLine] } })
  expect(toSaver(template()?.items, 'saver-rent')).toBeUndefined()
  expect(toSaver(plan().items, 'saver-rent')).toBeUndefined()
  expect(activeLines(db, mine()).map((l) => l.id)).toEqual([groceriesLine])
  expect(periodLine(mine(), rentLine)).toBeUndefined()
})

test('a Saver removed and added back in one request stays in the plan', () => {
  seedTemplate()
  apply({ savers: { remove: ['saver-food'], set: [setSaver('saver-food', 25000)] } })
  expect(toSaver(plan().items, 'saver-food')).toBe(25000)
})

test('archiving a limit removes its plan item', () => {
  seedTemplate()
  apply({ limits: [{ lineId: groceriesLine, amountCents: 70000 }] })
  apply({ lines: { archive: [groceriesLine] } })
  expect(toLine(template()?.items, groceriesLine)).toBeUndefined()
  expect(toLine(plan().items, groceriesLine)).toBeUndefined()
  expect(periodLine(mine(), groceriesLine)).toBeUndefined()
})

test('archiving a joint limit keeps the money going to its Saver', () => {
  const shared = line(joint(), { ...spending('Shop', 30000, ['groceries']), saverAccountId: 'joint-saver' })
  seedTemplate([{ targetKind: 'line', lineId: shared, saverAccountId: null, amountCents: 40000 }])
  apply({ lines: { archive: [shared] } })
  expect(template()?.items).toMatchObject([
    { targetKind: 'saver', lineId: null, resolvedSaverId: 'joint-saver', amountCents: 40000 },
  ])
  expect(plan().items).toMatchObject([
    { targetKind: 'saver', lineId: null, resolvedSaverId: 'joint-saver', amountCents: 40000 },
  ])
})

test('a plan item left on a line the partner archived does not block later changes', () => {
  const shared = line(joint(), spending('Shop', 30000, ['groceries']))
  seedTemplate([
    { targetKind: 'line', lineId: shared, saverAccountId: null, amountCents: 40000 },
    { targetKind: 'saver', lineId: null, saverAccountId: 'saver-food', amountCents: 20000 },
  ])
  expect(plan().items).toHaveLength(2)
  archiveLine(db, shared, 'u2', NOW, TZ)
  apply({ savers: { set: [setSaver('saver-food', 25000)] } })
  expect(plan().items).toMatchObject([{ resolvedSaverId: 'saver-food', amountCents: 25000 }])
})

test('a line created in the same request can get its Saver amount', () => {
  seedTemplate()
  apply({
    savers: { set: [setSaver('saver-car', 15000)] },
    lines: {
      create: [
        { budget: 'personal', ...fund('Car', 10000, 'saver-car') },
        { budget: 'personal', ...spending('Eating out', 25000, ['takeaway']) },
      ],
    },
  })

  const created = activeLines(db, mine())
  const car = created.find((l) => l.name === 'Car')!
  const eatingOut = created.find((l) => l.name === 'Eating out')!
  expect(car.amountCents).toBe(15000)
  expect(periodLine(mine(), car.id)?.amountCents).toBe(15000)
  expect(periodLine(mine(), eatingOut.id)?.amountCents).toBe(25000)
  for (const items of [template()?.items, plan().items]) {
    expect(items?.find((i) => i.resolvedSaverId === 'saver-car')).toMatchObject({
      targetKind: 'line',
      lineId: car.id,
      amountCents: 15000,
    })
    expect(toLine(items, eatingOut.id)).toBe(25000)
  }
})

test('a line can be created in the joint budget', () => {
  apply({ lines: { create: [{ budget: 'joint', ...spending('Shop', 30000, ['groceries']) }] } })
  const [shared] = activeLines(db, joint())
  expect(shared).toMatchObject({ name: 'Shop', categoryIds: ['groceries'] })
  expect(periodLine(joint(), shared.id)?.amountCents).toBe(30000)
  expect(template()).toBeNull()
})

test('swapping a category between two lines succeeds', () => {
  const eatingOut = line(mine(), spending('Eating out', 25000, ['takeaway']))
  apply({
    lines: {
      update: [
        { lineId: groceriesLine, categoryIds: ['takeaway'] },
        { lineId: eatingOut, categoryIds: ['groceries'] },
      ],
    },
  })
  expect(periodLine(mine(), groceriesLine)?.categoryIds).toEqual(['takeaway'])
  expect(periodLine(mine(), eatingOut)?.categoryIds).toEqual(['groceries'])
})

// The partner anchors Joint and is paid on other days, so the viewer's Jan 15 pay began in the Jan 4-18 Joint period,
// which has ended, while today (Jan 20) is in the Jan 18 one. That running period is what the page shows and changes.
const ENDED = PAY
const RUNNING = '2026-01-20'
function offCycleAnchor() {
  seedEvents(db, 'u2', ['2026-01-04', '2026-01-18'])
  setJointAnchor(db, joint(), 'u2', '2026-01-01')
  expect(getBudgetPeriod(db, { budgetId: joint(), date: ENDED, now: NOW, tz: TZ })?.start).toBe('2026-01-04')
  expect(getBudgetPeriod(db, { budgetId: joint(), date: RUNNING, now: NOW, tz: TZ })?.start).toBe('2026-01-18')
}
const jointAmounts = (lineId: string) => [
  periodLine(joint(), lineId, ENDED)?.amountCents,
  periodLine(joint(), lineId, RUNNING)?.amountCents,
]
const jointLines = (date: string) =>
  getBudgetPeriod(db, { budgetId: joint(), date, now: NOW, tz: TZ })!.lines.map((l) => ({
    lineId: l.lineId,
    amountCents: l.amountCents,
    categoryIds: l.categoryIds,
  }))

test('off-cycle anchor: every pay lands on the running Joint period and the line, not the ended one', () => {
  offCycleAnchor()
  const shared = line(joint(), spending('Shop', 30000, ['groceries']))
  // Viewed first: a period with no snapshot yet would copy the line whether or not it was rewritten.
  expect(jointAmounts(shared)).toEqual([30000, 30000])

  apply({ limits: [{ lineId: shared, amountCents: 45000 }] })

  expect(jointAmounts(shared)).toEqual([30000, 45000])
  expect(lineRow(shared).amountCents).toBe(45000)
})

test('off-cycle anchor: this pay lands on the running Joint period only', () => {
  offCycleAnchor()
  const shared = line(joint(), spending('Shop', 30000, ['groceries']))
  expect(jointAmounts(shared)).toEqual([30000, 30000])

  apply({ applyTo: 'this-pay', limits: [{ lineId: shared, amountCents: 45000 }] })

  expect(jointAmounts(shared)).toEqual([30000, 45000])
  expect(lineRow(shared).amountCents).toBe(30000)
})

test('off-cycle anchor: this pay reaches a running Joint period that has no snapshot yet', () => {
  offCycleAnchor()
  const shared = line(joint(), spending('Shop', 30000, ['groceries']))

  apply({ applyTo: 'this-pay', limits: [{ lineId: shared, amountCents: 45000 }] })

  expect(periodLine(joint(), shared, RUNNING)?.amountCents).toBe(45000)
  expect(lineRow(shared).amountCents).toBe(30000)
})

test("off-cycle anchor: an ended Joint period's amounts, lines and categories are untouched", () => {
  offCycleAnchor()
  const shop = line(joint(), spending('Shop', 30000, ['groceries']))
  const takeaway = line(joint(), spending('Takeaway', 20000, ['takeaway']))
  const ended = jointLines(ENDED)
  expect(ended).toHaveLength(2)
  expect(jointLines(RUNNING)).toEqual(ended)

  apply({
    limits: [{ lineId: shop, amountCents: 45000 }],
    lines: {
      create: [{ budget: 'joint', ...spending('Gifts', 5000, ['good-life']) }],
      update: [{ lineId: shop, categoryIds: ['home'] }],
      archive: [takeaway],
    },
  })

  expect(jointLines(ENDED)).toEqual(ended)
  const running = jointLines(RUNNING)
  expect(running).toHaveLength(2)
  expect(running.find((l) => l.lineId === shop)).toEqual({ lineId: shop, amountCents: 45000, categoryIds: ['home'] })
  expect(running.find((l) => l.lineId === takeaway)).toBeUndefined()
})

test('off-cycle anchor: a one-off on another Joint line survives an every-pay change, in the running period', () => {
  offCycleAnchor()
  const shop = line(joint(), spending('Shop', 30000, ['groceries']))
  const takeaway = line(joint(), spending('Takeaway', 20000, ['takeaway']))
  // A one-off left in the ended period by an earlier pay's edit, which nothing should touch again.
  expect(jointAmounts(shop)).toEqual([30000, 30000])
  db.update(s.periodLines)
    .set({ amountCents: 41000 })
    .where(
      and(
        eq(s.periodLines.budgetId, joint()),
        eq(s.periodLines.periodStart, '2026-01-04'),
        eq(s.periodLines.lineId, shop),
      ),
    )
    .run()
  apply({ applyTo: 'this-pay', limits: [{ lineId: shop, amountCents: 45000 }] })

  apply({ limits: [{ lineId: takeaway, amountCents: 25000 }] })

  expect(jointAmounts(takeaway)).toEqual([20000, 25000])
  expect(jointAmounts(shop)).toEqual([41000, 45000])
  expect(lineRow(shop).amountCents).toBe(30000)

  // Setting that line itself for every pay replaces its one-off in the running period only.
  apply({ limits: [{ lineId: shop, amountCents: 35000 }] })
  expect(jointAmounts(shop)).toEqual([41000, 35000])
})

// What Edit mode adds up has to be what the page shows once Apply has been through the real server.
describe('the draft totals match the saved view after Apply', () => {
  const viewInput = () => ({
    plan: getPayPlan(db, 'u1', PAY, NOW, TZ),
    period: getBudgetPeriod(db, { budgetId: mine(), date: PAY, now: NOW, tz: TZ })!,
    jointPeriod: null,
    accounts: listAccounts(db, 'everyone', 'u1'),
    goals: [],
  })
  const totals = (v: PayView) => ({
    savers: v.saversCents,
    spendingMoney: v.spendingMoneyCents,
    limits: v.limitsCents,
    otherBudget: v.otherBudgetCents,
    otherSpent: v.sections.flatMap((x) => x.buckets).find((b) => b.key === 'other')?.spentCents,
    spent: v.spentCents,
    leftToSpend: v.leftToSpendCents,
    overPay: v.overPayCents,
    yours: v.sections.find((x) => x.id === 'yours')?.totalCents ?? 0,
    joint: v.sections.find((x) => x.id === 'joint')?.totalCents ?? 0,
  })
  function expectSame(change: Partial<PayDraft>) {
    const input = viewInput()
    const saved = buildPayView(input)
    const draft = { ...startDraft(saved), ...change }
    const view = buildPayView({ ...input, draft })
    applyPayChanges(db, 'u1', draftChanges(view, saved, draft, PAY, 'every-pay'), NOW, TZ)
    expect(totals(view)).toEqual(totals(buildPayView(viewInput())))
    return view
  }

  const CAR = 'saver:saver-car'
  const onLine = (lineId: string, amountCents: number): PlanItemInput => ({
    targetKind: 'line',
    lineId,
    saverAccountId: null,
    amountCents,
  })
  const onSaver = (saverAccountId: string, amountCents: number): PlanItemInput => ({
    targetKind: 'saver',
    lineId: null,
    saverAccountId,
    amountCents,
  })
  /** A limit paid from the Car Saver, with $40 spent. The Rent fund line ($800, no plan item unless seeded) is always there. */
  const linkShop = () => line(mine(), { ...spending('Shop', 50000, ['takeaway']), saverAccountId: 'saver-car' })

  beforeEach(() => {
    seedTx(db, {
      id: 't-g',
      accountId: 'acc-1',
      amountCents: -15000,
      categoryId: 'groceries',
      parentCategoryId: 'home',
      createdAt: local(PAY, '12:00'),
    })
    seedTx(db, {
      id: 't-t',
      accountId: 'acc-1',
      amountCents: -4000,
      categoryId: 'takeaway',
      parentCategoryId: 'good-life',
      createdAt: local(PAY, '13:00'),
    })
  })

  describe('a limit given a Saver', () => {
    const toCar = () => ({ [groceriesLine]: { saverAccountId: 'saver-car' } })

    test('with a plan item: counts at that item', () => {
      seedTemplate([...savers(), onLine(groceriesLine, 50000)])
      const v = expectSame({ updates: toCar() })
      // 130000 to Savers + 50000, out of a 400000 pay; 15000 + 4000 spent.
      expect(v.saversCents).toBe(180000)
      expect(v.leftToSpendCents).toBe(201000)
    })

    test('with no plan item: counts at its own amount', () => {
      seedTemplate()
      const v = expectSame({ updates: toCar() })
      expect(v.saversCents).toBe(190000)
      expect(v.leftToSpendCents).toBe(191000)
    })

    test('and a new limit, with a plan item: the item still sets what moves', () => {
      seedTemplate([...savers(), onLine(groceriesLine, 50000)])
      const v = expectSame({ amounts: { [`line:${groceriesLine}`]: 70000 }, updates: toCar() })
      expect(v.saversCents).toBe(180000)
    })

    test('and a new limit, with no plan item: the new limit is what moves', () => {
      seedTemplate()
      const v = expectSame({ amounts: { [`line:${groceriesLine}`]: 70000 }, updates: toCar() })
      expect(v.saversCents).toBe(200000)
    })

    test('whose Saver the draft took out of the plan: the plan item goes with it', () => {
      seedTemplate([onLine(rentLine, 80000), onSaver('saver-car', 40000), onLine(groceriesLine, 50000)])
      const v = expectSame({ removals: [CAR], updates: toCar() })
      // Rent 80000 + Groceries' own 60000.
      expect(v.saversCents).toBe(140000)
    })
  })

  test('a new limit with a Saver counts at its amount', () => {
    seedTemplate()
    const fuel = { tempId: 't', section: 'spending', name: 'Fuel', amountCents: 12000, categoryIds: ['takeaway'], saverAccountId: 'saver-car' } as const
    const v = expectSame({ creates: [{ ...fuel, categoryIds: [...fuel.categoryIds] }] })
    expect(v.saversCents).toBe(142000)
  })

  describe('a Saver row whose limit lets go of its Saver', () => {
    test('with a plan item on the line: the Saver leaves the total and the limit joins', () => {
      const shop = linkShop()
      seedTemplate([onLine(shop, 40000)])
      const v = expectSame({ updates: { [shop]: { saverAccountId: null } } })
      // Rent's own 80000 is all that is left; Groceries 60000 + Shop 50000.
      expect(v.saversCents).toBe(80000)
      expect(v.limitsCents).toBe(110000)
    })

    test('with no plan item: the same', () => {
      const shop = linkShop()
      seedTemplate([])
      const v = expectSame({ updates: { [shop]: { saverAccountId: null } } })
      expect(v.saversCents).toBe(80000)
      expect(v.limitsCents).toBe(110000)
    })

    test('with a plan item on the Saver: the Saver stays', () => {
      const shop = linkShop()
      seedTemplate([onSaver('saver-car', 40000)])
      const v = expectSame({ updates: { [shop]: { saverAccountId: null } } })
      expect(v.saversCents).toBe(120000)
      expect(v.limitsCents).toBe(110000)
    })

    test('with a new amount on its row: that amount still goes to the Saver', () => {
      const shop = linkShop()
      seedTemplate([onLine(shop, 40000)])
      const v = expectSame({ amounts: { [CAR]: 45000 }, updates: { [shop]: { saverAccountId: null } } })
      expect(v.saversCents).toBe(125000)
    })

    test('with a new limit: the new limit joins', () => {
      const shop = linkShop()
      seedTemplate([onLine(shop, 40000)])
      const v = expectSame({ updates: { [shop]: { saverAccountId: null, amountCents: 55000 } } })
      expect(v.saversCents).toBe(80000)
      expect(v.limitsCents).toBe(115000)
    })
  })

  describe('a Saver row whose limit moves to another Saver', () => {
    const toFood = { saverAccountId: 'saver-food' }

    test('with a plan item on the line: the item follows', () => {
      const shop = linkShop()
      seedTemplate([onLine(shop, 40000)])
      expect(expectSame({ updates: { [shop]: toFood } }).saversCents).toBe(120000)
    })

    test('with no plan item: its limit follows, new or not', () => {
      const shop = linkShop()
      seedTemplate([])
      expect(expectSame({ updates: { [shop]: { ...toFood, amountCents: 55000 } } }).saversCents).toBe(135000)
    })

    test('with a plan item on the old Saver: the old Saver stays, and the limit goes to the new one', () => {
      const shop = linkShop()
      seedTemplate([onSaver('saver-car', 40000)])
      expect(expectSame({ updates: { [shop]: toFood } }).saversCents).toBe(170000)
    })

    test('with a new amount on its row: that amount goes to the new Saver', () => {
      const shop = linkShop()
      seedTemplate([onLine(shop, 40000)])
      expect(expectSame({ amounts: { [CAR]: 45000 }, updates: { [shop]: toFood } }).saversCents).toBe(125000)
    })
  })

  test('a Saver row with no plan item follows a new limit', () => {
    const shop = linkShop()
    seedTemplate([])
    expect(expectSame({ updates: { [shop]: { amountCents: 55000 } } }).saversCents).toBe(135000)
  })
})

test('a real category clash rolls everything back', () => {
  seedTemplate()
  expectError(
    () =>
      apply({
        savers: { set: [setSaver('saver-food', 99900)] },
        limits: [{ lineId: rentLine, amountCents: 1 }],
        lines: { create: [{ budget: 'personal', ...spending('Food shop', 1000, ['home']) }] },
      }),
    400,
    'Groceries is already in Groceries',
  )
  expect(toSaver(template()?.items, 'saver-food')).toBe(20000)
  expect(toSaver(plan().items, 'saver-food')).toBe(20000)
  expect(plan().customised).toBe(false)
  expect(lineRow(rentLine).amountCents).toBe(80000)
  expect(periodLine(mine(), rentLine)?.amountCents).toBe(80000)
  expect(activeLines(db, mine()).map((l) => l.id)).toEqual([rentLine, groceriesLine])
})

test('a Saver linked to a line twice is rejected', () => {
  expectError(
    () => apply({ lines: { create: [{ budget: 'personal', ...fund('Rent 2', 1000, 'saver-rent') }] } }),
    400,
    'Rent is already linked to Rent',
  )
  expectError(
    () =>
      apply({
        lines: {
          create: [
            { budget: 'personal', ...fund('Car', 1000, 'saver-car') },
            { budget: 'personal', ...fund('Car again', 1000, 'saver-car') },
          ],
        },
      }),
    400,
    'Car is already linked to Car',
  )
  expect(activeLines(db, mine()).map((l) => l.id)).toEqual([rentLine, groceriesLine])
})

test('a stale pay date is rejected', () => {
  seedTemplate()
  expectError(
    () => apply({ payDate: '2026-01-01', savers: { set: [setSaver('saver-food', 25000)] } }),
    400,
    'A new pay has arrived. Check your changes and try again.',
  )
  expect(toSaver(template()?.items, 'saver-food')).toBe(20000)
})

test('this pay rejects line changes and removals', () => {
  seedTemplate()
  const thisPay = (over: Over) => () => apply({ applyTo: 'this-pay', ...over })
  const message = 'Adding, removing or renaming applies to every pay.'
  expectError(thisPay({ savers: { remove: ['saver-food'] } }), 400, message)
  expectError(thisPay({ lines: { archive: [groceriesLine] } }), 400, message)
  expectError(thisPay({ lines: { update: [{ lineId: groceriesLine, name: 'Food' }] } }), 400, message)
  expectError(
    thisPay({ lines: { create: [{ budget: 'personal', ...spending('Eating out', 1, ['takeaway']) }] } }),
    400,
    message,
  )
  expect(toSaver(plan().items, 'saver-food')).toBe(20000)
  expect(lineRow(groceriesLine).archivedAt).toBeNull()
})

test("editing the partner's limit is 403; Joint is allowed", () => {
  const partnerLine = line(theirs(), spending('Theirs', 10000, ['groceries']), 'u2')
  const message = 'Only Partner can edit their budget.'
  expectError(() => apply({ limits: [{ lineId: partnerLine, amountCents: 1 }] }), 403, message)
  expectError(() => apply({ applyTo: 'this-pay', limits: [{ lineId: partnerLine, amountCents: 1 }] }), 403, message)
  expectError(() => apply({ lines: { update: [{ lineId: partnerLine, name: 'Mine now' }] } }), 403, message)
  expectError(() => apply({ lines: { archive: [partnerLine] } }), 403, message)
  expect(lineRow(partnerLine)).toMatchObject({ name: 'Theirs', amountCents: 10000, archivedAt: null })

  const shared = line(joint(), spending('Shop', 30000, ['groceries']), 'u2')
  apply({ limits: [{ lineId: shared, amountCents: 45000 }] })
  expect(lineRow(shared).amountCents).toBe(45000)
})

test('an unknown or archived line is rejected', () => {
  expectError(() => apply({ limits: [{ lineId: 'nope', amountCents: 1 }] }), 404, 'Line not found')
  apply({ lines: { archive: [groceriesLine] } })
  expectError(
    () => apply({ limits: [{ lineId: groceriesLine, amountCents: 1 }] }),
    400,
    'That bucket has been removed.',
  )
})

test('what a line or plan item gets wrong is said in terms of buckets', () => {
  seedTemplate()
  expectError(
    () => apply({ lines: { create: [{ budget: 'personal', ...spending('  ', 1000, ['takeaway']) }] } }),
    400,
    'Give the bucket a name.',
  )
  const partnerLine = line(theirs(), spending('Theirs', 10000, ['takeaway']), 'u2')
  expectError(
    () => putTemplate(db, 'u1', { expectedIncomeCents: 1, items: [onLineItem(partnerLine)] }, NOW, TZ),
    400,
    "That bucket isn't in your budget or Joint.",
  )
  expectError(
    () =>
      putTemplate(
        db,
        'u1',
        {
          expectedIncomeCents: 1,
          items: [onLineItem(rentLine), { targetKind: 'saver', lineId: null, saverAccountId: 'saver-rent', amountCents: 1 }],
        },
        NOW,
        TZ,
      ),
    400,
    'Rent is in more than one bucket.',
  )
})

test("amounts must be whole cents and $0 or more, and a Saver must be the viewer's or joint", () => {
  seedTemplate()
  expectError(() => apply({ limits: [{ lineId: groceriesLine, amountCents: -1 }] }), 400)
  expectError(() => apply({ limits: [{ lineId: groceriesLine, amountCents: 1.5 }] }), 400)
  expectError(() => apply({ savers: { set: [setSaver('saver-food', -1)] } }), 400)
  expectError(() => apply({ savers: { set: [setSaver('saver-u2', 1)] } }), 400)
  expect(lineRow(groceriesLine).amountCents).toBe(60000)
})
