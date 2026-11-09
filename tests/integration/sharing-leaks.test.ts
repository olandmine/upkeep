import { eq } from 'drizzle-orm'
import { beforeAll, expect, test } from 'vitest'
import { ensureBudgets, listBudgetRows } from '../../src/server/budgets/budgets'
import { createLine } from '../../src/server/budgets/lines'
import { putPayPlan, putTemplate } from '../../src/server/budgets/plans'
import * as s from '../../src/server/db/schema'
import type { SharingLevel } from '../../src/shared/sharing'
import { createTestApp, OWNER, type TestApp } from '../helpers/app'
import { local, seedAccount, seedCategories, seedConnection, seedTx, TZ } from '../helpers/budget-seed'

// The viewer is the owner login and has no personal data. The "other" person holds every marker, so a total that
// contains their money equals the marker amount. Their level varies; the viewer's cookie makes every request.
const OTHER = 'other'
const NOW = new Date(local('2026-10-29', '12:00'))
const STAMP = '2026-01-01T00:00:00.000Z'
const PAY_DATES = ['2026-10-01', '2026-10-15']

const LEVELS: (SharingLevel | null)[] = ['full', 'hide-transactions', 'balances', 'none', null]
// Spelled out here, not read from levelAllows, so a broken policy can't hide its own leak.
const SEES: Record<string, readonly string[]> = {
  full: ['transactions', 'finances', 'balances'],
  'hide-transactions': ['finances', 'balances'],
  balances: ['balances'],
  none: [],
  null: [],
}

type Marker = { name: string; needs: 'transactions' | 'finances' | 'balances'; kind: 'text' | 'cents' }
const text = (needs: Marker['needs'], ...names: string[]): Marker[] => names.map((name) => ({ name, needs, kind: 'text' }))
const cents = (needs: Marker['needs'], ...values: number[]): Marker[] =>
  values.map((v) => ({ name: String(v), needs, kind: 'cents' }))

const MARKERS: Marker[] = [
  ...text('transactions', 'ZQMERCHANT', 'ZQRAWTEXT', 'ZQMESSAGE', 'ZQTAG', 'ZQREPAY MERCHANT', 'ZQPAYCO'),
  ...text('transactions', 'zqtx-spend', 'zqtx-pay0', 'zqtx-pay1', 'zqtx-repay'),
  ...text('finances', 'ZqBudgetLine', 'ZqDebtName', 'ZqGoalName'),
  ...cents('finances', 43_117, 612_347, 2_718_281, 3_141_592),
  ...text('balances', 'ZqEveryday', 'ZqSaverAcct'),
  ...cents('balances', 7_391_204, 1_000_003),
  ...text('transactions', 'ZQSYNCERR'),
  // Derived figures: a month's spending and income, the plan income, and net worth's sums and debt-adjusted points.
  ...cents('finances', 63_117, 1_224_694, 1_161_577, 888_811),
  ...cents('finances', 2_711_872, 2_731_872, 2_770_828, 5_110_105, 5_675_930, 5_679_335, 5_722_452),
  // Account totals and net worth's account points, which "balances only" shows with debts left out.
  ...cents('balances', 7_841_977, 8_391_207, 8_446_758, 8_454_324),
  // A transfer to an account Upkeep doesn't sync, which names a Pay flow box.
  ...text('transactions', 'ZQUNSYNCED', 'zqtx-unsynced'),
  ...cents('finances', 55_123),
  // A joint debt's repayment and exclusion, both from their account: the balance stays, the rows don't.
  ...text('transactions', 'zqtx-jrepay', 'zqtx-jexcl'),
  ...cents('finances', 31_337, 44_021),
  // A goal whose Saver has gone.
  ...text('finances', 'ZqOrphanGoal', 'zq-gone'),
  // A Saver of theirs whose goal follows the joint debt; debt options name it only with finances (see below).
  ...text('balances', 'ZqFollowSaver'),
  // A Saver of theirs whose debt goal follows their personal debt (ZqDebtName, a finances marker): the partner loses the goal and the debt together.
  ...text('balances', 'ZqDebtSaver'),
  // Their template's amount on a joint Saver that has a goal. Neither person has a schedule, so it's shown unconverted.
  ...cents('finances', 717_171),
  // A deposit into their Saver: its row needs transactions; the goal page's monthly total needs only finances.
  ...text('transactions', 'ZQSAVEDEPOSIT', 'zqtx-savein'),
  ...cents('finances', 161_803),
  // Their archived goal, with the name of its Saver, its target and the debt it paid off.
  ...text('finances', 'ZqArchivedGoal', 'ZqArchivedSaver', 'ZqArchivedDebt'),
  ...cents('finances', 4_207_319),
]
// The partner's personal budget id: /api/budgets leaves the budget out below finances.
const BUDGET_MARKER: Marker = { name: '', needs: 'finances', kind: 'text' }
// The rule's description stays at every level, as the chooser says.
const JOINT_MARKERS = ['ZqJointAcct', 'ZQJOINTSHOP', 'zqjointrepay']

