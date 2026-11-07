import { beforeEach, describe, expect, test } from 'vitest'
import type { Db } from '../../src/server/db/client'
import { ensureBudgets, listBudgetRows } from '../../src/server/budgets/budgets'
import { createLine } from '../../src/server/budgets/lines'
import { putPayPlan } from '../../src/server/budgets/plans'
import { createDebt } from '../../src/server/debts/debts'
import { markRepayment } from '../../src/server/debts/repayments'
import { getPayFlow } from '../../src/server/payflow/gather'
import type { BudgetDto, BudgetPeriodDto, PayFlowDto } from '../../src/shared/types'
import { createTestApp, type TestApp } from '../helpers/app'
import { createTestDb } from '../helpers/db'
import { local, seedAccount, seedCategories, seedEvents, seedTx, seedUser, TZ } from '../helpers/budget-seed'

const NOW = new Date(local('2026-01-20', '12:00'))
const CATEGORIES = [
  { id: 'home', name: 'Home', parentId: null },
  { id: 'groceries', name: 'Groceries', parentId: 'home' },
  { id: 'good-life', name: 'Good Life', parentId: null },
  { id: 'takeaway', name: 'Takeaway', parentId: 'good-life' },
]

const edgeIds = (f: PayFlowDto) => f.edges.map((e) => e.id)
const into = (f: PayFlowDto, id: string) =>
  f.edges.filter((e) => e.to === id).reduce((sum, e) => sum + e.amountCents, 0)

/** A person paid 1 and 15 Jan into Spending, with a Saver. */
function seedPerson(db: Db, userId: string, prefix: string) {
  seedAccount(db, { id: `${prefix}-spend`, owner: userId, name: 'Spending' })
  seedAccount(db, { id: `${prefix}-saver`, owner: userId, type: 'SAVER', name: 'Emergency' })
  seedEvents(db, userId, ['2026-01-01', '2026-01-15'])
  for (const [i, date] of ['2026-01-01', '2026-01-15'].entries()) {
    seedTx(db, {
      id: `${userId}-pay${i}`,
      accountId: `${prefix}-spend`,
      amountCents: 400000,
      createdAt: local(date),
      description: 'ACME PAY',
    })
  }
}

