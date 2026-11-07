import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import type { Db } from '../../src/server/db/client'
import * as s from '../../src/server/db/schema'
import { ensureBudgets, listBudgetRows } from '../../src/server/budgets/budgets'
import { archiveLine, createLine, ensurePeriodSnapshot, updateLine, type LineInput } from '../../src/server/budgets/lines'
import { getBudgetPeriod } from '../../src/server/budgets/status'
import { createTestDb } from '../helpers/db'
import { local, seedAccount, seedCategories, seedEvents, seedTx, seedUser, TZ } from '../helpers/budget-seed'

let db: Db
let n = 0
const NOW = new Date(local('2026-01-20', '12:00')) // day 6 of the 15 Jan period

beforeEach(() => {
  db = createTestDb()
  n = 0
  seedUser(db, 'u1', 'Owner', '2026-01-01T00:00:00.000Z')
  seedUser(db, 'u2', 'Partner', '2026-01-02T00:00:00.000Z')
  seedAccount(db, { id: 'acc-1', owner: 'u1' })
  seedAccount(db, { id: 'saver-groc', owner: 'u1', type: 'SAVER', name: 'Grocery Saver', balanceCents: 5000 })
  seedAccount(db, { id: 'saver-rent', owner: 'u1', type: 'SAVER', name: 'Rent', balanceCents: 164446 })
  seedAccount(db, { id: 'acc-u2', owner: 'u2' })
  seedAccount(db, { id: 'acc-joint', owner: null, ownership: 'JOINT' })
  seedCategories(db, [
    { id: 'home', name: 'Home', parentId: null },
    { id: 'groceries', name: 'Groceries', parentId: 'home' },
    { id: 'utilities', name: 'Utilities', parentId: 'home' },
    { id: 'good-life', name: 'Good Life', parentId: null },
    { id: 'takeaway', name: 'Takeaway', parentId: 'good-life' },
  ])
  seedEvents(db, 'u1', ['2026-01-01', '2026-01-15'])
  ensureBudgets(db, NOW)
})

const mine = () => listBudgetRows(db).find((b) => b.ownerUserId === 'u1')!.id
const joint = () => listBudgetRows(db).find((b) => b.kind === 'joint')!.id
const line = (budgetId: string, over: Partial<LineInput> = {}) =>
  createLine(
    db,
    budgetId,
    'u1',
    {
      kind: 'spending',
      name: 'Groceries',
      amountCents: 10000,
      categoryIds: ['groceries'],
      saverAccountId: null,
      ...over,
    },
    NOW,
    TZ,
  )
const rent = (amountCents = 80000) =>
  createLine(
    db,
    mine(),
    'u1',
    { kind: 'fund', name: 'Rent', amountCents, categoryIds: [], saverAccountId: 'saver-rent' },
    NOW,
    TZ,
  )
const spend = (amountCents: number, over: Partial<Parameters<typeof seedTx>[1]> = {}) =>
  seedTx(db, {
    id: `t${n++}`,
    accountId: 'acc-1',
    amountCents,
    createdAt: local('2026-01-17'),
    categoryId: 'groceries',
    parentCategoryId: 'home',
    ...over,
  })
const period = (budgetId = mine(), date = '2026-01-20') =>
  getBudgetPeriod(db, { budgetId, date, now: NOW, tz: TZ })!
const lineStatus = (name: string, budgetId = mine(), date?: string) =>
  period(budgetId, date).lines.find((l) => l.name === name)!

test('spent nets refunds, includes HELD, excludes transfers and deleted', () => {
  line(mine())
  spend(-5000)
  spend(-2000, { status: 'HELD' })
  spend(1000)
  spend(-3000, { transferAccountId: 'saver-groc' })
  spend(-4000, { deletedAt: '2026-01-18T00:00:00.000Z' })
  spend(-9999, { createdAt: local('2026-01-10') }) // previous period
  expect(lineStatus('Groceries')).toMatchObject({ spentCents: 6000, remainingCents: 4000, state: 'ok' })
})

test('parent category matches children', () => {
  line(mine(), { name: 'Home', categoryIds: ['home'] })
  spend(-2500, { categoryId: 'utilities', parentCategoryId: 'home' })
  spend(-500)
  expect(lineStatus('Home').spentCents).toBe(3000)
})

test('state thresholds', () => {
  line(mine())
  spend(-8490)
  expect(lineStatus('Groceries').state).toBe('ok')
  spend(-10)
  expect(lineStatus('Groceries')).toMatchObject({ state: 'warning', spentRatio: 0.85 })
  spend(-1501)
  expect(lineStatus('Groceries')).toMatchObject({ state: 'over', remainingCents: -1 })
})

test('coverage', () => {
  line(mine(), { saverAccountId: 'saver-groc' })
  spend(-6000)
  expect(lineStatus('Groceries').coverage).toEqual({ state: 'covered', shortCents: 0 })
  db.update(s.accounts).set({ balanceCents: 1000 }).where(eq(s.accounts.id, 'saver-groc')).run()
  expect(lineStatus('Groceries')).toMatchObject({
    coverage: { state: 'short', shortCents: 3000 },
    saverName: 'Grocery Saver',
    saverBalanceCents: 1000,
  })
})

test('fund status excludes round-ups', () => {
  const r = rent()
  const into = (amountCents: number, over: Partial<Parameters<typeof seedTx>[1]> = {}) =>
    spend(amountCents, {
      accountId: 'saver-rent',
      transferAccountId: 'acc-1',
      categoryId: null,
      parentCategoryId: null,
      ...over,
    })
  into(30000)
  into(50000)
  into(196, { transactionType: 'Round Up' })
  expect(lineStatus('Rent')).toMatchObject({
    contributedCents: 80000,
    contribution: 'funded',
    withdrawnCents: 0,
    saverBalanceCents: 164446,
    state: null,
    remainingCents: null,
  })
  updateLine(db, r.id, 'u1', { amountCents: 100000 }, NOW, TZ)
  into(-20000)
  expect(lineStatus('Rent')).toMatchObject({ contribution: 'partial', withdrawnCents: 20000 })
})