/** Where a marker appears: the text itself, or an amount as digits or dollars, never inside a longer number. */
function find(body: string, m: { name: string; kind: string }): boolean {
  if (m.kind === 'text') return body.toLowerCase().includes(m.name.toLowerCase())
  const c = Number(m.name)
  const forms = [String(c), (c / 100).toFixed(2), (c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })]
  return forms.some((f) => new RegExp(`(?<![\\d.,])${f.replace(/[.,]/g, '\\$&')}(?![\\d])`).test(body))
}

// What each route returns at full, as marker names: a route that ignored the level could pass the leak check but
// would lose a marker here, or answer something other than 200 or 404. Routes that only return the viewer's own
// data, or no personal data, are exempt.
const EXEMPT = new Set([
  '/api/setup/status',
  '/api/users',
  '/api/me',
  '/api/flow-layouts/:key',
  '/api/categories',
  '/api/pay-candidates',
  '/api/pay-schedule',
  '/api/pay-exclusions',
  '/api/plan-template',
  '/api/getting-started',
  '/api/budgets/:id/spending-history',
])
const EXPECTED: Record<string, string[]> = {
  '/api/sync/status': ['ZQSYNCERR'],
  '/api/accounts': ['ZqEveryday', 'ZqSaverAcct', '7391204', '1000003'],
  '/api/accounts/:id': ['ZqEveryday', 'ZqSaverAcct', '7391204', '1000003'],
  '/api/transactions': ['ZQMERCHANT', 'ZQRAWTEXT', 'ZQMESSAGE', 'ZQTAG', 'ZQPAYCO', 'zqtx-spend', 'ZQUNSYNCED', 'zqtx-unsynced'],
  '/api/transactions/:id': ['ZQMERCHANT', 'ZQRAWTEXT', 'ZQMESSAGE', 'ZQPAYCO', 'zqtx-pay0', 'ZQREPAY MERCHANT', 'zqtx-jrepay'],
  '/api/transactions/:id/budget-line': ['ZqBudgetLine'],
  '/api/transactions/:id/repayment': ['ZqDebtName'],
  '/api/overview': ['63117', '1224694', '43117', '7391204', 'ZQMERCHANT'],
  '/api/budgets': ['<budget>'],
  '/api/budgets/standard-pay/:userId': ['888811', 'ZqBudgetLine'],
  '/api/budgets/:id/period': ['ZqBudgetLine'],
  '/api/debts': ['ZqDebtName', '2718281'],
  '/api/debts/timeline': ['2718281'],
  '/api/debts/:id': ['ZqDebtName', 'ZQREPAY MERCHANT', 'zqtx-repay', '2718281', 'zqtx-jrepay', 'zqtx-jexcl', 'zqjointrepay', '31337', '44021'],
  '/api/payoff-plan': ['ZqDebtName'],
  '/api/goals': ['ZqGoalName', '3141592', 'ZqOrphanGoal', 'zq-gone', 'ZqDebtName', '717171', 'ZqArchivedGoal', 'ZqArchivedSaver', 'ZqArchivedDebt', '4207319'],
  '/api/goals/:accountId/debts': ['ZqFollowSaver'],
  '/api/goals/:accountId': ['ZqGoalName', '3141592', '161803', 'ZqDebtName'],
  '/api/net-worth': ['8391207', '7841977', '8446758', '8454324', '2711872', '2731872', '2770828', '5679335', '5675930'],
  '/api/pay-flow': ['ZQPAYCO', '612347', 'ZqBudgetLine', 'ZqDebtName', 'ZQUNSYNCED', '55123', '31337'],
  '/api/tags': ['ZQTAG'],
  '/api/pay-events': ['zqtx-pay0', '612347'],
  '/api/plans/:userId/:payDate': ['ZqBudgetLine'],
}
// What each route still shows below full, so a route that answered 404 to everything below full can't pass as private.
const EXPECTED_BELOW_FULL: Record<string, Record<string, string[]>> = {
  'hide-transactions': {
    '/api/accounts': ['ZqEveryday', 'ZqSaverAcct', '7391204', '1000003'],
    '/api/accounts/:id': ['ZqEveryday', 'ZqSaverAcct', '7391204', '1000003'],
    '/api/overview': ['63117', '1224694', '43117', '7391204'],
    '/api/budgets': ['<budget>'],
    '/api/budgets/standard-pay/:userId': ['888811', 'ZqBudgetLine'],
    '/api/budgets/:id/period': ['ZqBudgetLine'],
    '/api/debts': ['ZqDebtName', '2718281'],
    '/api/debts/timeline': ['2718281'],
    '/api/debts/:id': ['ZqDebtName', '2718281', 'zqjointrepay'],
    '/api/payoff-plan': ['ZqDebtName'],
    '/api/goals': ['ZqGoalName', '3141592', 'ZqOrphanGoal', 'zq-gone', 'ZqDebtName', '717171', 'ZqArchivedGoal', 'ZqArchivedSaver', 'ZqArchivedDebt', '4207319'],
    '/api/goals/:accountId/debts': ['ZqFollowSaver'],
    '/api/goals/:accountId': ['ZqGoalName', '3141592', '161803', 'ZqDebtName'],
    '/api/net-worth': ['8391207', '7841977', '8446758', '8454324', '2711872', '2731872', '2770828', '5679335', '5675930'],
    '/api/pay-flow': ['612347', 'ZqBudgetLine', 'ZqDebtName', '55123', '31337'],
    '/api/pay-events': ['612347'],
    '/api/plans/:userId/:payDate': ['ZqBudgetLine'],
  },
  balances: {
    '/api/accounts': ['ZqEveryday', 'ZqSaverAcct', '7391204', '1000003'],
    '/api/accounts/:id': ['ZqEveryday', 'ZqSaverAcct', '7391204', '1000003'],
    '/api/overview': ['7391204'],
    '/api/debts/:id': ['zqjointrepay'],
    '/api/net-worth': ['8391207', '7841977', '8446758', '8454324'],
  },
}