describe('through the API', () => {
  let t: TestApp
  let owner: string
  let ownerId: string

  async function call<T>(path: string) {
    const res = await t.json(path, { cookie: owner })
    return { status: res.status, body: (await res.json()) as T }
  }

  beforeEach(async () => {
    t = createTestApp({ now: NOW })
    owner = await t.setupOwner()
    ownerId = (await call<{ id: string }>('/api/me')).body.id
    seedCategories(t.db, CATEGORIES)
    seedPerson(t.db, ownerId, 'me')
    // $250 to the Saver (both sides synced), then a purchase.
    seedTx(t.db, {
      id: 'x-out',
      accountId: 'me-spend',
      amountCents: -25000,
      createdAt: local('2026-01-16'),
      transferAccountId: 'me-saver',
    })
    seedTx(t.db, {
      id: 'x-in',
      accountId: 'me-saver',
      amountCents: 25000,
      createdAt: local('2026-01-16'),
      transferAccountId: 'me-spend',
    })
    seedTx(t.db, {
      id: 'buy',
      accountId: 'me-spend',
      amountCents: -3000,
      createdAt: local('2026-01-16'),
      categoryId: 'groceries',
      parentCategoryId: 'home',
    })
  })

  test('actual accounts end to end', async () => {
    const { status, body } = await call<PayFlowDto>('/api/pay-flow?scope=me')
    expect(status).toBe(200)
    expect(body.state).toBe('ready')
    expect(body.cycle?.start).toBe('2026-01-15')
    expect(body.cycle?.isCurrent).toBe(true)
    expect(edgeIds(body)).toEqual(
      expect.arrayContaining([
        `pay:${ownerId}->account:me-spend`,
        'account:me-spend->account:me-saver',
      ]),
    )
    expect(body.nodes.find((n) => n.id === 'account:me-spend')?.spentCents).toBeGreaterThan(0)
    expect(body.baseCents).toBe(400000)
  })

  test('date steps cycles', async () => {
    const { body } = await call<PayFlowDto>('/api/pay-flow?scope=me&date=2026-01-05')
    expect(body.cycle).toMatchObject({ start: '2026-01-01', nextDate: '2026-01-15', isCurrent: false })
  })

  test('budget matches Budgets page', async () => {
    const budgets = (await call<BudgetDto[]>('/api/budgets')).body
    const mine = budgets.find((b) => b.name === 'Mine')!
    for (const [name, categoryIds] of [
      ['Groceries', ['groceries']],
      ['Takeaway', ['good-life']],
    ] as const) {
      const res = await t.json(`/api/budgets/${mine.id}/lines`, {
        method: 'POST',
        cookie: owner,
        body: { kind: 'spending', name, amountCents: 50000, categoryIds },
      })
      expect(res.status).toBe(201)
    }
    seedTx(t.db, {
      id: 'eat',
      accountId: 'me-spend',
      amountCents: -2550,
      createdAt: local('2026-01-17'),
      categoryId: 'takeaway',
      parentCategoryId: 'good-life',
    })
    seedTx(t.db, {
      id: 'refund',
      accountId: 'me-spend',
      amountCents: 500,
      createdAt: local('2026-01-18'),
      categoryId: 'groceries',
      parentCategoryId: 'home',
    })

    // Spending no line claims, so Not budgeted has something to agree on.
    seedTx(t.db, { id: 'misc', accountId: 'me-spend', amountCents: -1234, createdAt: local('2026-01-19') })

    const flow = (await call<PayFlowDto>('/api/pay-flow?scope=me&group=budget&date=2026-01-20')).body
    const period = (await call<BudgetPeriodDto>(`/api/budgets/${mine.id}/period?date=2026-01-20`)).body
    expect(period.lines.filter((l) => l.spentCents > 0)).toHaveLength(2)
    for (const l of period.lines) expect(into(flow, `line:${l.lineId}`)).toBe(l.spentCents)
    expect(period.notBudgetedCents).toBe(1234)
    expect(into(flow, 'not-budgeted')).toBe(period.notBudgetedCents)
  })

  test('budget matches Budgets page except that repayments count toward their debt', async () => {
    const mine = (await call<BudgetDto[]>('/api/budgets')).body.find((b) => b.name === 'Mine')!
    const res = await t.json(`/api/budgets/${mine.id}/lines`, {
      method: 'POST',
      cookie: owner,
      body: { kind: 'spending', name: 'Groceries', amountCents: 50000, categoryIds: ['groceries'] },
    })
    expect(res.status).toBe(201)
    const debt = createDebt(
      t.db,
      {
        name: 'Car loan',
        kind: 'loan',
        ownerUserId: ownerId,
        rateBp: 0,
        repaymentCents: 45000,
        repaymentFrequency: 'monthly',
        balanceCents: 1000000,
        asOf: '2026-01-01',
      },
      ownerId,
      NOW,
      '2026-01-20',
    )
    // One repayment Budgets counts on the Groceries line, one it counts as Not budgeted.
    seedTx(t.db, {
      id: 'repay-line',
      accountId: 'me-spend',
      amountCents: -45000,
      createdAt: local('2026-01-17'),
      description: 'ACME CAR FINANCE',
      categoryId: 'groceries',
      parentCategoryId: 'home',
    })
    seedTx(t.db, {
      id: 'repay-loose',
      accountId: 'me-spend',
      amountCents: -45000,
      createdAt: local('2026-01-18'),
      description: 'ACME CAR FINANCE',
    })
    seedTx(t.db, { id: 'misc', accountId: 'me-spend', amountCents: -1234, createdAt: local('2026-01-19') })
    markRepayment(t.db, debt.id, 'repay-line', true, ownerId)

    const flow = (await call<PayFlowDto>('/api/pay-flow?scope=me&group=budget&date=2026-01-20')).body
    const period = (await call<BudgetPeriodDto>(`/api/budgets/${mine.id}/period?date=2026-01-20`)).body
    const groceries = period.lines.find((l) => l.name === 'Groceries')!
    expect(groceries.spentCents).toBe(3000 + 45000)
    expect(period.notBudgetedCents).toBe(1234 + 45000)
    // The one allowed difference: each repayment moves out of its line or Not budgeted into the debt.
    expect(into(flow, `line:${groceries.lineId}`)).toBe(groceries.spentCents - 45000)
    expect(into(flow, 'not-budgeted')).toBe(period.notBudgetedCents - 45000)
    expect(into(flow, `debt:${debt.id}`)).toBe(90000)
  })

  test('partner without a partner', async () => {
    const { body } = await call<PayFlowDto>('/api/pay-flow?scope=partner')
    expect(body).toMatchObject({ state: 'partner-not-connected', cycle: null, nodes: [], edges: [] })
  })

  test('a month holds every pay in it, and steps by month', async () => {
    const { body } = await call<PayFlowDto>('/api/pay-flow?scope=me&range=month')
    expect(body.state).toBe('ready')
    expect(body.cycle).toEqual({ start: '2026-01-01', end: null, prevDate: '2025-12-01', nextDate: null, isCurrent: true })
    expect(body.nodes.find((n) => n.id === `pay:${ownerId}`)).toMatchObject({ amountCents: 800000, caption: '2 pays · 1 Jan, 15 Jan' })
    expect(body.baseCents).toBe(800000)

    const past = (await call<PayFlowDto>('/api/pay-flow?scope=me&range=month&date=2025-12-10')).body
    expect(past.cycle).toMatchObject({ start: '2025-12-01', end: '2026-01-01', nextDate: '2026-01-01', isCurrent: false })
    expect(past.baseCents).toBe(0)
  })

  test('a financial year and a calendar year', async () => {
    expect((await call<PayFlowDto>('/api/pay-flow?scope=me&range=fy')).body.cycle).toMatchObject({ start: '2025-07-01', end: null })
    const year = (await call<PayFlowDto>('/api/pay-flow?scope=me&range=year')).body
    expect(year.cycle).toMatchObject({ start: '2026-01-01', prevDate: '2025-01-01' })
    expect(year.baseCents).toBe(800000)
  })

  test('bad query', async () => {
    expect((await call('/api/pay-flow?range=week')).status).toBe(400)
    expect((await call('/api/pay-flow?mode=both')).status).toBe(400)
    expect((await call('/api/pay-flow?date=20-01-2026')).status).toBe(400)
  })
})

