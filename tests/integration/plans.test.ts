import { beforeEach, expect, test } from 'vitest'
import type { Db } from '../../src/server/db/client'
import type { PlanItemInput } from '../../src/shared/types'
import { ensureBudgets, listBudgetRows } from '../../src/server/budgets/budgets'
import { BudgetError } from '../../src/server/budgets/errors'
import { createLine } from '../../src/server/budgets/lines'
import { createScheduleFromTransaction, rederivePayEvents } from '../../src/server/budgets/pay-schedule'
import {
  getPayPlan,
  getTemplate,
  proposeFromLastPay,
  putPayPlan,
  putTemplate,
  saveAsTemplate,
} from '../../src/server/budgets/plans'
import { createTestDb } from '../helpers/db'
import { local, seedAccount, seedCategories, seedPays, seedTx, seedUser, TZ } from '../helpers/budget-seed'

let db: Db
let n = 0
let rentLine: string
let groceriesLine: string
const NOW = new Date(local('2026-01-20', '12:00'))

beforeEach(() => {
  db = createTestDb()
  n = 0
  seedUser(db, 'u1', 'Owner', '2026-01-01T00:00:00.000Z')
  seedUser(db, 'u2', 'Partner', '2026-01-02T00:00:00.000Z')
  seedAccount(db, { id: 'acc-1', owner: 'u1', name: 'Spending' })
  seedAccount(db, { id: 'saver-rent', owner: 'u1', type: 'SAVER', name: 'Rent' })
  seedAccount(db, { id: 'saver-food', owner: 'u1', type: 'SAVER', name: 'Food' })
  seedAccount(db, { id: 'saver-car', owner: 'u1', type: 'SAVER', name: 'Car' })
  seedAccount(db, { id: 'saver-u2', owner: 'u2', type: 'SAVER' })
  seedAccount(db, { id: 'acc-joint', owner: null, ownership: 'JOINT', name: '2Up Spending' })
  seedAccount(db, { id: 'joint-saver', owner: null, ownership: 'JOINT', type: 'SAVER', name: 'Bills' })
  seedCategories(db, [
    { id: 'home', name: 'Home', parentId: null },
    { id: 'groceries', name: 'Groceries', parentId: 'home' },
  ])
  seedPays(db, 'acc-1', '2026-01-01', 2)
  ensureBudgets(db, NOW)
  createScheduleFromTransaction(db, 'u1', 'pay1', NOW, TZ)
  const mine = listBudgetRows(db).find((b) => b.ownerUserId === 'u1')!.id
  rentLine = createLine(
    db,
    mine,
    'u1',
    { kind: 'fund', name: 'Rent', amountCents: 80000, categoryIds: [], saverAccountId: 'saver-rent' },
    NOW,
    TZ,
  ).id
  groceriesLine = createLine(
    db,
    mine,
    'u1',
    {
      kind: 'spending',
      name: 'Groceries',
      amountCents: 60000,
      categoryIds: ['groceries'],
      saverAccountId: null,
    },
    NOW,
    TZ,
  ).id
})

const item = (over: Partial<PlanItemInput>): PlanItemInput => ({
  targetKind: 'saver',
  lineId: null,
  saverAccountId: null,
  amountCents: 0,
  ...over,
})
const rent = (amountCents = 80000) => item({ targetKind: 'line', lineId: rentLine, amountCents })
const transfer = (
  saver: string,
  amountCents: number,
  createdAt: string,
  over: Partial<Parameters<typeof seedTx>[1]> = {},
) =>
  seedTx(db, { id: `x${n++}`, accountId: saver, amountCents, createdAt, transferAccountId: 'acc-1', ...over })
const plan = (payDate = '2026-01-15') => getPayPlan(db, 'u1', payDate, NOW, TZ)

function expect400(fn: () => unknown) {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(BudgetError)
    expect((err as BudgetError).status).toBe(400)
    return
  }
  throw new Error('expected a 400')
}

test('totals', () => {
  seedTx(db, {
    id: 'bonus',
    accountId: 'acc-1',
    amountCents: 200000,
    createdAt: local('2026-01-18'),
    description: 'ACME PAY',
  })
  rederivePayEvents(db, 'u1', NOW, TZ)
  putTemplate(
    db,
    'u1',
    {
      expectedIncomeCents: 400000,
      items: [rent(300000), item({ saverAccountId: 'saver-food', amountCents: 300000 })],
    },
    NOW,
    TZ,
  )
  expect(plan()).toMatchObject({
    incomeCents: 600000,
    incomeIsExpected: false,
    allocatedCents: 600000,
  })

  const later = new Date(local('2026-02-01', '12:00'))
  rederivePayEvents(db, 'u1', later, TZ)
  expect(getPayPlan(db, 'u1', '2026-01-29', later, TZ)).toMatchObject({
    incomeCents: 400000,
    incomeIsExpected: true,
  })
})