test('not budgeted', () => {
  line(mine())
  spend(-700, { categoryId: null, parentCategoryId: null })
  spend(-1300, { categoryId: 'takeaway', parentCategoryId: 'good-life' })
  spend(-5000)
  expect(period().notBudgetedCents).toBe(2000)
})

test('joint counts both partners', () => {
  line(mine())
  line(joint())
  spend(-2500, { accountId: 'acc-joint', performedByUserId: 'u2' })
  spend(-1000, { accountId: 'acc-u2' })
  expect(lineStatus('Groceries', joint()).spentCents).toBe(2500)
  expect(lineStatus('Groceries', mine()).spentCents).toBe(0)
})

test('spent follows current line categories', () => {
  const a = line(mine(), { name: 'A', categoryIds: ['groceries'] })
  const b = line(mine(), { name: 'B', categoryIds: ['takeaway'] })
  ensurePeriodSnapshot(db, mine(), '2026-01-01')
  spend(-5000)
  expect(lineStatus('A').spentCents).toBe(5000)
  updateLine(db, a.id, 'u1', { categoryIds: ['utilities'], amountCents: 777 }, NOW, TZ)
  updateLine(db, b.id, 'u1', { categoryIds: ['takeaway', 'groceries'] }, NOW, TZ)
  expect(lineStatus('A').spentCents).toBe(0)
  expect(lineStatus('B').spentCents).toBe(5000)
  expect(lineStatus('A', mine(), '2026-01-05').amountCents).toBe(10000)
  expect(lineStatus('A').amountCents).toBe(777)
})

test('missing saver', () => {
  line(mine(), { saverAccountId: 'saver-groc' })
  db.delete(s.accounts).where(eq(s.accounts.id, 'saver-groc')).run()
  expect(lineStatus('Groceries')).toMatchObject({
    saverMissing: true,
    coverage: null,
    saverBalanceCents: null,
  })
})

test('beforeSetup marks periods that ended before the first line', () => {
  line(mine())
  expect(period(mine(), '2026-01-05').beforeSetup).toBe(true)
  expect(period().beforeSetup).toBe(false)
})

test('days and income', () => {
  expect(period()).toMatchObject({
    start: '2026-01-15',
    end: null,
    nominalEnd: '2026-01-29',
    isCurrent: true,
    daysTotal: 14,
    daysElapsed: 6,
    incomeCents: 400000,
    payNotSeen: false,
  })
  expect(period(mine(), '2026-01-05')).toMatchObject({ daysTotal: 14, daysElapsed: 14, isCurrent: false })
  expect(getBudgetPeriod(db, { budgetId: mine(), date: '2025-12-01', now: NOW, tz: TZ })).toBeNull()
})

test('not budgeted ignores the pay deposit and other uncategorised income', () => {
  line(mine())
  spend(400000, { categoryId: null, parentCategoryId: null, description: 'ACME PAY', createdAt: local('2026-01-15') })
  spend(-700, { categoryId: null, parentCategoryId: null })
  spend(-1300, { categoryId: 'takeaway', parentCategoryId: 'good-life' })
  expect(period().notBudgetedCents).toBe(2000)
})

test('past periods keep the categories their snapshot was taken with', () => {
  const a = line(mine(), { name: 'A', categoryIds: ['groceries'] })
  const b = line(mine(), { name: 'B', categoryIds: ['takeaway'] })
  spend(-3000, { createdAt: local('2026-01-05') })
  spend(-2000, { categoryId: 'takeaway', parentCategoryId: 'good-life', createdAt: local('2026-01-06') })
  ensurePeriodSnapshot(db, mine(), '2026-01-01')
  archiveLine(db, b.id, 'u1', NOW, TZ)
  updateLine(db, a.id, 'u1', { categoryIds: ['groceries', 'takeaway'] }, NOW, TZ)

  const past = period(mine(), '2026-01-05')
  expect(past.lines.map((l) => [l.name, l.spentCents, l.categoryIds])).toEqual([
    ['A', 3000, ['groceries']],
    ['B', 2000, ['takeaway']],
  ])
  expect(past.totals.spentCents).toBe(5000)
  expect(lineStatus('A').categoryIds).toEqual(['groceries', 'takeaway'])
})

test("movedBackCents counts transfers from a Saver into the owner's Spending", () => {
  spend(10000, { categoryId: null, parentCategoryId: null, transferAccountId: 'saver-groc' })
  expect(period().movedBackCents).toBe(10000)
})

test('movedBackCents counts transfers from a joint Saver', () => {
  seedAccount(db, { id: 'saver-joint', owner: null, ownership: 'JOINT', type: 'SAVER' })
  spend(2500, { categoryId: null, parentCategoryId: null, transferAccountId: 'saver-joint' })
  expect(period().movedBackCents).toBe(2500)
})

test('movedBackCents ignores pay and transfers between non-Savers', () => {
  spend(400000, { categoryId: null, parentCategoryId: null, description: 'ACME PAY' })
  spend(5000, { categoryId: null, parentCategoryId: null, transferAccountId: 'acc-u2' })
  expect(period().movedBackCents).toBe(0)
})

test('movedBackCents is 0 for Joint', () => {
  seedTx(db, {
    id: 'tj',
    accountId: 'acc-joint',
    amountCents: 10000,
    createdAt: local('2026-01-17'),
    transferAccountId: 'saver-groc',
  })
  expect(period(joint()).movedBackCents).toBe(0)
})
