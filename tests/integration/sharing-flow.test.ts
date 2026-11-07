import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import { ensureBudgets, listBudgetRows } from '../../src/server/budgets/budgets'
import { createLine } from '../../src/server/budgets/lines'
import { putPayPlan } from '../../src/server/budgets/plans'
import type { Db } from '../../src/server/db/client'
import * as s from '../../src/server/db/schema'
import { getPayFlow } from '../../src/server/payflow/gather'
import { getSyncStatus } from '../../src/server/sync/status'
import type { SharingLevel } from '../../src/shared/sharing'
import type { PayFlowDto, PayFlowGroup, PayFlowMode, PayFlowRange, Scope } from '../../src/shared/types'
import { createTestDb } from '../helpers/db'
import {
  local,
  seedAccount,
  seedCategories,
  seedConnection,
  seedEvents,
  seedTx,
  seedUser,
  TZ,
} from '../helpers/budget-seed'

const NOW = new Date(local('2026-01-20', '12:00'))
const CATEGORIES = [
  { id: 'groceries', name: 'Groceries', parentId: null },
  { id: 'takeaway', name: 'Takeaway', parentId: null },
]
const MODES: PayFlowMode[] = ['actual', 'planned']
const GROUPS: PayFlowGroup[] = ['budget', 'accounts']
const RANGES: PayFlowRange[] = ['pay', 'month', 'year', 'fy']
const COMBOS = MODES.flatMap((mode) => GROUPS.map((group) => ({ mode, group })))
// u1 is the viewer; u2 is the owner of the data that gets hidden.
// Their account name is left out: balances shows it, so only 'none' hides it (own test below).
const OWNER_SECRETS = ['Their Saver','Their Line', 'THEIR EMPLOYER', 'Transfer to $sam']

let db: Db
const setLevel = (level: SharingLevel | null) =>
  db.update(s.users).set({ sharingLevel: level }).where(eq(s.users.id, 'u2')).run()
const flow = (
  scope: Scope,
  mode: PayFlowMode,
  group: PayFlowGroup,
  range: PayFlowRange = 'pay',
  viewerId = 'u1',
): PayFlowDto =>
  getPayFlow(db, { scope, mode, group, range, date: '2026-01-20', viewerId, now: NOW, tz: TZ })
const text = (f: PayFlowDto) => f.nodes.flatMap((n) => [n.label, n.caption ?? ''])
const labels = (f: PayFlowDto) => f.nodes.map((n) => n.label)

beforeEach(() => {
  db = createTestDb()
  seedUser(db, 'u1', 'Viewer', '2026-01-01T00:00:00.000Z')
  seedUser(db, 'u2', 'Partner', '2026-01-02T00:00:00.000Z')
  seedConnection(db, 'u1')
  seedConnection(db, 'u2')
  seedCategories(db, CATEGORIES)
  seedAccount(db, { id: 'me-spend', owner: 'u1', name: 'Spending' })
  seedAccount(db, { id: 'their-spend', owner: 'u2', name: 'Their Spending' })
  seedAccount(db, { id: 'their-save', owner: 'u2', type: 'SAVER', name: 'Their Saver' })
  seedAccount(db, { id: 'joint-spend', owner: null, ownership: 'JOINT', name: '2Up Spending' })
  seedAccount(db, { id: 'joint-save', owner: null, ownership: 'JOINT', type: 'SAVER', name: 'Joint Saver' })

  seedEvents(db, 'u1', ['2026-01-01', '2026-01-15'])
  seedEvents(db, 'u2', ['2026-01-01', '2026-01-15'], 300000)
  for (const [userId, account, description] of [
    ['u1', 'me-spend', 'ACME PAY'],
    ['u2', 'their-spend', 'THEIR EMPLOYER'],
  ] as const) {
    for (const [i, date] of ['2026-01-01', '2026-01-15'].entries()) {
      seedTx(db, { id: `${userId}-pay${i}`, accountId: account, amountCents: 400000, createdAt: local(date), description })
    }
  }
  ensureBudgets(db, NOW)

  const budgetOf = (ownerUserId: string | null) => listBudgetRows(db).find((b) => b.ownerUserId === ownerUserId)!.id
  const line = (budgetId: string, userId: string, name: string, categoryId: string) =>
    createLine(db, budgetId, userId, { kind: 'spending', name, amountCents: 30000, categoryIds: [categoryId], saverAccountId: null }, NOW, TZ)
  const shared = line(budgetOf(null), 'u1', 'Shared Line', 'groceries')
  const theirs = line(budgetOf('u2'), 'u2', 'Their Line', 'takeaway')
  for (const date of ['2026-01-01', '2026-01-15']) {
    putPayPlan(db, 'u1', date, [{ targetKind: 'line', lineId: shared.id, saverAccountId: null, amountCents: 10000 }], NOW, TZ)
    putPayPlan(
      db,
      'u2',
      date,
      [
        { targetKind: 'saver', lineId: null, saverAccountId: 'their-save', amountCents: 20000 },
        { targetKind: 'line', lineId: theirs.id, saverAccountId: null, amountCents: 10000 },
      ],
      NOW,
      TZ,
    )
  }

  // Their spending, a joint purchase, and a transfer from their account into the joint Saver.
  seedTx(db, { id: 'their-buy', accountId: 'their-spend', amountCents: -2000, createdAt: local('2026-01-16'), categoryId: 'takeaway' })
  seedTx(db, { id: 'joint-buy', accountId: 'joint-spend', amountCents: -1500, createdAt: local('2026-01-16'), categoryId: 'groceries' })
  seedTx(db, {
    id: 'to-joint-out',
    accountId: 'their-spend',
    amountCents: -5000,
    createdAt: local('2026-01-17'),
    description: 'Transfer to $sam',
    transferAccountId: 'joint-save',
  })
  seedTx(db, {
    id: 'to-joint-in',
    accountId: 'joint-save',
    amountCents: 5000,
    createdAt: local('2026-01-17'),
    description: 'Round trip',
    transferAccountId: 'their-spend',
  })
})

