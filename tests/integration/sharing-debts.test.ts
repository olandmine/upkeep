import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import { markRepayment, matchedRepayments } from '../../src/server/debts/repayments'
import type { SharingLevel } from '../../src/shared/sharing'
import type { DebtDetailDto, DebtDto, GoalsDto, NetWorthDto, PayoffPlanDto } from '../../src/shared/types'
import { createTestApp, OWNER, type TestApp } from '../helpers/app'
import { seedAccount, seedTx, TZ } from '../helpers/budget-seed'

// The viewer is the owner login; the "owner" of the hidden data is the partner login, whose level varies.
const OTHER_ID = 'other'
const STAMP = '2026-01-01T00:00:00.000Z'
let t: TestApp
let cookie: string
let viewerId: string

const get = (path: string) => t.json(path, { cookie })
const send = (path: string, method: string, body?: unknown) => t.json(path, { method, body, cookie })
const setLevel = (level: SharingLevel | null) =>
  t.db.update(s.users).set({ sharingLevel: level }).where(eq(s.users.id, OTHER_ID)).run()

function seedDebt(id: string, owner: string | null, name = id) {
  t.db
    .insert(s.debts)
    .values({
      id,
      ownerUserId: owner,
      kind: 'loan',
      name,
      repaymentCents: 10_000,
      repaymentFrequency: 'monthly',
      createdByUserId: owner ?? viewerId,
      createdAt: STAMP,
      updatedAt: STAMP,
    })
    .run()
  t.db.insert(s.debtBalances).values({ id: `${id}-b`, debtId: id, asOf: '2026-09-01', balanceCents: 100_000, createdAt: STAMP }).run()
  t.db.insert(s.debtRates).values({ id: `${id}-r`, debtId: id, fromDate: '2026-09-01', rateBp: 600, createdAt: STAMP }).run()
}

const rule = (debtId: string, match: string) =>
  t.db.insert(s.debtRepaymentRules).values({ id: `${debtId}-${match}`, debtId, match }).run()
/** The person has agreed to the rule, as if they had marked one of their own transactions under it. */
const agree = (debtId: string, match: string, userId: string) =>
  t.db.insert(s.debtRepaymentRulePeople).values({ ruleId: `${debtId}-${match}`, userId }).run()
const detail = async (id: string) => (await (await get(`/api/debts/${id}`)).json()) as DebtDetailDto
const rules = () => t.db.select().from(s.debtRepaymentRules).all()

beforeEach(async () => {
  t = createTestApp({ now: new Date('2026-10-29T00:00:00Z') })
  cookie = await t.setupOwner()
  viewerId = t.db.select().from(s.users).where(eq(s.users.username, OWNER.username)).get()!.id
  t.db
    .insert(s.users)
    .values({ id: OTHER_ID, username: 'partner', displayName: 'Partner', passwordHash: 'x', createdAt: STAMP, sharingLevel: 'full' })
    .run()
  seedAccount(t.db, { id: 'o-spend', owner: OTHER_ID, name: 'Their Spending', balanceCents: 50_000 })
  seedAccount(t.db, { id: 'v-spend', owner: viewerId, balanceCents: 3_000 })
  seedDebt('theirs', OTHER_ID)
  seedDebt('mine', viewerId)
  seedDebt('shared', null)
})

