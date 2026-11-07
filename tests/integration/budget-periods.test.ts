import { beforeEach, expect, test } from 'vitest'
import type { Db } from '../../src/server/db/client'
import * as s from '../../src/server/db/schema'
import {
  budgetAccountIds,
  canEditBudget,
  ensureBudgets,
  findPeriod,
  listBudgetRows,
  pruneJointSnapshots,
  setJointAnchor,
} from '../../src/server/budgets/budgets'
import { createTestDb } from '../helpers/db'
import { seedAccount, seedEvents, seedUser } from '../helpers/budget-seed'

let db: Db
const NOW = new Date('2026-02-02T00:00:00Z')

beforeEach(() => {
  db = createTestDb()
  seedUser(db, 'u1', 'Owner', '2026-01-01T00:00:00.000Z')
  seedUser(db, 'u2', 'Partner', '2026-01-02T00:00:00.000Z')
  seedAccount(db, { id: 'acc-1', owner: 'u1' })
  seedAccount(db, { id: 'saver-1', owner: 'u1', type: 'SAVER' })
  seedAccount(db, { id: 'acc-u2', owner: 'u2' })
  seedAccount(db, { id: 'acc-joint', owner: null, ownership: 'JOINT' })
  seedAccount(db, { id: 'joint-saver', owner: null, ownership: 'JOINT', type: 'SAVER' })
  ensureBudgets(db, NOW)
})

const personal = (userId: string) => listBudgetRows(db).find((b) => b.ownerUserId === userId)!
const joint = () => listBudgetRows(db).find((b) => b.kind === 'joint')!

test('ensureBudgets creates one personal per user and one joint, idempotently', () => {
  ensureBudgets(db, NOW)
  const rows = listBudgetRows(db)
  expect(rows).toHaveLength(3)
  expect(
    rows
      .filter((b) => b.kind === 'personal')
      .map((b) => b.ownerUserId)
      .sort(),
  ).toEqual(['u1', 'u2'])
  expect(joint().anchorUserId).toBe('u1')
})

test('budget accounts', () => {
  expect(budgetAccountIds(db, personal('u1')).sort()).toEqual(['acc-1', 'saver-1'])
  expect(budgetAccountIds(db, joint()).sort()).toEqual(['acc-joint', 'joint-saver'])
  expect(budgetAccountIds(db, personal('u2'))).toEqual(['acc-u2'])
})

test('findPeriod', () => {
  seedEvents(db, 'u1', ['2026-01-01', '2026-01-15', '2026-01-29'])
  expect(findPeriod(db, personal('u1'), '2026-01-20')).toMatchObject({
    start: '2026-01-15',
    end: '2026-01-29',
    prevDate: '2026-01-01',
    nextDate: '2026-01-29',
    isCurrent: false,
    source: 'detected',
    payUserId: 'u1',
  })
  expect(findPeriod(db, personal('u1'), '2026-02-02')).toMatchObject({
    start: '2026-01-29',
    end: null,
    nominalEnd: '2026-02-12',
    nextDate: null,
    isCurrent: true,
  })
  expect(findPeriod(db, personal('u1'), '2025-12-31')).toBeNull()
})

test('joint follows the anchor', () => {
  seedEvents(db, 'u1', ['2026-01-01', '2026-01-15'])
  seedEvents(db, 'u2', ['2026-01-08', '2026-01-22'])
  expect(findPeriod(db, joint(), '2026-01-20')).toMatchObject({ start: '2026-01-15', payUserId: 'u1' })
})

test('anchor change mid-period', () => {
  seedEvents(db, 'u1', ['2026-01-01', '2026-01-15'])
  seedEvents(db, 'u2', ['2026-01-08', '2026-01-22'])
  setJointAnchor(db, joint().id, 'u2', '2026-01-10')
  expect(joint().anchorUserId).toBe('u2')
  expect(findPeriod(db, joint(), '2026-01-05')).toMatchObject({ start: '2026-01-01', end: '2026-01-22' })
  expect(findPeriod(db, joint(), '2026-01-25')).toMatchObject({ start: '2026-01-22', payUserId: 'u2' })
})

test('only the joint budget has an anchor', () => {
  expect(() => setJointAnchor(db, personal('u1').id, 'u2', '2026-01-10')).toThrow(
    'Only the joint budget has an anchor',
  )
})

test('partner without schedule has no periods', () => {
  expect(findPeriod(db, personal('u2'), '2026-01-20')).toBeNull()
})

test('canEditBudget', () => {
  expect(canEditBudget(db, personal('u1'), 'u1')).toBe(true)
  expect(canEditBudget(db, personal('u1'), 'u2')).toBe(false)
  expect(canEditBudget(db, joint(), 'u1')).toBe(true)
  expect(canEditBudget(db, joint(), 'u2')).toBe(true)
})

test('joint snapshots of vanished pay dates are pruned', () => {
  seedEvents(db, 'u1', ['2026-01-01'])
  const j = joint()
  db.insert(s.budgetLines)
    .values({
      id: 'l1',
      budgetId: j.id,
      kind: 'spending',
      name: 'Groceries',
      amountCents: 1,
      sortOrder: 0,
      createdAt: '2026-01-01',
    })
    .run()
  db.insert(s.periodLines)
    .values([
      { budgetId: j.id, periodStart: '2026-01-01', lineId: 'l1', amountCents: 1, sortOrder: 0 },
      { budgetId: j.id, periodStart: '2026-01-15', lineId: 'l1', amountCents: 1, sortOrder: 0 },
    ])
    .run()
  pruneJointSnapshots(db)
  expect(db.select({ start: s.periodLines.periodStart }).from(s.periodLines).all()).toEqual([
    { start: '2026-01-01' },
  ])
})

test('joint defaults to the first user created, even when created in the same instant', () => {
  const fresh = createTestDb()
  seedUser(fresh, 'zz-owner', 'Owner', '2026-01-01T00:00:00.000Z')
  seedUser(fresh, 'aa-partner', 'Partner', '2026-01-01T00:00:00.000Z')
  ensureBudgets(fresh, NOW)
  expect(listBudgetRows(fresh).find((b) => b.kind === 'joint')?.anchorUserId).toBe('zz-owner')
})
