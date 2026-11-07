import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import type { Db } from '../../src/server/db/client'
import * as s from '../../src/server/db/schema'
import { ensureBudgets, listBudgetRows } from '../../src/server/budgets/budgets'
import { addDays } from '../../src/server/budgets/dates'
import { archiveLine, createLine } from '../../src/server/budgets/lines'
import { applyPayChanges } from '../../src/server/budgets/pay-changes'
import { getPayPlan, putPayPlan, putTemplate } from '../../src/server/budgets/plans'
import { getStandardPay, median } from '../../src/server/budgets/standard-pay'
import { getBudgetPeriod } from '../../src/server/budgets/status'
import { buildPayView, draftChanges, startDraft, type PayDraft } from '../../src/web/lib/pay-view'
import type { AccountDto, LineStatusDto, PlanItemInput, StandardPayDto } from '../../src/shared/types'
import { createTestApp, type TestApp } from '../helpers/app'
import { createTestDb } from '../helpers/db'
import { local, seedAccount, seedCategories, seedEvents, seedTx, seedUser, TZ } from '../helpers/budget-seed'

// Eight pays, 14 days apart. NOW is in the last, so the six counted are 15 Jan to 26 Mar and 1 Jan is too old.
const PAYS = ['2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12', '2026-02-26', '2026-03-12', '2026-03-26', '2026-04-09']
const COUNTED = PAYS.slice(1, 7)
const CURRENT = PAYS[7]
const NOW = new Date(local('2026-04-12', '12:00'))

let db: Db
let n = 0

beforeEach(() => {
  db = createTestDb()
  n = 0
  seedUser(db, 'u1', 'Owner', '2026-01-01T00:00:00.000Z')
  seedUser(db, 'u2', 'Partner', '2026-01-02T00:00:00.000Z')
  seedAccount(db, { id: 'acc-1', owner: 'u1' })
  seedAccount(db, { id: 'saver-food', owner: 'u1', type: 'SAVER', name: 'Food' })
  seedAccount(db, { id: 'saver-car', owner: 'u1', type: 'SAVER', name: 'Car' })
  seedAccount(db, { id: 'acc-u2', owner: 'u2' })
  seedAccount(db, { id: 'acc-joint', owner: null, ownership: 'JOINT' })
  seedCategories(db, [
    { id: 'home', name: 'Home', parentId: null },
    { id: 'groceries', name: 'Groceries', parentId: 'home' },
    { id: 'utilities', name: 'Utilities', parentId: 'home' },
    { id: 'good-life', name: 'Good Life', parentId: null },
    { id: 'takeaway', name: 'Takeaway', parentId: 'good-life' },
  ])
  seedEvents(db, 'u1', PAYS)
  ensureBudgets(db, NOW)
})

const budgetId = (match: (b: ReturnType<typeof listBudgetRows>[number]) => boolean) =>
  listBudgetRows(db).find(match)!.id
const mine = () => budgetId((b) => b.ownerUserId === 'u1')
const joint = () => budgetId((b) => b.kind === 'joint')

const spendingLine = (name: string, categoryIds: string[], amountCents = 60000, budget = mine()) =>
  createLine(db, budget, 'u1', { kind: 'spending', name, amountCents, categoryIds, saverAccountId: null }, NOW, TZ).id
const fundLine = (name: string, saverAccountId: string, amountCents: number) =>
  createLine(db, mine(), 'u1', { kind: 'fund', name, amountCents, categoryIds: [], saverAccountId }, NOW, TZ).id

const onSaver = (saverAccountId: string, amountCents: number): PlanItemInput => ({
  targetKind: 'saver',
  lineId: null,
  saverAccountId,
  amountCents,
})
const template = (items: PlanItemInput[] = [onSaver('saver-food', 20000)], expectedIncomeCents = 400000) =>
  putTemplate(db, 'u1', { expectedIncomeCents, items }, NOW, TZ)

/** A purchase `days` after `pay` began (inside that pay, even for a 28-day one). */
const spend = (pay: string, cents: number, categoryId: string | null, over: Partial<Parameters<typeof seedTx>[1]> = {}) =>
  seedTx(db, {
    id: `t${n++}`,
    accountId: 'acc-1',
    amountCents: -cents,
    createdAt: local(addDays(pay, 2)),
    categoryId,
    parentCategoryId: categoryId === 'takeaway' ? 'good-life' : categoryId ? 'home' : null,
    ...over,
  })