type Ids = { viewer: string; other: string; budgets: { other: string; joint: string; viewer: string } }
const SCOPES = ['everyone', 'me', 'partner', 'joint']
const byScope = (path: string) => SCOPES.map((scope) => `${path}?scope=${scope}`)
const PUBLIC = (path: string) => () => [path]

// Every GET route under /api, with the URLs to request. A new route fails the first test until it is listed here.
const ROUTE_TABLE: Record<string, (ids: Ids) => string[]> = {
  '/api/setup/status': PUBLIC('/api/setup/status'),
  '/api/users': PUBLIC('/api/users'),
  '/api/me': PUBLIC('/api/me'),
  '/api/sync/status': PUBLIC('/api/sync/status'),
  '/api/accounts': () => byScope('/api/accounts'),
  '/api/accounts/:id': () => ['zq-spend', 'zq-save', 'zq-joint'].map((id) => `/api/accounts/${id}`),
  '/api/transactions': () => [
    ...byScope('/api/transactions'),
    '/api/transactions?q=ZQMERCHANT',
    '/api/transactions?q=ZQPAYCO',
    '/api/transactions?tag=ZQTAG',
    '/api/transactions?accountId=zq-spend',
    '/api/transactions?accountId=zq-save',
    '/api/transactions?accountId=zq-joint',
    '/api/transactions?scope=partner&includeTransfers=true',
  ],
  '/api/transactions/:id': () => TX_IDS.map((id) => `/api/transactions/${id}`),
  '/api/transactions/:id/budget-line': () => TX_IDS.map((id) => `/api/transactions/${id}/budget-line`),
  '/api/transactions/:id/repayment': () => TX_IDS.map((id) => `/api/transactions/${id}/repayment`),
  '/api/overview': () => byScope('/api/overview'),
  '/api/budgets': PUBLIC('/api/budgets'),
  '/api/budgets/standard-pay/:userId': (ids) => [ids.other, ids.viewer].map((u) => `/api/budgets/standard-pay/${u}`),
  '/api/budgets/:id/period': (ids) =>
    Object.values(ids.budgets).flatMap((b) => [`/api/budgets/${b}/period`, `/api/budgets/${b}/period?date=2026-10-05`]),
  '/api/budgets/:id/spending-history': (ids) => Object.values(ids.budgets).map((b) => `/api/budgets/${b}/spending-history`),
  '/api/debts': () => byScope('/api/debts'),
  '/api/debts/timeline': () => byScope('/api/debts/timeline'),
  '/api/debts/:id': () => ['zq-debt', 'zq-joint-debt'].map((id) => `/api/debts/${id}`),
  '/api/payoff-plan': () => byScope('/api/payoff-plan'),
  '/api/goals': () => byScope('/api/goals'),
  '/api/goals/:accountId/debts': () => GOAL_DEBTS,
  // Their Saver at two ranges, their Saver whose goal follows their debt, a joint Saver, and an account that isn't a Saver.
  '/api/goals/:accountId': () => [
    '/api/goals/zq-save',
    '/api/goals/zq-save?range=all',
    '/api/goals/zq-debtsaver',
    '/api/goals/zq-jsave',
    '/api/goals/zq-spend',
  ],
  '/api/net-worth': () => SCOPES.flatMap((scope) => ['6m', '1y', 'all'].map((r) => `/api/net-worth?scope=${scope}&range=${r}`)),
  '/api/flow-layouts/:key': () =>
    SCOPES.flatMap((scope) => ['actual', 'planned'].flatMap((m) => ['budget', 'accounts'].map((g) => `/api/flow-layouts/${scope}:${m}:${g}`))),
  '/api/pay-flow': () =>
    SCOPES.flatMap((scope) =>
      ['actual', 'planned'].flatMap((mode) =>
        ['budget', 'accounts'].flatMap((group) =>
          ['pay', 'month', 'year', 'fy'].map((range) => `/api/pay-flow?scope=${scope}&mode=${mode}&group=${group}&range=${range}`),
        ),
      ),
    ),
  '/api/categories': PUBLIC('/api/categories'),
  '/api/tags': PUBLIC('/api/tags'),
  '/api/pay-candidates': PUBLIC('/api/pay-candidates'),
  '/api/pay-schedule': PUBLIC('/api/pay-schedule'),
  '/api/pay-events': (ids) => ['/api/pay-events', `/api/pay-events?userId=${ids.other}`, `/api/pay-events?userId=${ids.viewer}`],
  '/api/pay-exclusions': PUBLIC('/api/pay-exclusions'),
  '/api/plans/:userId/:payDate': (ids) =>
    [ids.other, ids.viewer].flatMap((u) => [...PAY_DATES, '2026-10-29'].map((d) => `/api/plans/${u}/${d}`)),
  '/api/plan-template': PUBLIC('/api/plan-template'),
  '/api/getting-started': PUBLIC('/api/getting-started'),
}
// Their Saver, and a joint Saver whose options list the joint debt their Saver follows.
const GOAL_DEBTS = ['/api/goals/zq-save/debts', '/api/goals/zq-jsave/debts']
const TX_IDS = ['zqtx-spend', 'zqtx-pay0', 'zqtx-pay1', 'zqtx-repay', 'zqtx-joint', 'zqtx-unsynced', 'zqtx-jrepay', 'zqtx-jexcl']

