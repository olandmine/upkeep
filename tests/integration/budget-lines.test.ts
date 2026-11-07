import { and, asc, eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import type { Db } from '../../src/server/db/client'
import * as s from '../../src/server/db/schema'
import { ensureBudgets, listBudgetRows } from '../../src/server/budgets/budgets'
import { BudgetError } from '../../src/server/budgets/errors'
import {
  activeLines,
  archiveLine,
  assertNoCategoryOverlap,
  createLine,
  ensurePeriodSnapshot,
  updateLine,
  validateLine,
  writeSnapshot,
  type LineInput,
} from '../../src/server/budgets/lines'
import { createTestDb } from '../helpers/db'
import { local, seedAccount, seedCategories, seedEvents, seedUser, TZ } from '../helpers/budget-seed'

let db: Db
const NOW = new Date(local('2026-01-20', '12:00'))

beforeEach(() => {
  db = createTestDb()
  seedUser(db, 'u1', 'Owner', '2026-01-01T00:00:00.000Z')
  seedUser(db, 'u2', 'Partner', '2026-01-02T00:00:00.000Z')
  seedAccount(db, { id: 'acc-1', owner: 'u1' })
  seedAccount(db, { id: 'saver-rent', owner: 'u1', type: 'SAVER', name: 'Rent' })
  seedAccount(db, { id: 'saver-food', owner: 'u1', type: 'SAVER', name: 'Food' })
  seedAccount(db, { id: 'saver-u2', owner: 'u2', type: 'SAVER' })
  seedAccount(db, { id: 'joint-saver', owner: null, ownership: 'JOINT', type: 'SAVER' })
  seedCategories(db, [
    { id: 'home', name: 'Home', parentId: null },
    { id: 'groceries', name: 'Groceries', parentId: 'home' },
    { id: 'good-life', name: 'Good Life', parentId: null },
    { id: 'takeaway', name: 'Takeaway', parentId: 'good-life' },
  ])
  seedEvents(db, 'u1', ['2026-01-01', '2026-01-15'])
  ensureBudgets(db, NOW)
})

const mine = () => listBudgetRows(db).find((b) => b.ownerUserId === 'u1')!.id
const joint = () => listBudgetRows(db).find((b) => b.kind === 'joint')!.id
const spending = (over: Partial<LineInput> = {}): LineInput => ({
  kind: 'spending',
  name: 'Groceries',
  amountCents: 50000,
  categoryIds: ['groceries'],
  saverAccountId: null,
  ...over,
})
const snapshot = (budgetId: string, start: string) =>
  db
    .select({
      lineId: s.periodLines.lineId,
      amountCents: s.periodLines.amountCents,
      sortOrder: s.periodLines.sortOrder,
    })
    .from(s.periodLines)
    .where(and(eq(s.periodLines.budgetId, budgetId), eq(s.periodLines.periodStart, start)))
    .orderBy(asc(s.periodLines.sortOrder))
    .all()

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

test('creates spending and fund lines', () => {
  const g = createLine(db, mine(), 'u1', spending(), NOW, TZ)
  const r = createLine(
    db,
    mine(),
    'u1',
    { kind: 'fund', name: 'Rent', amountCents: 80000, categoryIds: [], saverAccountId: 'saver-rent' },
    NOW,
    TZ,
  )
  expect(activeLines(db, mine())).toMatchObject([
    { id: g.id, kind: 'spending', name: 'Groceries', categoryIds: ['groceries'], sortOrder: 0 },
    { id: r.id, kind: 'fund', saverAccountId: 'saver-rent', categoryIds: [], sortOrder: 1 },
  ])
})

test('fund requires a saver', () => {
  expectError(() => createLine(db, mine(), 'u1', spending({ kind: 'fund', categoryIds: [] }), NOW, TZ), 400)
})

test('category overlap is rejected after expanding parents', () => {
  createLine(db, mine(), 'u1', spending({ name: 'Groceries+', categoryIds: ['home'] }), NOW, TZ)
  expectError(
    () => createLine(db, mine(), 'u1', spending(), NOW, TZ),
    400,
    'Groceries is already in Groceries+',
  )
  // Other budgets may reuse the category
  createLine(db, joint(), 'u1', spending(), NOW, TZ)
})

test('saver rules', () => {
  const fund = (saverAccountId: string, budgetId = mine()) =>
    createLine(
      db,
      budgetId,
      'u1',
      { kind: 'fund', name: 'F', amountCents: 1, categoryIds: [], saverAccountId },
      NOW,
      TZ,
    )
  expectError(() => fund('saver-u2'), 400)
  expectError(() => fund('joint-saver'), 400)
  expectError(() => fund('saver-rent', joint()), 400)
  fund('saver-rent')
  expectError(() => createLine(db, mine(), 'u1', spending({ saverAccountId: 'saver-rent' }), NOW, TZ), 400)
})

test("partner can't edit my lines", () => {
  expectError(
    () => createLine(db, mine(), 'u2', spending(), NOW, TZ),
    403,
    'Only Owner can edit their budget.',
  )
  const line = createLine(db, mine(), 'u1', spending(), NOW, TZ)
  expectError(() => updateLine(db, line.id, 'u2', { amountCents: 1 }, NOW, TZ), 403)
  expectError(() => archiveLine(db, line.id, 'u2', NOW, TZ), 403)
  createLine(db, joint(), 'u2', spending(), NOW, TZ)
})

test('snapshots: edits reach the current period, never past ones', () => {
  const line = createLine(db, mine(), 'u1', spending(), NOW, TZ)
  expect(ensurePeriodSnapshot(db, mine(), '2026-01-01')).toEqual([
    { lineId: line.id, amountCents: 50000, sortOrder: 0 },
  ])
  updateLine(db, line.id, 'u1', { amountCents: 60000 }, NOW, TZ)
  expect(ensurePeriodSnapshot(db, mine(), '2026-01-15')).toEqual([
    { lineId: line.id, amountCents: 60000, sortOrder: 0 },
  ])
  expect(snapshot(mine(), '2026-01-01')).toEqual([{ lineId: line.id, amountCents: 50000, sortOrder: 0 }])
})

test('archived lines leave current and future, stay in past snapshots', () => {
  const line = createLine(db, mine(), 'u1', spending(), NOW, TZ)
  ensurePeriodSnapshot(db, mine(), '2026-01-01')
  archiveLine(db, line.id, 'u1', NOW, TZ)
  expect(activeLines(db, mine())).toEqual([])
  expect(snapshot(mine(), '2026-01-15')).toEqual([])
  expect(snapshot(mine(), '2026-01-01')).toHaveLength(1)
  expect(ensurePeriodSnapshot(db, mine(), '2026-01-29')).toEqual([])
})

test('archived lines cannot be edited or archived again', () => {
  const line = createLine(db, mine(), 'u1', spending(), NOW, TZ)
  archiveLine(db, line.id, 'u1', NOW, TZ)
  expectError(() => updateLine(db, line.id, 'u1', { amountCents: 1 }, NOW, TZ), 400, 'That bucket has been removed.')
  expectError(() => archiveLine(db, line.id, 'u1', NOW, TZ), 400, 'That bucket has been removed.')
})

test('validateLine leaves category overlap for later when told to', () => {
  createLine(db, mine(), 'u1', spending(), NOW, TZ)
  const budget = listBudgetRows(db).find((b) => b.id === mine())!
  const input = spending({ name: 'Food' })
  expect(() => validateLine(db, budget, input, null, { skipOverlap: true })).not.toThrow()
  expectError(
    () => validateLine(db, budget, input, null, { skipOverlap: false }),
    400,
    'Groceries is already in Groceries',
  )
})

test('assertNoCategoryOverlap checks every pair of saved lines in one budget', () => {
  createLine(db, joint(), 'u1', spending(), NOW, TZ)
  createLine(db, mine(), 'u1', spending({ name: 'A', categoryIds: ['groceries'] }), NOW, TZ)
  const b = createLine(db, mine(), 'u1', spending({ name: 'B', categoryIds: ['takeaway'] }), NOW, TZ)
  expect(() => assertNoCategoryOverlap(db, mine())).not.toThrow()

  db.insert(s.budgetLineCategories).values({ lineId: b.id, categoryId: 'home' }).run()
  expectError(() => assertNoCategoryOverlap(db, mine()), 400, 'Groceries is already in A')
})

test('writeSnapshot keeps the amounts it is told to', () => {
  const a = createLine(db, mine(), 'u1', spending({ name: 'A', categoryIds: ['groceries'] }), NOW, TZ)
  const b = createLine(db, mine(), 'u1', spending({ name: 'B', categoryIds: ['takeaway'] }), NOW, TZ)
  writeSnapshot(db, mine(), '2026-01-15', new Map([[a.id, 12345]]))
  expect(snapshot(mine(), '2026-01-15')).toEqual([
    { lineId: a.id, amountCents: 12345, sortOrder: 0 },
    { lineId: b.id, amountCents: 50000, sortOrder: 1 },
  ])
  writeSnapshot(db, mine(), '2026-01-15')
  expect(snapshot(mine(), '2026-01-15')[0]).toEqual({ lineId: a.id, amountCents: 50000, sortOrder: 0 })
})