describe('pay flow', () => {
  test.each(['balances', 'none'] as const)("scope=partner at '%s' is private, with nothing drawn", (level) => {
    setLevel(level)
    for (const { mode, group } of COMBOS) {
      for (const range of RANGES) {
        expect(flow('partner', mode, group, range)).toMatchObject({ state: 'private', nodes: [], edges: [] })
      }
    }
  })

  test.each(['balances', 'none'] as const)("scope=everyone at '%s' leaves out the owner's pay, lines and spending", (level) => {
    setLevel(level)
    for (const { mode, group } of COMBOS) {
      for (const range of RANGES) {
        const f = flow('everyone', mode, group, range)
        const where = `${mode}/${group}/${range}`
        expect(f.state, where).toBe('ready')
        // At balances a transfer from their account still reads "From Partner"; that isn't their pay.
        expect(f.nodes.map((n) => n.id).filter((id) => /u2/.test(id) && !(level === 'balances' && id === 'from:u2')), where).toEqual([])
        expect(text(f).filter((t) => OWNER_SECRETS.some((x) => t.includes(x))), where).toEqual([])
        expect(text(f).filter((t) => t.includes("Partner's pay")), where).toEqual([])
        // Joint stays.
        expect(labels(f).some((l) => l === 'Shared Line' || l === '2Up Spending'), where).toBe(true)
        expect(f.baseCents, where).toBe(range === 'pay' ? 400000 : 800000)
      }
    }
  })

  test("at 'none' a transfer from the owner's account into a joint Saver is an unnamed-account box", () => {
    setLevel('none')
    for (const range of RANGES) {
      for (const scope of ['everyone', 'joint'] as const) {
        const f = flow(scope, 'actual', 'accounts', range)
        expect(labels(f), `${scope}/${range}`).not.toContain('Their Spending')
        expect(labels(f), `${scope}/${range}`).toContain('Not synced')
        const jointSaver = f.nodes.find((n) => n.id === 'account:joint-save')!
        expect(jointSaver.amountCents).toBe(5000)
      }
    }
  })

  test("at 'none' a Round Up credit on a hidden account leaves no node or edge naming it", () => {
    setLevel('none')
    seedTx(db, { id: 'round-up', accountId: 'their-save', amountCents: 100, createdAt: local('2026-01-18'), transferAccountId: 'joint-spend', transactionType: 'Round Up' })
    for (const range of RANGES) {
      for (const scope of ['everyone', 'joint'] as const) {
        const f = flow(scope, 'actual', 'accounts', range)
        expect(JSON.stringify([f.nodes, f.edges]), `${scope}/${range}`).not.toContain('their-save')
      }
    }
  })

  test("at 'hide-transactions' a transfer to an unsynced account is not named from the owner's description", () => {
    seedTx(db, { id: 'to-sam', accountId: 'their-spend', amountCents: -700, createdAt: local('2026-01-18'), description: 'Transfer to $sam', transferAccountId: 'outside' })
    setLevel('full')
    expect(labels(flow('everyone', 'actual', 'accounts'))).toContain('To $sam')
    setLevel('hide-transactions')
    for (const scope of ['everyone', 'partner'] as const) {
      const f = flow(scope, 'actual', 'accounts')
      expect(labels(f), scope).toContain('Not synced')
      expect(text(f).filter((x) => x.includes('$sam')), scope).toEqual([])
    }
  })

  test("at 'balances' the same transfer still reaches the joint Saver", () => {
    setLevel('balances')
    const f = flow('joint', 'actual', 'accounts')
    expect(f.nodes.find((n) => n.id === 'account:joint-save')!.amountCents).toBe(5000)
    // Their account is named (balances show names), but nothing about what the transfer said.
    expect(text(f).filter((t) => t.includes('$sam'))).toEqual([])
  })

  test("at 'hide-transactions' the owner's pay says Pay, and no node is named from their descriptions", () => {
    setLevel('hide-transactions')
    for (const { mode, group } of COMBOS) {
      for (const range of RANGES) {
        const f = flow('everyone', mode, group, range)
        const where = `${mode}/${group}/${range}`
        const pay = f.nodes.find((n) => n.id === 'pay:u2')!
        expect(pay, where).toBeDefined()
        // The planned views caption a pay by its first date only.
        expect(pay.caption, where).toMatch(/^(Pay · \d+ Jan|2 pays · 1 Jan, 15 Jan)$/)
        expect(text(f).filter((t) => t.includes('THEIR EMPLOYER') || t.includes('$sam')), where).toEqual([])
      }
    }
  })

  test("at 'hide-transactions' an expected pay with no deposit still says Expected", () => {
    setLevel('hide-transactions')
    db.delete(s.transactions).where(eq(s.transactions.id, 'u2-pay1')).run()
    db.update(s.payEvents).set({ transactionId: null }).where(eq(s.payEvents.userId, 'u2')).run()
    const f = flow('everyone', 'actual', 'accounts')
    expect(f.nodes.find((n) => n.id === 'pay:u2')!.caption).toBe('Expected · 15 Jan')
  })

  test.each(COMBOS)(
    "at 'full' the owner's data is drawn ($mode/$group)",
    ({ mode, group }) => {
      const f = flow('everyone', mode, group)
      expect(f.nodes.find((n) => n.id === 'pay:u2')).toMatchObject({ caption: 'THEIR EMPLOYER · 15 Jan', amountCents: 300000 })
      expect(f.baseCents).toBe(700000)
      expect(flow('partner', mode, group).state).toBe('ready')
    },
  )
})