let t: TestApp
let cookie: string
let ids: Ids

const setLevel = (level: SharingLevel | null) =>
  t.db.update(s.users).set({ sharingLevel: level }).where(eq(s.users.id, OTHER)).run()

type Hit = { path: string; url: string; status: number; body: string }

// With no path parameter there's no item to hide, so a 404 means the route is broken, not private. The exception
// is /pay-events?userId=, where the query names the person and the answer must be a 404.
const may404 = (r: Hit) => r.path.includes(':') || r.url.includes('/api/pay-events?userId=')
// Debt options are for editing, so their Saver answers PUT's 403 while the viewer can see it, and 404 once hidden.
const may403 = (r: Hit, level: SharingLevel | null) =>
  r.url.endsWith(GOAL_DEBTS[0]!) && SEES[String(level)]!.includes('finances')

/** Every URL in the table, requested as the viewer, with the body text of each. */
async function crawl(): Promise<Hit[]> {
  const out = []
  for (const [path, urls] of Object.entries(ROUTE_TABLE)) {
    for (const url of urls(ids)) {
      const res = await t.json(url, { cookie })
      out.push({ path, url: `${path} -> ${url}`, status: res.status, body: await res.text() })
    }
  }
  return out
}

beforeAll(async () => {
  t = createTestApp({ now: NOW })
  cookie = await t.setupOwner()
  const viewer = t.db.select().from(s.users).where(eq(s.users.username, OWNER.username)).get()!.id
  t.db
    .insert(s.users)
    .values({ id: OTHER, username: 'partner', displayName: 'Partner', passwordHash: 'x', createdAt: STAMP, sharingLevel: 'full' })
    .run()
  seedCategories(t.db, [
    { id: 'groceries', name: 'Groceries', parentId: null },
    { id: 'takeaway', name: 'Takeaway', parentId: null },
  ])

  // Their personal accounts hold every marker. The joint accounts hold the joint markers.
  seedAccount(t.db, { id: 'zq-spend', owner: OTHER, name: 'ZqEveryday', balanceCents: 7_391_204 })
  seedAccount(t.db, { id: 'zq-save', owner: OTHER, type: 'SAVER', name: 'ZqSaverAcct', balanceCents: 1_000_003 })
  seedAccount(t.db, { id: 'zq-joint', owner: null, ownership: 'JOINT', name: 'ZqJointAcct', balanceCents: 55_551 })

  // Pay, a purchase with every text field set, a tagged purchase, and a repayment. None is a transfer.
  PAY_DATES.forEach((date, i) =>
    seedTx(t.db, { id: `zqtx-pay${i}`, accountId: 'zq-spend', amountCents: 612_347, createdAt: local(date), description: 'ZQPAYCO' }),
  )
  t.db
    .insert(s.payEvents)
    .values(
      PAY_DATES.map((payDate, i) => ({
        userId: OTHER,
        payDate,
        source: 'detected' as const,
        transactionId: `zqtx-pay${i}`,
        amountCents: 612_347,
        derivedAt: STAMP,
      })),
    )
    .run()
  seedTx(t.db, {
    id: 'zqtx-spend',
    accountId: 'zq-spend',
    amountCents: -43_117,
    createdAt: local('2026-10-20'),
    description: 'ZQMERCHANT',
    categoryId: 'takeaway',
  })
  t.db.update(s.transactions).set({ rawText: 'ZQRAWTEXT', message: 'ZQMESSAGE' }).where(eq(s.transactions.id, 'zqtx-spend')).run()
  t.db.insert(s.tags).values({ label: 'ZQTAG' }).run()
  t.db.insert(s.transactionTags).values({ transactionId: 'zqtx-spend', label: 'ZQTAG' }).run()
  seedTx(t.db, { id: 'zqtx-repay', accountId: 'zq-spend', amountCents: -20_000, createdAt: local('2026-10-22'), description: 'ZQREPAY MERCHANT' })
  seedTx(t.db, { id: 'zqtx-joint', accountId: 'zq-joint', amountCents: -1_500, createdAt: local('2026-10-21'), description: 'ZQJOINTSHOP', categoryId: 'groceries' })

  // Budgets: a line of theirs with a plan, and a Saver goal.
  ensureBudgets(t.db, NOW)
  const rows = listBudgetRows(t.db)
  const budgetOf = (owner: string | null) => rows.find((b) => b.ownerUserId === owner)!.id
  const line = createLine(
    t.db,
    budgetOf(OTHER),
    OTHER,
    { kind: 'spending', name: 'ZqBudgetLine', amountCents: 30_000, categoryIds: ['takeaway'], saverAccountId: null },
    NOW,
    TZ,
  )
  for (const date of PAY_DATES) {
    putPayPlan(
      t.db,
      OTHER,
      date,
      [
        { targetKind: 'saver', lineId: null, saverAccountId: 'zq-save', amountCents: 20_000 },
        { targetKind: 'line', lineId: line.id, saverAccountId: null, amountCents: 10_000 },
      ],
      NOW,
      TZ,
    )
  }
  seedAccount(t.db, { id: 'zq-jsave', owner: null, ownership: 'JOINT', type: 'SAVER', name: 'Joint Saver' })
  t.db.insert(s.goals).values({ accountId: 'zq-jsave', name: 'Joint goal', targetCents: 500, targetDate: null, createdAt: STAMP, updatedAt: STAMP }).run()
  putTemplate(
    t.db,
    OTHER,
    {
      expectedIncomeCents: 888_811,
      items: [
        { targetKind: 'line', lineId: line.id, saverAccountId: null, amountCents: 10_000 },
        { targetKind: 'saver', lineId: null, saverAccountId: 'zq-jsave', amountCents: 717_171 },
      ],
    },
    NOW,
    TZ,
  )
  // A connection, so scope=partner reaches their data; its error text is hidden below full.
  seedConnection(t.db, OTHER)
  t.db.update(s.upConnections).set({ lastError: 'ZQSYNCERR' }).where(eq(s.upConnections.userId, OTHER)).run()
  t.db.insert(s.goals).values({ accountId: 'zq-save', name: 'ZqGoalName', targetCents: 3_141_592, targetDate: null, createdAt: STAMP, updatedAt: STAMP }).run()

  // Debts: theirs, with a repayment rule that matches their repayment; and a joint one.
  const debt = (id: string, owner: string | null, name: string, balanceCents: number) => {
    t.db
      .insert(s.debts)
      .values({ id, ownerUserId: owner, kind: 'loan', name, repaymentCents: 10_000, repaymentFrequency: 'monthly', createdByUserId: owner ?? viewer, createdAt: STAMP, updatedAt: STAMP })
      .run()
    t.db.insert(s.debtBalances).values({ id: `${id}-b`, debtId: id, asOf: '2026-09-01', balanceCents, createdAt: STAMP }).run()
    t.db.insert(s.debtRates).values({ id: `${id}-r`, debtId: id, fromDate: '2026-09-01', rateBp: 600, createdAt: STAMP }).run()
  }
  debt('zq-debt', OTHER, 'ZqDebtName', 2_718_281)
  debt('zq-joint-debt', null, 'Joint Debt', 90_000)
  t.db.insert(s.debtRepaymentRules).values({ id: 'zq-rule', debtId: 'zq-debt', match: 'zqrepay merchant' }).run()

  // All before October, so this month's totals and the current pay cycle stay as they are.
  seedTx(t.db, { id: 'zqtx-unsynced', accountId: 'zq-spend', amountCents: -55_123, createdAt: local('2026-08-10'), description: 'Transfer to ZQUNSYNCED', transferAccountId: 'zq-not-synced' })
  // Before their earliest other transaction, so net worth's history still starts on 10 Aug and its points don't move.
  seedTx(t.db, { id: 'zqtx-savein', accountId: 'zq-save', amountCents: 161_803, createdAt: local('2026-08-01'), description: 'ZQSAVEDEPOSIT' })
  // They agreed to the rule, so their repayment counts toward the joint debt at every level.
  t.db.insert(s.debtRepaymentRules).values({ id: 'zq-joint-rule', debtId: 'zq-joint-debt', match: 'zqjointrepay' }).run()
  t.db.insert(s.debtRepaymentRulePeople).values({ ruleId: 'zq-joint-rule', userId: OTHER }).run()
  seedTx(t.db, { id: 'zqtx-jrepay', accountId: 'zq-spend', amountCents: -31_337, createdAt: local('2026-09-11'), description: 'ZQJOINTREPAY' })
  seedTx(t.db, { id: 'zqtx-jexcl', accountId: 'zq-spend', amountCents: -44_021, createdAt: local('2026-09-12'), description: 'ZQJOINTREPAY' })
  t.db.insert(s.debtRepaymentExclusions).values({ debtId: 'zq-joint-debt', transactionId: 'zqtx-jexcl' }).run()
  t.db.insert(s.goals).values({ accountId: 'zq-gone', name: 'ZqOrphanGoal', targetCents: 100, targetDate: null, createdAt: STAMP, updatedAt: STAMP }).run()
  // Their Saver follows the joint debt, which the viewer's joint Saver could choose.
  seedAccount(t.db, { id: 'zq-follow', owner: OTHER, type: 'SAVER', name: 'ZqFollowSaver' })
  t.db
    .insert(s.goals)
    .values({ accountId: 'zq-follow', kind: 'debt', debtId: 'zq-joint-debt', name: 'Joint payoff', targetCents: 90_000, targetDate: null, startedAt: STAMP, startTargetCents: 90_000, createdAt: STAMP, updatedAt: STAMP })
    .run()

  // Their Saver follows their personal debt.
  seedAccount(t.db, { id: 'zq-debtsaver', owner: OTHER, type: 'SAVER', name: 'ZqDebtSaver' })
  t.db
    .insert(s.goals)
    .values({ accountId: 'zq-debtsaver', kind: 'debt', debtId: 'zq-debt', name: 'Personal payoff', targetCents: 2_718_281, targetDate: null, startedAt: STAMP, startTargetCents: 2_718_281, createdAt: STAMP, updatedAt: STAMP })
    .run()

  // An archived goal of theirs, whose Saver and goal names need finances.
  t.db
    .insert(s.archivedGoals)
    .values({ id: 'zq-archived', accountId: 'zq-archived-saver', ownerUserId: OTHER, saverName: 'ZqArchivedSaver', name: 'ZqArchivedGoal', kind: 'debt', targetCents: 4_207_319, debtName: 'ZqArchivedDebt', debtPaidOff: true, reachedOn: '2026-09-01', archivedAt: STAMP })
    .run()

  BUDGET_MARKER.name = budgetOf(OTHER)
  MARKERS.push(BUDGET_MARKER)
  ids = { viewer, other: OTHER, budgets: { other: budgetOf(OTHER), joint: budgetOf(null), viewer: budgetOf(viewer) } }
})