describe.each(['balances', 'none', null] as const)('at %s', (level) => {
  beforeEach(() => setLevel(level))

  test('GET /debts leaves out the owner debt', async () => {
    const debts = (await (await get('/api/debts')).json()) as DebtDto[]
    expect(debts.map((d) => d.id).sort()).toEqual(['mine', 'shared'])
  })

  test('GET /debts/:id is 404 with the same body as an unknown id', async () => {
    const hidden = await get('/api/debts/theirs')
    const unknown = await get('/api/debts/nope')
    expect(hidden.status).toBe(404)
    expect(await hidden.json()).toEqual(await unknown.json())
  })

  test('a write is 404, not 403, and changes nothing', async () => {
    const patch = await send('/api/debts/theirs', 'PATCH', { name: 'Renamed' })
    const balance = await send('/api/debts/theirs/balances', 'POST', { balanceCents: 1, asOf: '2026-10-01' })
    const del = await send('/api/debts/theirs', 'DELETE')
    expect([patch.status, balance.status, del.status]).toEqual([404, 404, 404])
    const row = t.db.select().from(s.debts).where(eq(s.debts.id, 'theirs')).get()!
    expect(row.name).toBe('theirs')
    expect(t.db.select().from(s.debtBalances).where(eq(s.debtBalances.debtId, 'theirs')).all()).toHaveLength(1)
  })

  test('every other debt write is 404 too', async () => {
    const calls = [
      send('/api/debts/theirs/rates', 'POST', { fromDate: '2026-10-01', rateBp: 100 }),
      send('/api/debts/theirs/entries', 'POST', { kind: 'added', date: '2026-10-01', amountCents: 100 }),
      send('/api/debts/theirs/interest/2026-10-31', 'PUT', { amountCents: 1 }),
      send('/api/debts/theirs/import', 'POST', { csv: 'x', dryRun: true }),
      send('/api/debts/theirs/repayments', 'POST', { transactionId: 'x', matchFuture: false }),
      send('/api/debts/theirs/repayment-rules/x', 'DELETE'),
      send('/api/debts/theirs/exclusions', 'POST', { transactionId: 'x' }),
      send('/api/debts/theirs/exclusions/x', 'DELETE'),
    ]
    expect((await Promise.all(calls)).map((r) => r.status)).toEqual(Array(calls.length).fill(404))
  })

  test('net worth counts their accounts but not their debt', async () => {
    const today = async () => ((await (await get('/api/net-worth')).json()) as NetWorthDto).points.at(-1)!
    t.db.delete(s.debts).where(eq(s.debts.id, 'theirs')).run()
    const without = await today()
    seedDebt('theirs', OTHER_ID)
    const withDebt = await today()
    expect(withDebt.debtCents).toBe(without.debtCents)
    expect(withDebt.upCents).toBe(level === 'none' || level === null ? 3_000 : 53_000)
  })

  test('the payoff plan leaves out their debt', async () => {
    const plan = (await (await get('/api/payoff-plan?scope=everyone')).json()) as PayoffPlanDto
    const names = plan.scenarios.flatMap((sc) => sc.debts.map((d) => d.id))
    expect(names).toContain('mine')
    expect(names).not.toContain('theirs')
  })

  test('the partner payoff settings come back as defaults', async () => {
    t.db.insert(s.payoffSettings).values({ scope: `user:${OTHER_ID}`, extraCents: 5_000, includeHecs: true }).run()
    const plan = (await (await get('/api/payoff-plan?scope=partner')).json()) as PayoffPlanDto
    expect([plan.extraCents, plan.includeHecs]).toEqual([0, false])
  })

  test('putting a goal on their Saver is 404', async () => {
    seedAccount(t.db, { id: 'o-save', owner: OTHER_ID, type: 'SAVER', name: 'Their Saver' })
    const body = { name: 'Trip', targetCents: 1_000, targetDate: null }
    const res = await send('/api/goals/o-save', 'PUT', body)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Saver not found' })
    expect((await send('/api/goals/o-save', 'DELETE')).status).toBe(404)
    expect(t.db.select().from(s.goals).all()).toEqual([])
  })

  test('the rule conflict error hides the name of a hidden debt', async () => {
    rule('theirs', 'gym')
    seedTx(t.db, { id: 'g1', accountId: 'v-spend', amountCents: -500, createdAt: '2026-10-10T00:00:00Z', description: 'Gym' })
    const res = await send('/api/debts/shared/repayments', 'POST', { transactionId: 'g1', matchFuture: true })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'That description already marks repayments for another debt.' })
  })

  test('a matching rule on a hidden debt does not reveal its name', async () => {
    rule('theirs', 'gym')
    seedTx(t.db, { id: 'g1', accountId: 'v-spend', amountCents: -500, createdAt: '2026-10-10T00:00:00Z', description: 'Gym' })
    const res = await get('/api/transactions/g1/repayment')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  test('a goal whose Saver has gone is hidden', async () => {
    t.db.insert(s.goals).values({ accountId: 'gone', name: 'Old', targetCents: 100, targetDate: null, createdAt: STAMP, updatedAt: STAMP }).run()
    const { goals } = (await (await get('/api/goals')).json()) as GoalsDto
    expect(goals.map((g) => g.accountId)).not.toContain('gone')
  })
})