test('auto-check', () => {
  putTemplate(
    db,
    'u1',
    {
      expectedIncomeCents: 400000,
      items: [rent(), item({ saverAccountId: 'saver-food', amountCents: 20000 })],
    },
    NOW,
    TZ,
  )
  transfer('saver-rent', 30000, local('2026-01-15', '11:00'))
  transfer('saver-rent', 50000, local('2026-01-16'))
  transfer('saver-rent', 196, local('2026-01-16'), { transactionType: 'Round Up' })
  transfer('saver-rent', 10000, local('2026-01-10'))
  const [r, food] = plan().items
  expect(r).toMatchObject({
    check: 'done',
    movedCents: 80000,
    resolvedSaverId: 'saver-rent',
    targetName: 'Rent',
  })
  expect(food).toMatchObject({ check: 'pending', movedCents: 0, targetName: 'Food' })

  putPayPlan(db, 'u1', '2026-01-15', [rent(100000)], NOW, TZ)
  expect(plan().items[0]).toMatchObject({ check: 'partial', movedCents: 80000 })
})

test("joint transfer doesn't tick a personal allocation", () => {
  putTemplate(
    db,
    'u1',
    { expectedIncomeCents: 0, items: [item({ saverAccountId: 'joint-saver', amountCents: 50000 })] },
    NOW,
    TZ,
  )
  transfer('joint-saver', 50000, local('2026-01-16'), { transferAccountId: 'acc-joint' })
  expect(plan().items[0]).toMatchObject({ check: 'pending', movedCents: 0 })
})

test('buffer and stays-in-Spending items have no check', () => {
  putTemplate(
    db,
    'u1',
    {
      expectedIncomeCents: 0,
      items: [
        item({ targetKind: 'line', lineId: groceriesLine, amountCents: 60000 }),
        item({ targetKind: 'buffer', amountCents: 5000 }),
        item({ saverAccountId: 'saver-food', amountCents: 0 }),
      ],
    },
    NOW,
    TZ,
  )
  expect(plan().items.map((i) => [i.targetName, i.check])).toEqual([
    ['Groceries', null],
    ['Leave in Spending', null],
    ['Food', null],
  ])
})

test('template propagation', () => {
  putTemplate(db, 'u1', { expectedIncomeCents: 400000, items: [rent(80000)] }, NOW, TZ)
  expect(plan('2026-01-01').items[0].amountCents).toBe(80000)
  putTemplate(db, 'u1', { expectedIncomeCents: 400000, items: [rent(90000)] }, NOW, TZ)
  expect(plan().items[0].amountCents).toBe(90000)
  expect(plan().customised).toBe(false)

  putPayPlan(db, 'u1', '2026-01-15', [rent(70000)], NOW, TZ)
  putTemplate(db, 'u1', { expectedIncomeCents: 400000, items: [rent(95000)] }, NOW, TZ)
  expect(plan()).toMatchObject({ customised: true, items: [{ amountCents: 70000 }] })
  expect(plan('2026-01-01').items[0].amountCents).toBe(80000)

  expect(saveAsTemplate(db, 'u1', '2026-01-15', NOW, TZ).items[0].amountCents).toBe(70000)
  expect(getTemplate(db, 'u1')?.items[0].amountCents).toBe(70000)
})

test('proposeFromLastPay', () => {
  const pay = Date.parse(local('2026-01-15'))
  const at = (hours: number) => new Date(pay + hours * 3_600_000).toISOString()
  transfer('saver-rent', 80000, at(2))
  transfer('saver-food', 30000, at(3))
  transfer('saver-food', 196, at(3), { transactionType: 'Round Up' })
  transfer('saver-car', 10000, at(30))
  expect(proposeFromLastPay(db, 'u1', TZ)).toEqual({
    expectedIncomeCents: 400000,
    items: [
      { targetKind: 'line', lineId: rentLine, saverAccountId: null, saverId: 'saver-rent', amountCents: 80000 },
      { targetKind: 'saver', lineId: null, saverAccountId: 'saver-food', saverId: 'saver-food', amountCents: 30000 },
    ],
  })
  expect(proposeFromLastPay(db, 'u2', TZ)).toBeNull()
})

test('validation', () => {
  const put = (items: PlanItemInput[]) => () =>
    putTemplate(db, 'u1', { expectedIncomeCents: 0, items }, NOW, TZ)
  expect400(put([rent(), item({ saverAccountId: 'saver-rent', amountCents: 1 })]))
  expect400(put([item({ saverAccountId: 'saver-food', amountCents: -1 })]))
  expect400(
    put([item({ targetKind: 'buffer', amountCents: 1 }), item({ targetKind: 'buffer', amountCents: 2 })]),
  )
  expect400(put([item({ targetKind: 'line', lineId: 'nope', amountCents: 1 })]))
  expect400(put([item({ saverAccountId: 'saver-u2', amountCents: 1 })]))
  expect400(() => putPayPlan(db, 'u1', '2026-01-08', [rent()], NOW, TZ))
})