/** Replaces u1's pay events. */
function setPays(dates: string[]) {
  db.delete(s.payEvents).where(eq(s.payEvents.userId, 'u1')).run()
  seedEvents(db, 'u1', dates)
}
/** Sets the amount of each of u1's pay events, in date order. */
function setAmounts(amounts: (number | null)[]) {
  PAYS.slice(1, 1 + amounts.length).forEach((payDate, i) =>
    db
      .update(s.payEvents)
      .set({ amountCents: amounts[i] })
      .where(eq(s.payEvents.payDate, payDate))
      .run(),
  )
}

const std = (): StandardPayDto => getStandardPay(db, 'u1', NOW, TZ)!
const lineOf = (name: string, dto = std()): LineStatusDto => dto.period.lines.find((l) => l.name === name)!

describe('median', () => {
  test('empty, odd, even and rounding', () => {
    expect(median([])).toBe(0)
    expect(median([300, 100, 200])).toBe(200)
    expect(median([100, 201])).toBe(151)
    expect(median([0, 0, 0, 45000, 45000, 45000])).toBe(22500)
  })
})

describe('getStandardPay', () => {
  test('one-off in 1 of 6 pays leaves the median alone', () => {
    spendingLine('Groceries', ['groceries'])
    template()
    COUNTED.forEach((pay, i) => spend(pay, i === 5 ? 55000 : 10000, 'takeaway'))
    expect(std().period.notBudgetedCents).toBe(10000)
  })

  test('the current pay and pays older than the last 6 are excluded', () => {
    spendingLine('Groceries', ['groceries'])
    template()
    COUNTED.forEach((pay) => {
      spend(pay, 5000, 'groceries')
      spend(pay, 2000, 'takeaway')
    })
    for (const pay of [PAYS[0], CURRENT]) {
      spend(pay, 99999, 'groceries')
      spend(pay, 88888, 'takeaway')
    }
    const dto = std()
    expect(dto.payCount).toBe(6)
    expect(lineOf('Groceries', dto).spentCents).toBe(5000)
    expect(dto.period.notBudgetedCents).toBe(2000)
  })

  test('limits use their current categories across past pays', () => {
    spendingLine('Takeaway', ['takeaway'])
    template()
    COUNTED.forEach((pay) => spend(pay, 4000, 'takeaway'))
    expect(lineOf('Takeaway').spentCents).toBe(4000)
    expect(std().period.notBudgetedCents).toBe(0)
  })

  test("archived lines' categories count towards Other spending", () => {
    const id = spendingLine('Takeaway', ['takeaway'])
    spendingLine('Groceries', ['groceries'])
    archiveLine(db, id, 'u1', NOW, TZ)
    template()
    COUNTED.forEach((pay) => spend(pay, 4000, 'takeaway'))
    const dto = std()
    expect(dto.period.lines.map((l) => l.name)).toEqual(['Groceries'])
    expect(dto.period.notBudgetedCents).toBe(4000)
  })

  test("matches getBudgetPeriod's counting", () => {
    const pays = ['2026-02-12', '2026-02-26', '2026-03-12', '2026-03-26']
    setPays(pays)
    const groceries = spendingLine('Groceries', ['groceries'])
    fundLine('Food', 'saver-food', 20000)
    template([])
    for (const pay of pays.slice(0, 3)) {
      spend(pay, 5000, 'groceries')
      spend(pay, -1000, 'groceries') // refund
      spend(pay, 3000, 'takeaway')
      spend(pay, 2000, null, { transferAccountId: 'saver-food' }) // transfer out
      spend(pay, -7000, null) // uncategorised inflow
      spend(pay, 9000, 'groceries', { deletedAt: '2026-04-01T00:00:00.000Z' })
      spend(pay, -1500, null, { transferAccountId: 'saver-food' }) // moved back from a Saver
    }
    const dto = getStandardPay(db, 'u1', NOW, TZ)!
    const real = getBudgetPeriod(db, { budgetId: mine(), date: '2026-03-12', now: NOW, tz: TZ })!
    expect(dto.payCount).toBe(3)
    expect(real.lines.find((l) => l.lineId === groceries)!.spentCents).toBe(4000)
    for (const l of dto.period.lines) {
      expect(l.spentCents).toBe(real.lines.find((r) => r.lineId === l.lineId)!.spentCents)
    }
    expect(dto.period.notBudgetedCents).toBe(real.notBudgetedCents)
    expect(dto.period.notBudgetedCents).toBe(3000)
    expect(dto.period.movedBackCents).toBe(real.movedBackCents)
    expect(dto.period.movedBackCents).toBe(1500)
  })

  test('refunds above spending count as 0', () => {
    spendingLine('Groceries', ['groceries'])
    template()
    COUNTED.forEach((pay, i) => spend(pay, i < 3 ? 3000 : -2000, 'groceries'))
    expect(lineOf('Groceries').spentCents).toBe(1500)
  })

  test('usual pay is the median of known pay amounts', () => {
    template()
    setAmounts([400000, 400000, 410000, null, null, null])
    expect(std()).toMatchObject({ payIsMedian: true, plan: { incomeCents: 400000, incomeIsExpected: false } })
    setAmounts([400000, 420000, 410000, 430000, 440000, 450000])
    expect(std().plan.incomeCents).toBe(425000)
  })

  test("extra deposits don't change usual pay", () => {
    template()
    // Four of the six pays have one, so summing them would move the median.
    COUNTED.slice(0, 4).forEach((pay, i) => {
      seedTx(db, { id: `extra${i}`, accountId: 'acc-1', amountCents: 77700, createdAt: local(pay) })
      db.update(s.payEvents)
        .set({ extraTxIdsJson: JSON.stringify([`extra${i}`]) })
        .where(eq(s.payEvents.payDate, pay))
        .run()
    })
    expect(std().plan.incomeCents).toBe(400000)
  })

  test('falls back to expected pay below 3 known amounts', () => {
    template([onSaver('saver-food', 20000)], 123456)
    setAmounts([400000, 400000, null, null, null, null])
    expect(std()).toMatchObject({ payIsMedian: false, plan: { incomeCents: 123456, incomeIsExpected: true } })
  })

  test('fewer than 3 finished pays hides usual figures', () => {
    setPays(['2026-03-12', '2026-03-26', CURRENT])
    spendingLine('Groceries', ['groceries'])
    fundLine('Food', 'saver-food', 20000)
    template([])
    for (const pay of ['2026-03-12', '2026-03-26']) {
      spend(pay, 5000, 'groceries')
      spend(pay, 3000, 'takeaway')
      spend(pay, -1500, null, { transferAccountId: 'saver-food' })
    }
    const dto = std()
    expect(dto).toMatchObject({ payCount: 2, hasUsual: false })
    expect(dto.period.lines.map((l) => l.spentCents)).toEqual([0, 0])
    expect(dto.period.notBudgetedCents).toBe(0)
    expect(dto.period.movedBackCents).toBe(0)
  })

  test("uses line and template amounts, not this pay's", () => {
    const groceries = spendingLine('Groceries', ['groceries'])
    template([onSaver('saver-food', 20000)])
    applyPayChanges(
      db,
      'u1',
      {
        payDate: CURRENT,
        applyTo: 'this-pay',
        limits: [{ lineId: groceries, amountCents: 99900 }],
        savers: { set: [{ saverAccountId: 'saver-food', amountCents: 77700 }], remove: [] },
        lines: { create: [], update: [], archive: [] },
      },
      NOW,
      TZ,
    )
    const dto = std()
    expect(lineOf('Groceries', dto).amountCents).toBe(60000)
    expect(dto.plan.items.map((i) => i.amountCents)).toEqual([20000])
    expect(dto.plan.allocatedCents).toBe(20000)
  })

  test("a Saver only in this pay's plan is absent", () => {
    template([onSaver('saver-food', 20000), onSaver('saver-car', 5000)])
    putPayPlan(db, 'u1', CURRENT, [onSaver('saver-food', 20000), onSaver('saver-car', 5000)], NOW, TZ)
    template([onSaver('saver-food', 20000)])
    expect(getPayPlan(db, 'u1', CURRENT, NOW, TZ).items).toHaveLength(2)
    expect(std().plan.items.map((i) => i.saverAccountId)).toEqual(['saver-food'])
  })

  test('a 28-day period counts as one pay', () => {
    setPays(['2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12', '2026-03-12', '2026-03-26', CURRENT])
    spendingLine('Groceries', ['groceries'])
    template()
    for (const pay of ['2026-01-15', '2026-01-29', '2026-03-12', '2026-03-26']) spend(pay, 5000, 'groceries')
    spend('2026-02-12', 5000, 'groceries', { createdAt: local('2026-02-26') }) // mid-way through the long pay
    spend('2026-01-01', 5000, 'groceries')
    const dto = std()
    expect(dto.payCount).toBe(6)
    expect(lineOf('Groceries', dto).spentCents).toBe(5000)
  })

  test('no template returns null, and no pay events returns null', () => {
    expect(getStandardPay(db, 'u1', NOW, TZ)).toBeNull()
    template()
    expect(std()).not.toBeNull()
    db.delete(s.payEvents).run()
    expect(getStandardPay(db, 'u1', NOW, TZ)).toBeNull()
  })

  describe('joint', () => {
    test('uses its own periods', () => {
      template()
      const utilities = spendingLine('Utilities', ['utilities'], 30000, joint())
      spendingLine('Groceries', ['groceries'])
      COUNTED.forEach((pay) => {
        spend(pay, 3000, 'utilities', { accountId: 'acc-joint' })
        spend(pay, 9000, 'utilities') // personal account, not Joint's
      })
      const dto = std()
      const jointLine = dto.jointPeriod!.lines.find((l) => l.lineId === utilities)!
      expect(dto.jointHasUsual).toBe(true)
      expect(jointLine).toMatchObject({ spentCents: 3000, amountCents: 30000, coverage: null })
      expect(dto.jointPeriod!.budgetId).toBe(joint())
      expect(dto.jointPeriod!.incomeCents).toBe(0)
    })

    test('is judged on Joint finished pays, and is null with no joint pay events', () => {
      template()
      spendingLine('Utilities', ['utilities'], 30000, joint())
      seedEvents(db, 'u2', ['2026-03-26', CURRENT])
      db.update(s.budgets).set({ anchorUserId: 'u2' }).where(eq(s.budgets.id, joint())).run()
      const dto = std()
      expect(dto.hasUsual).toBe(true)
      expect(dto.jointHasUsual).toBe(false)
      expect(dto.jointPeriod).not.toBeNull()

      db.delete(s.payEvents).where(eq(s.payEvents.userId, 'u2')).run()
      expect(std().jointPeriod).toBeNull()
      expect(std().jointHasUsual).toBe(false)
    })
  })

  test('period spans the pays counted', () => {
    template()
    expect(std().period).toMatchObject({ start: COUNTED[0], end: CURRENT, isCurrent: false })
    setPays([CURRENT])
    expect(std().period).toMatchObject({ start: CURRENT, end: CURRENT, isCurrent: false })
    expect(std().payCount).toBe(0)
  })

  test('reading writes nothing', () => {
    spendingLine('Groceries', ['groceries'])
    template()
    const counts = () => [s.periodLines, s.payPlans, s.payPlanItems].map((t) => db.select().from(t).all().length)
    const before = counts()
    expect(db.select().from(s.payPlans).where(eq(s.payPlans.payDate, CURRENT)).all()).toHaveLength(0)
    std()
    expect(counts()).toEqual(before)
  })

  test("applying every-pay while the current pay is customised shows in the DTO and keeps it customised", () => {
    template([onSaver('saver-food', 20000)])
    putPayPlan(db, 'u1', CURRENT, [onSaver('saver-food', 20000)], NOW, TZ)
    applyPayChanges(
      db,
      'u1',
      {
        payDate: CURRENT,
        applyTo: 'every-pay',
        limits: [],
        savers: { set: [{ saverAccountId: 'saver-food', amountCents: 25000 }], remove: [] },
        lines: { create: [], update: [], archive: [] },
      },
      NOW,
      TZ,
    )
    expect(std().plan.items.find((i) => i.saverAccountId === 'saver-food')!.amountCents).toBe(25000)
    expect(getPayPlan(db, 'u1', CURRENT, NOW, TZ).customised).toBe(true)
  })
})