describe('sync status', () => {
  beforeEach(() => {
    db.update(s.upConnections).set({ lastError: 'Up said no', lastSyncedAt: '2026-01-19T00:00:00.000Z' }).where(eq(s.upConnections.userId, 'u2')).run()
    db.insert(s.syncRuns)
      .values([
        { id: 'r-failed', connectionId: 'c-u2', kind: 'incremental', status: 'failed', startedAt: '2026-01-18T00:00:00.000Z', finishedAt: '2026-01-18T00:01:00.000Z' },
        { id: 'r-running', connectionId: 'c-u2', kind: 'backfill', status: 'running', startedAt: '2026-01-20T00:00:00.000Z', transactionsUpserted: 321 },
      ])
      .run()
  })
  const theirs = (viewerId: string) => getSyncStatus(db, viewerId).connections.find((c) => c.userId === 'u2')!

  test("at 'hide-transactions' the other person's error and running count are dropped", () => {
    setLevel('hide-transactions')
    expect(theirs('u1')).toMatchObject({
      status: 'ok',
      lastSyncedAt: '2026-01-19T00:00:00.000Z',
      lastError: null,
      running: { kind: 'backfill', startedAt: '2026-01-20T00:00:00.000Z', transactionsUpserted: 0 },
    })
  })

  test.each(['balances', 'none', null] as const)("at '%s' too", (level) => {
    setLevel(level)
    expect(theirs('u1')).toMatchObject({ lastError: null, running: { transactionsUpserted: 0 } })
  })

  test("at 'full' every field is there", () => {
    expect(theirs('u1')).toMatchObject({
      lastError: 'Up said no',
      lastFailedAt: '2026-01-18T00:01:00.000Z',
      running: { kind: 'backfill', transactionsUpserted: 321 },
    })
  })

  test("a person's own row is never trimmed", () => {
    setLevel('none')
    expect(theirs('u2')).toMatchObject({ lastError: 'Up said no', running: { transactionsUpserted: 321 } })
  })
})