describe('gathering', () => {
  let db: Db

  beforeEach(() => {
    db = createTestDb()
    seedUser(db, 'u1', 'Owner', '2026-01-01T00:00:00.000Z')
    seedUser(db, 'u2', 'Partner', '2026-01-02T00:00:00.000Z')
    seedCategories(db, CATEGORIES)
    seedPerson(db, 'u1', 'me')
    seedAccount(db, { id: 'p-spend', owner: 'u2', name: 'Spending' })
    seedAccount(db, { id: 'joint-spend', owner: null, ownership: 'JOINT', name: '2Up Spending' })
    ensureBudgets(db, NOW)
  })

  const flow = (over: Partial<Parameters<typeof getPayFlow>[1]> = {}) =>
    getPayFlow(db, {
      scope: 'me',
      mode: 'actual',
      group: 'accounts',
      date: '2026-01-20',
      viewerId: 'u1',
      now: NOW,
      tz: TZ,
      ...over,
    })
  const jointBudget = () => listBudgetRows(db).find((b) => b.kind === 'joint')!.id

  test('states', () => {
    expect(flow({ viewerId: 'u2' })).toMatchObject({ state: 'needs-pay', cycle: null, nodes: [], edges: [] })
    // u2 exists but has no Up connection.
    expect(flow({ scope: 'partner' }).state).toBe('partner-not-connected')
    // No plan still has a cycle, so the card can step past it.
    const noPlan = flow({ mode: 'planned' })
    expect(noPlan).toMatchObject({ state: 'no-plan', nodes: [], edges: [] })
    expect(noPlan.cycle).not.toBeNull()
    expect(noPlan.cycle).toEqual(flow().cycle)
    expect(flow().state).toBe('ready')
  })

  test('everyone has both pays', () => {
    seedEvents(db, 'u2', ['2026-01-18'], 300000)
    seedTx(db, {
      id: 'u2-pay0',
      accountId: 'p-spend',
      amountCents: 300000,
      createdAt: local('2026-01-18'),
      description: 'WIDGET CO',
    })
    const f = flow({ scope: 'everyone' })
    expect(f.cycle?.start).toBe('2026-01-15')
    expect(f.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['pay:u1', 'pay:u2']))
    expect(f.baseCents).toBe(700000)
    // The Joint scope keeps the pays for the planned views only.
    expect(flow({ scope: 'joint' }).nodes.some((n) => n.kind === 'pay')).toBe(false)
  })

  test('a transfer into scope seen from its sending side', () => {
    seedTx(db, {
      id: 'to-joint',
      accountId: 'me-spend',
      amountCents: -60000,
      createdAt: local('2026-01-16'),
      transferAccountId: 'joint-spend',
    })
    const f = flow({ scope: 'joint' })
    expect(f.state).toBe('ready')
    expect(f.edges).toContainEqual(
      expect.objectContaining({ id: 'account:me-spend->account:joint-spend', amountCents: 60000 }),
    )
  })

  test('repayment goes to its debt', () => {
    const debt = createDebt(
      db,
      {
        name: 'Car loan',
        kind: 'loan',
        ownerUserId: 'u1',
        rateBp: 0,
        repaymentCents: 45000,
        repaymentFrequency: 'monthly',
        balanceCents: 1000000,
        asOf: '2026-01-01',
      },
      'u1',
      NOW,
      '2026-01-20',
    )
    seedTx(db, {
      id: 'repay',
      accountId: 'me-spend',
      amountCents: -45000,
      createdAt: local('2026-01-16'),
      description: 'ACME CAR FINANCE',
      categoryId: 'groceries',
      parentCategoryId: 'home',
    })
    markRepayment(db, debt.id, 'repay', true, 'u1')
    const f = flow({ group: 'budget' })
    expect(into(f, `debt:${debt.id}`)).toBe(45000)
    expect(into(f, 'not-budgeted')).toBe(0)
  })

  test('lines take the colour Budgets gives them', () => {
    const mine = listBudgetRows(db).find((b) => b.ownerUserId === 'u1')!.id
    const line = createLine(
      db,
      mine,
      'u1',
      {
        kind: 'spending',
        name: 'Takeaway',
        amountCents: 10000,
        categoryIds: ['takeaway'],
        saverAccountId: null,
      },
      NOW,
      TZ,
    )
    seedTx(db, {
      id: 'eat',
      accountId: 'me-spend',
      amountCents: -2000,
      createdAt: local('2026-01-16'),
      categoryId: 'takeaway',
      parentCategoryId: 'good-life',
    })
    const node = flow({ group: 'budget' }).nodes.find((n) => n.id === `line:${line.id}`)
    // Good Life keeps its fixed category colour, as on Budgets.
    expect(node).toMatchObject({ amountCents: 2000, colorToken: 'cat-orange' })
  })

  test('a month, year or FY needs no pay schedule to show what actually moved', () => {
    seedTx(db, { id: 'p-buy', accountId: 'p-spend', amountCents: -2000, createdAt: local('2026-01-10') })
    expect(flow({ viewerId: 'u2', range: 'month' })).toMatchObject({ state: 'ready', cycle: { start: '2026-01-01' } })
    expect(flow({ viewerId: 'u2', range: 'month', mode: 'planned' }).state).toBe('no-plan')
  })

  test("planned over a month adds up the plans of the month's pays", () => {
    for (const date of ['2026-01-01', '2026-01-15']) {
      putPayPlan(db, 'u1', date, [{ targetKind: 'saver', lineId: null, saverAccountId: 'me-saver', amountCents: 10000 }], NOW, TZ)
    }
    const f = flow({ mode: 'planned', range: 'month' })
    expect(f.state).toBe('ready')
    expect(f.edges).toContainEqual(expect.objectContaining({ id: 'pay:u1->account:me-saver', amountCents: 20000 }))
    expect(f.baseCents).toBe(800000)
  })

  test('planned accounts sends a Joint line with no Saver to the Joint account', () => {
    const groceries = createLine(
      db,
      jointBudget(),
      'u1',
      {
        kind: 'spending',
        name: 'Groceries',
        amountCents: 30000,
        categoryIds: ['groceries'],
        saverAccountId: null,
      },
      NOW,
      TZ,
    )
    putPayPlan(
      db,
      'u1',
      '2026-01-15',
      [{ targetKind: 'line', lineId: groceries.id, saverAccountId: null, amountCents: 30000 }],
      NOW,
      TZ,
    )
    const f = flow({ mode: 'planned' })
    expect(f.state).toBe('ready')
    expect(f.edges).toContainEqual(
      expect.objectContaining({ id: 'pay:u1->account:joint-spend', amountCents: 30000 }),
    )
    expect(f.edges).toContainEqual(
      expect.objectContaining({ id: 'pay:u1->account:me-spend', amountCents: 370000 }),
    )
  })
})