test('every GET route is classified', () => {
  const paths = [...new Set(t.app.routes.filter((r) => r.method === 'GET' && r.path.startsWith('/api')).map((r) => r.path))]
  expect(paths.filter((p) => !(p in ROUTE_TABLE))).toEqual([])
  expect(Object.keys(ROUTE_TABLE).filter((p) => !paths.includes(p))).toEqual([])
})

test.each(LEVELS)('nothing hidden at %s appears in any response', async (level) => {
  setLevel(level)
  const sees = SEES[String(level)]
  const leaks: string[] = []
  for (const r of await crawl()) {
    if (r.status !== 200 && !(r.status === 404 && may404(r)) && !(r.status === 403 && may403(r, level))) leaks.push(`${r.url} answered ${r.status} at ${level}`)
    for (const m of MARKERS) {
      if (!sees.includes(m.needs) && find(r.body, m)) leaks.push(`${r.url} leaks ${m.name} (${m.needs}) at ${level}`)
    }
  }
  expect(leaks).toEqual([])
})

test('at full, every marker appears in some response', async () => {
  setLevel('full')
  const bodies = await crawl()
  const missing = MARKERS.filter((m) => !bodies.some((r) => find(r.body, m))).map((m) => m.name)
  expect(missing).toEqual([])
})