describe('GET /api/budgets/standard-pay/:userId', () => {
  let t: TestApp
  let owner: string
  let partner: string
  let ownerId: string

  const call = async (path: string, cookie?: string) => {
    const res = await t.json(path, { cookie })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  beforeEach(async () => {
    t = createTestApp({ now: new Date(local('2026-02-28', '12:00')) })
    owner = await t.setupOwner()
    partner = await t.addPartner(owner)
    ownerId = (await call('/api/me', owner)).body.id
    t.fake.addAccount(t.buildAccount({ id: 'acc-spending', displayName: 'Spending' }))
    t.fake.addCustomer('up:yeah:owner', ['acc-spending'])
    ;['2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12', '2026-02-26'].forEach((d, i) =>
      t.fake.addTransaction(
        t.buildTransaction({
          id: `pay${i}`,
          accountId: 'acc-spending',
          amountCents: 400000,
          createdAt: local(d),
          description: 'ACME PAY',
          categoryId: null,
        }),
      ),
    )
    const conn = await t.engine.connect(ownerId, 'up:yeah:owner')
    await t.engine.backfill(conn.id)
    await t.json('/api/pay-schedule', { method: 'PUT', cookie: owner, body: { transactionId: 'pay4' } })
    await t.json('/api/plan-template', {
      method: 'PUT',
      cookie: owner,
      body: { expectedIncomeCents: 400000, items: [] },
    })
  })

  test("a partner's Standard pay is readable", async () => {
    await call('/api/budgets', partner) // the page lists budgets first, which creates them
    const res = await call(`/api/budgets/standard-pay/${ownerId}`, partner)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ plan: { userId: ownerId, incomeCents: 400000 }, payCount: 4, hasUsual: true })
  })

  test('an unknown user is a 404', async () => {
    expect(await call('/api/budgets/standard-pay/nobody', owner)).toEqual({
      status: 404,
      body: { error: 'User not found' },
    })
  })

  test('signed out is a 401', async () => {
    expect((await call(`/api/budgets/standard-pay/${ownerId}`)).status).toBe(401)
  })
})