describe('at hide-transactions', () => {
  beforeEach(() => {
    setLevel('hide-transactions')
    rule('theirs', 'loan payment')
    seedTx(t.db, { id: 'p1', accountId: 'o-spend', amountCents: -20_000, createdAt: '2026-10-10T00:00:00Z', description: 'Loan Payment' })
    t.db.insert(s.debtRepaymentExclusions).values({ debtId: 'theirs', transactionId: 'p1' }).run()
    seedTx(t.db, { id: 'p2', accountId: 'o-spend', amountCents: -10_000, createdAt: '2026-10-12T00:00:00Z', description: 'Loan Payment' })
  })

  test('their debt is readable without rules, exclusions or repayment rows, and keeps its balance', async () => {
    t.db.update(s.users).set({ sharingLevel: 'full' }).where(eq(s.users.id, OTHER_ID)).run()
    const full = await detail('theirs')
    expect(full.repaymentRules).toHaveLength(1)
    expect(full.exclusions).toHaveLength(1)
    expect(full.activity.filter((a) => a.kind === 'repayment')).toHaveLength(1)
    setLevel('hide-transactions')
    const res = await get('/api/debts/theirs')
    expect(res.status).toBe(200)
    const hidden = (await res.json()) as DebtDetailDto
    expect(hidden.repaymentRules).toEqual([])
    expect(hidden.exclusions).toEqual([])
    expect(hidden.activity.filter((a) => a.kind === 'repayment')).toEqual([])
    expect(hidden.balanceCents).toBe(full.balanceCents)
  })

  test('a write is still 403', async () => {
    const res = await send('/api/debts/theirs', 'PATCH', { name: 'Renamed' })
    expect(res.status).toBe(403)
  })

  test('a joint debt drops a repayment row from a hidden account and keeps its balance', async () => {
    rule('shared', 'shop pay')
    agree('shared', 'shop pay', OTHER_ID)
    seedTx(t.db, { id: 'a1', accountId: 'o-spend', amountCents: -30_000, createdAt: '2026-10-10T00:00:00Z', description: 'Shop Pay' })
    seedTx(t.db, { id: 'a2', accountId: 'v-spend', amountCents: -5_000, createdAt: '2026-10-11T00:00:00Z', description: 'Shop Pay' })
    const rows = (d: DebtDetailDto) =>
      d.activity.flatMap((a) => (a.kind === 'repayment' ? [a.transactionId] : []))
    t.db.update(s.users).set({ sharingLevel: 'full' }).where(eq(s.users.id, OTHER_ID)).run()
    const full = await detail('shared')
    expect(rows(full).sort()).toEqual(['a1', 'a2'])
    setLevel('hide-transactions')
    const hidden = await detail('shared')
    expect(rows(hidden)).toEqual(['a2'])
    expect(hidden.balanceCents).toBe(full.balanceCents)
  })

  test('marking a hidden transaction on a joint debt returns 404 and stores nothing', async () => {
    seedTx(t.db, { id: 'h1', accountId: 'o-spend', amountCents: -700, createdAt: '2026-10-10T00:00:00Z', description: 'Secret Shop' })
    const before = rules()
    const res = await send('/api/debts/shared/repayments', 'POST', { transactionId: 'h1', matchFuture: true })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Transaction not found' })
    expect(rules()).toEqual(before)
    expect(t.db.select().from(s.debtRepaymentLinks).all()).toEqual([])
  })

  test('excluding a hidden transaction on a joint debt returns 404 and stores nothing', async () => {
    seedTx(t.db, { id: 'h1', accountId: 'o-spend', amountCents: -700, createdAt: '2026-10-10T00:00:00Z', description: 'Secret Shop' })
    const res = await send('/api/debts/shared/exclusions', 'POST', { transactionId: 'h1' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Transaction not found' })
    expect(t.db.select().from(s.debtRepaymentExclusions).where(eq(s.debtRepaymentExclusions.debtId, 'shared')).all()).toEqual([])
  })

  test('undoing an exclusion of a hidden transaction returns 404 and keeps it', async () => {
    seedTx(t.db, { id: 'h1', accountId: 'o-spend', amountCents: -700, createdAt: '2026-10-10T00:00:00Z', description: 'Secret Shop' })
    t.db.insert(s.debtRepaymentExclusions).values({ debtId: 'shared', transactionId: 'h1' }).run()
    const res = await send('/api/debts/shared/exclusions/h1', 'DELETE')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Transaction not found' })
    expect(t.db.select().from(s.debtRepaymentExclusions).where(eq(s.debtRepaymentExclusions.debtId, 'shared')).all()).toHaveLength(1)
  })

  test('excluding an id with no transaction row is still accepted', async () => {
    expect((await send('/api/debts/shared/exclusions', 'POST', { transactionId: 'nope' })).status).toBe(204)
  })

  test('the viewer can still mark their own transaction on a joint debt', async () => {
    seedTx(t.db, { id: 'v9', accountId: 'v-spend', amountCents: -700, createdAt: '2026-10-10T00:00:00Z', description: 'My Shop' })
    expect((await send('/api/debts/shared/repayments', 'POST', { transactionId: 'v9', matchFuture: false })).status).toBe(204)
  })

  test('the conflict error does not link a description to their debt', async () => {
    rule('theirs', 'gym')
    seedTx(t.db, { id: 'g1', accountId: 'v-spend', amountCents: -500, createdAt: '2026-10-10T00:00:00Z', description: 'Gym' })
    const res = await send('/api/debts/shared/repayments', 'POST', { transactionId: 'g1', matchFuture: true })
    expect(await res.json()).toEqual({ error: 'That description already marks repayments for another debt.' })
  })

  test('the partner payoff settings stay visible', async () => {
    t.db.insert(s.payoffSettings).values({ scope: `user:${OTHER_ID}`, extraCents: 5_000, includeHecs: true }).run()
    const plan = (await (await get('/api/payoff-plan?scope=partner')).json()) as PayoffPlanDto
    expect([plan.extraCents, plan.includeHecs]).toEqual([5_000, true])
  })
})

describe('the rule conflict error', () => {
  const conflict = async (debtId: string) => {
    rule(debtId, 'gym')
    seedTx(t.db, { id: 'g1', accountId: 'v-spend', amountCents: -500, createdAt: '2026-10-10T00:00:00Z', description: 'Gym' })
    const target = debtId === 'shared' ? 'mine' : 'shared'
    return (await send(`/api/debts/${target}/repayments`, 'POST', { transactionId: 'g1', matchFuture: true })).json()
  }

  test.each(['hide-transactions', 'balances', 'none'] as const)('names a joint debt at %s', async (level) => {
    setLevel(level)
    expect(await conflict('shared')).toEqual({ error: 'That description already marks repayments for shared.' })
  })

  test("names the viewer's own debt", async () => {
    setLevel('none')
    expect(await conflict('mine')).toEqual({ error: 'That description already marks repayments for mine.' })
  })

  test('names their debt at full', async () => {
    expect(await conflict('theirs')).toEqual({ error: 'That description already marks repayments for theirs.' })
  })
})

describe('a repayment rule on a joint debt', () => {
  const buy = (id: string, accountId: string, amountCents: number, createdAt: string, description = 'Secret Clinic') =>
    seedTx(t.db, { id, accountId, amountCents, createdAt, description })
  /** Everything a viewer could read the partner's spending from. */
  const figures = async () => {
    const debt = await detail('shared')
    const netWorth = (await (await get('/api/net-worth?scope=joint&range=all')).json()) as NetWorthDto
    const plan = (await (await get('/api/payoff-plan?scope=joint')).json()) as PayoffPlanDto
    return { balance: debt.balanceCents, timeline: debt.timeline, netWorth: netWorth.points.map((p) => p.debtCents), plan }
  }
  /** What the viewer's Activity lists. */
  const listed = async () =>
    (await detail('shared')).activity.flatMap((a) => (a.kind === 'repayment' ? [a.transactionId] : [])).sort()
  /** What counts toward the debt, listed or not. */
  const counted = () => {
    const debt = t.db.select().from(s.debts).where(eq(s.debts.id, 'shared')).get()!
    return matchedRepayments(t.db, debt, '2026-09-01', TZ).map((r) => r.transactionId).sort()
  }

  beforeEach(async () => {
    buy('v-1', 'v-spend', -100, '2026-09-10T01:00:00Z')
    expect((await send('/api/debts/shared/repayments', 'POST', { transactionId: 'v-1', matchFuture: true })).status).toBe(204)
  })

  test.each(['hide-transactions', 'balances', 'none', null] as const)(
    "a rule the viewer adds to a joint debt does not read the partner's hidden transactions, at %s",
    async (level) => {
      setLevel(level)
      const before = await figures()
      buy('o-1', 'o-spend', -43_117, '2026-10-10T01:00:00Z')
      buy('o-2', 'o-spend', -20_000, '2026-10-20T01:00:00Z')
      expect(await figures()).toEqual(before)
      expect(counted()).toEqual(['v-1'])
    },
  )

  test("at full, the partner's matching outflows count", async () => {
    const before = await figures()
    buy('o-1', 'o-spend', -43_117, '2026-10-10T01:00:00Z')
    buy('o-2', 'o-spend', -20_000, '2026-10-20T01:00:00Z')
    const after = await figures()
    expect(before.balance - after.balance).toBeGreaterThanOrEqual(63_117)
    expect(after.timeline).not.toEqual(before.timeline)
    expect(after.netWorth).not.toEqual(before.netWorth)
    expect(after.plan).not.toEqual(before.plan)
    expect(await listed()).toEqual(['o-1', 'o-2', 'v-1'])
  })

  test('joint accounts always count', async () => {
    setLevel('none')
    seedAccount(t.db, { id: 'j-spend', owner: null, ownership: 'JOINT' })
    buy('j-1', 'j-spend', -700, '2026-10-10T01:00:00Z')
    expect(counted()).toEqual(['j-1', 'v-1'])
  })

  test("a person's own marked transaction agrees for their own accounts", async () => {
    setLevel('none')
    buy('o-1', 'o-spend', -43_117, '2026-10-10T01:00:00Z')
    const before = await figures()
    expect(counted()).toEqual(['v-1'])

    markRepayment(t.db, 'shared', 'o-1', true, OTHER_ID)
    buy('o-2', 'o-spend', -20_000, '2026-10-20T01:00:00Z')
    expect(counted()).toEqual(['o-1', 'o-2', 'v-1'])
    const after = await figures()
    expect(before.balance - after.balance).toBeGreaterThanOrEqual(63_117)
    // They agreed to their repayments counting, not to the viewer reading the rows.
    expect(await listed()).toEqual(['v-1'])
    expect(rules()).toHaveLength(1)
  })

  test('agreeing to one rule leaves the others alone', async () => {
    setLevel('none')
    buy('o-3', 'o-spend', -300, '2026-10-11T01:00:00Z', 'Other Shop')
    buy('o-4', 'o-spend', -400, '2026-10-12T01:00:00Z', 'Third Shop')
    rule('shared', 'third shop')
    markRepayment(t.db, 'shared', 'o-3', true, OTHER_ID)
    expect(counted()).toEqual(['o-3', 'v-1'])
  })

  test('marking under the same rule again adds no second row for that person', async () => {
    buy('v-2', 'v-spend', -200, '2026-09-11T01:00:00Z')
    expect((await send('/api/debts/shared/repayments', 'POST', { transactionId: 'v-2', matchFuture: true })).status).toBe(204)
    expect(t.db.select().from(s.debtRepaymentRulePeople).all().map((r) => r.userId)).toEqual([viewerId])
  })

  test('a one-off link still counts when the level drops', async () => {
    buy('o-5', 'o-spend', -500, '2026-10-13T01:00:00Z')
    expect((await send('/api/debts/shared/repayments', 'POST', { transactionId: 'o-5', matchFuture: false })).status).toBe(204)
    setLevel('none')
    expect(counted()).toEqual(['o-5', 'v-1'])
  })

  test('removing the rule removes the agreement', async () => {
    const [{ id }] = rules()
    expect((await send(`/api/debts/shared/repayment-rules/${id}`, 'DELETE')).status).toBe(204)
    expect(t.db.select().from(s.debtRepaymentRulePeople).all()).toEqual([])
  })
})

describe('a personal debt', () => {
  test.each(['full', 'hide-transactions', 'balances', 'none', null] as const)(
    "a personal debt's rule keeps matching its owner's accounts at every level, at %s",
    (level) => {
      setLevel(level)
      t.db.update(s.users).set({ sharingLevel: level }).where(eq(s.users.id, viewerId)).run()
      rule('theirs', 'loan payment')
      rule('mine', 'my loan')
      seedTx(t.db, { id: 'p1', accountId: 'o-spend', amountCents: -20_000, createdAt: '2026-10-10T00:00:00Z', description: 'Loan Payment' })
      seedTx(t.db, { id: 'p2', accountId: 'v-spend', amountCents: -1_000, createdAt: '2026-10-11T00:00:00Z', description: 'My Loan' })
      const matched = (id: string) => {
        const debt = t.db.select().from(s.debts).where(eq(s.debts.id, id)).get()!
        return matchedRepayments(t.db, debt, '2026-09-01', TZ).map((r) => r.transactionId)
      }
      expect(matched('theirs')).toEqual(['p1'])
      expect(matched('mine')).toEqual(['p2'])
    },
  )
})

describe('goals', () => {
  const orphan = () =>
    t.db.insert(s.goals).values({ accountId: 'gone', name: 'Old', targetCents: 100, targetDate: null, createdAt: STAMP, updatedAt: STAMP }).run()
  const ids = async () => ((await (await get('/api/goals')).json()) as GoalsDto).goals.map((g) => g.accountId)

  test('a goal whose Saver has gone shows only with finances access', async () => {
    orphan()
    for (const level of ['balances', 'none', null] as const) {
      setLevel(level)
      expect(await ids()).not.toContain('gone')
    }
    for (const level of ['hide-transactions', 'full'] as const) {
      setLevel(level)
      expect(await ids()).toContain('gone')
    }
  })

  test('deleting a goal whose Saver has gone needs the same access as seeing it', async () => {
    orphan()
    for (const level of ['balances', 'none', null] as const) {
      setLevel(level)
      const res = await send('/api/goals/gone', 'DELETE')
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Saver not found' })
      expect(t.db.select().from(s.goals).all()).toHaveLength(1)
    }
    setLevel('full')
    expect((await send('/api/goals/gone', 'DELETE')).status).toBe(204)
    expect(t.db.select().from(s.goals).all()).toEqual([])
    expect((await send('/api/goals/unknown', 'DELETE')).status).toBe(204)
  })

  test('a goal whose Saver has gone shows when there is no other person', async () => {
    orphan()
    setLevel('none')
    t.db.delete(s.users).where(eq(s.users.id, OTHER_ID)).run()
    expect(await ids()).toContain('gone')
  })
})