test('every route is either expected to show data at full or exempt', () => {
  const paths = Object.keys(ROUTE_TABLE)
  expect(paths.filter((p) => !(p in EXPECTED) && !EXEMPT.has(p))).toEqual([])
  expect(paths.filter((p) => p in EXPECTED && EXEMPT.has(p))).toEqual([])
  expect(Object.keys(EXPECTED).filter((p) => !paths.includes(p))).toEqual([])
})

/** The expected markers each route doesn't show at this level. */
function unshown(bodies: Hit[], expected: Record<string, string[]>, level: string): string[] {
  const problems: string[] = []
  for (const [path, names] of Object.entries(expected)) {
    const mine = bodies.filter((r) => r.path === path)
    for (const name of names) {
      const m = name === '<budget>' ? BUDGET_MARKER : (MARKERS.find((k) => k.name === name) ?? { name, kind: 'text' })
      if (!mine.some((r) => find(r.body, m))) problems.push(`${path} never shows ${name} at ${level}`)
    }
  }
  return problems
}

test('at full, each route shows the markers it should, and answers only 200 or 404', async () => {
  setLevel('full')
  const bodies = await crawl()
  const problems = unshown(bodies, EXPECTED, 'full')
  for (const r of bodies.filter((r) => r.path in EXPECTED && r.status !== 200)) {
    if (!(r.path.includes(':') && r.status === 404) && !(r.status === 403 && may403(r, 'full'))) problems.push(`${r.url} answered ${r.status} at full`)
  }
  expect(problems).toEqual([])
})

test.each(['hide-transactions', 'balances'] as const)('at %s, each route still shows what the level shares', async (level) => {
  setLevel(level)
  expect(unshown(await crawl(), EXPECTED_BELOW_FULL[level], level)).toEqual([])
})

test.each(LEVELS)('a joint marker appears at %s', async (level) => {
  setLevel(level)
  const bodies = await crawl()
  const missing = JOINT_MARKERS.filter((name) => !bodies.some((r) => find(r.body, { name, kind: 'text' })))
  expect(missing).toEqual([])
})

test.each(LEVELS)('debt options name a Saver of theirs only when %s shares finances', async (level) => {
  setLevel(level)
  const res = await t.json(GOAL_DEBTS[1]!, { cookie })
  const [option] = (await res.json()) as { id: string; followedBy: string | null }[]
  expect(option).toMatchObject({ id: 'zq-joint-debt' })
  expect(option!.followedBy).toBe(SEES[String(level)]!.includes('finances') ? 'ZqFollowSaver' : 'another Saver')
})