describe('a Standard pay preview matches what Apply leaves', () => {
  const saverDto = (id: string, name: string): AccountDto => ({
    id,
    displayName: name,
    accountType: 'SAVER',
    ownership: 'INDIVIDUAL',
    ownerUserId: 'u1',
    ownerName: null,
    balanceCents: 100000,
    currency: 'AUD',
    colorIndex: 0,
  })
  const accounts = [saverDto('saver-food', 'Food'), saverDto('saver-car', 'Car')]
  const viewOf = (dto: StandardPayDto, draft?: PayDraft) =>
    buildPayView({ plan: dto.plan, period: dto.period, jointPeriod: dto.jointPeriod, accounts, goals: [], draft, standard: { hasUsual: dto.hasUsual } })
  const figures = (v: ReturnType<typeof viewOf>) => ({ saversCents: v.saversCents, leftToSpendCents: v.leftToSpendCents })

  /** Previews the edit, applies it to every pay, and returns the preview's figures with those of a freshly loaded Standard pay. */
  function previewAndApply(edit: (draft: PayDraft) => PayDraft) {
    const before = std()
    const saved = viewOf(before)
    const draft = edit(startDraft(saved))
    const preview = viewOf(before, draft)
    applyPayChanges(db, 'u1', draftChanges(preview, saved, draft, before.plan.payDate, 'every-pay'), NOW, TZ)
    return { preview: figures(preview), after: figures(viewOf(std())), saved: figures(saved) }
  }

  function seedSpending() {
    COUNTED.forEach((pay) => spend(pay, 10000, 'groceries'))
  }

  test('raising a Saver', () => {
    spendingLine('Groceries', ['groceries'], 40000)
    template([onSaver('saver-food', 20000)])
    seedSpending()
    const { preview, after, saved } = previewAndApply((d) => ({ ...d, amounts: { 'saver:saver-food': 35000 } }))
    expect(preview.saversCents).not.toBe(saved.saversCents)
    expect(after).toEqual(preview)
  })

  test('raising a limit', () => {
    const groceries = spendingLine('Groceries', ['groceries'], 40000)
    template([onSaver('saver-food', 20000)])
    seedSpending()
    const { preview, after, saved } = previewAndApply((d) => ({ ...d, amounts: { [`line:${groceries}`]: 55000 } }))
    expect(preview.leftToSpendCents).toBe(saved.leftToSpendCents)
    expect(after).toEqual(preview)
  })

  test("linking a limit to a Saver when the line's amount differs from its template item", () => {
    const groceries = spendingLine('Groceries', ['groceries'], 40000)
    template([{ targetKind: 'line', lineId: groceries, saverAccountId: null, amountCents: 30000 }])
    seedSpending()
    const { preview, after } = previewAndApply((d) => ({ ...d, updates: { [groceries]: { saverAccountId: 'saver-car' } } }))
    expect(preview.saversCents).toBe(30000)
    expect(after).toEqual(preview)
  })
})
