import { beforeEach, expect, test } from 'vitest'
import type { Db } from '../../src/server/db/client'
import * as s from '../../src/server/db/schema'
import { BudgetError } from '../../src/server/budgets/errors'
import {
  createScheduleFromTransaction,
  excludePayEvent,
  listPayEvents,
  payCandidates,
  rederivePayEvents,
  undoExclusion,
  updateSchedule,
} from '../../src/server/budgets/pay-schedule'
import { createTestDb } from '../helpers/db'
import { local, seedAccount, seedPays, seedTx, seedUser, TZ } from '../helpers/budget-seed'

let db: Db
let payDates: string[]
const NOW = new Date(local('2026-04-10', '12:00'))

beforeEach(() => {
  db = createTestDb()
  seedUser(db, 'u1', 'Owner')
  seedUser(db, 'u2', 'Partner')
  seedAccount(db, { id: 'acc-1', owner: 'u1' })
  seedAccount(db, { id: 'acc-u2', owner: 'u2' })
  seedAccount(db, { id: 'acc-joint', owner: null, ownership: 'JOINT' })
  payDates = seedPays(db, 'acc-1', '2026-01-01', 8)
  seedTx(db, {
    id: 'coffee',
    accountId: 'acc-1',
    amountCents: 1000,
    createdAt: local('2026-02-03'),
    description: 'Coffee',
  })
})

const expectBudgetError = (fn: () => unknown, status: number, message?: string) => {
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

test('marking a deposit derives history', () => {
  const schedule = createScheduleFromTransaction(db, 'u1', 'pay7', NOW, TZ)
  expect(schedule).toMatchObject({
    descriptionMatch: 'acme pay',
    minAmountCents: 200000,
    accountId: 'acc-1',
    frequencyDays: 14,
  })
  const events = listPayEvents(db, 'u1')
  expect(events).toHaveLength(8)
  expect(events.every((e) => e.source === 'detected')).toBe(true)
  expect(events[0].payDate).toBe(payDates[7]) // newest first
})

test("schedule must be the caller's positive non-transfer individual deposit", () => {
  seedTx(db, { id: 'debit', accountId: 'acc-1', amountCents: -500, createdAt: local('2026-04-01') })
  seedTx(db, {
    id: 'xfer',
    accountId: 'acc-1',
    amountCents: 5000,
    createdAt: local('2026-04-01'),
    transferAccountId: 'acc-joint',
  })
  seedTx(db, { id: 'joint', accountId: 'acc-joint', amountCents: 5000, createdAt: local('2026-04-01') })
  seedTx(db, { id: 'theirs', accountId: 'acc-u2', amountCents: 5000, createdAt: local('2026-04-01') })
  for (const id of ['debit', 'xfer', 'joint', 'theirs']) {
    expectBudgetError(() => createScheduleFromTransaction(db, 'u1', id, NOW, TZ), 400)
  }
})

test('refund from same payer below minimum is not pay', () => {
  seedTx(db, {
    id: 'refund',
    accountId: 'acc-1',
    amountCents: 1500,
    createdAt: local('2026-02-03'),
    description: 'ACME PAY',
  })
  createScheduleFromTransaction(db, 'u1', 'pay7', NOW, TZ)
  const events = listPayEvents(db, 'u1')
  expect(events).toHaveLength(8)
  expect(events.some((e) => e.transactionId === 'refund' || e.extraTxIdsJson.includes('refund'))).toBe(false)
})

test('excluding an event re-derives and undo restores', () => {
  createScheduleFromTransaction(db, 'u1', 'pay7', NOW, TZ)
  excludePayEvent(db, 'u1', payDates[7], NOW, TZ)
  expect(listPayEvents(db, 'u1').map((e) => e.payDate)).not.toContain(payDates[7])
  expect(db.select().from(s.payExclusions).all()).toEqual([{ userId: 'u1', transactionId: 'pay7' }])
  undoExclusion(db, 'u1', 'pay7', NOW, TZ)
  expect(listPayEvents(db, 'u1')[0].payDate).toBe(payDates[7])

  const later = new Date(local('2026-04-26', '12:00'))
  rederivePayEvents(db, 'u1', later, TZ)
  expect(listPayEvents(db, 'u1')[0]).toMatchObject({
    payDate: '2026-04-23',
    source: 'scheduled',
    transactionId: null,
  })
  expectBudgetError(
    () => excludePayEvent(db, 'u1', '2026-04-23', later, TZ),
    400,
    "Pay not seen events can't be removed",
  )
})

test('editing the match re-derives', () => {
  createScheduleFromTransaction(db, 'u1', 'pay7', NOW, TZ)
  updateSchedule(db, 'u1', { minAmountCents: 500000 }, NOW, TZ)
  expect(listPayEvents(db, 'u1')).toEqual([])
})

test('candidates rank recurring deposits first', () => {
  seedTx(db, {
    id: 'tax',
    accountId: 'acc-1',
    amountCents: 900000,
    createdAt: local('2026-04-02'),
    description: 'Tax refund',
  })
  seedTx(db, {
    id: 'old',
    accountId: 'acc-1',
    amountCents: 900000,
    createdAt: local('2026-01-02'),
    description: 'Old bonus',
  })
  seedTx(db, {
    id: 'mine-joint',
    accountId: 'acc-joint',
    amountCents: 900000,
    createdAt: local('2026-04-02'),
  })
  const candidates = payCandidates(db, 'u1', NOW)
  expect(candidates[0]).toEqual({ transactionId: 'pay7', sameDescriptionCount: 5 })
  expect(candidates.map((c) => c.transactionId)).toEqual(['pay7', 'tax']) // one per description; older than 60 days and joint excluded
})

test('descriptions match the way they were marked, whatever the letters or spacing', () => {
  for (const [i, date] of ['2026-01-02', '2026-01-16', '2026-01-30'].entries()) {
    seedTx(db, { id: `ecole${i}`, accountId: 'acc-1', amountCents: 300000, createdAt: local(date), description: '\tÉCOLE PAY ' })
  }
  createScheduleFromTransaction(db, 'u1', 'ecole2', NOW, TZ)
  const detected = listPayEvents(db, 'u1').filter((e) => e.source === 'detected')
  expect(detected.map((e) => e.transactionId)).toEqual(['ecole2', 'ecole1', 'ecole0'])
})
