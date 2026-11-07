import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { PALETTE } from '../../shared/categories'
import type { PayFlowDto, PayFlowGroup, PayFlowMode, PayFlowRange, Scope } from '../../shared/types'
import { ensureBudgets, findPeriod, listBudgetRows, type Period } from '../budgets/budgets'
import { localDate, periodRangeUtc, todayLocal, type LocalDate } from '../budgets/dates'
import {
  activeLines,
  ensurePeriodSnapshot,
  expandCategories,
  lineColorToken,
  snapshotCategories,
} from '../budgets/lines'
import { getPayPlan, getTemplate } from '../budgets/plans'
import { periodBounds } from '../budgets/status'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { AccountRow, BudgetRow, PayEventRow } from '../db/schema'
import { debtsInScope, startingPoints } from '../debts/debts'
import { matchedRepayments } from '../debts/repayments'
import { scopeAccountIds } from '../queries/scope'
import { canSee, canSeeAccount } from '../sharing/policy'
import { actualAccountsFlow } from './actual-accounts'
import { actualBudgetFlow } from './actual-budget'
import { plannedAccountsFlow, plannedBudgetFlow, type PlannedInput } from './planned'
import { rangeSpan } from './range'
import type { FlowAccount, FlowGraph, FlowInput, FlowLine, FlowPay, FlowTx } from './types'

const SCOPE_LABEL: Record<Scope, FlowInput['scopeLabel']> = {
  me: 'Me',
  partner: 'Partner',
  joint: 'Joint',
  everyone: 'Everyone',
}

function empty(
  state: Exclude<PayFlowDto['state'], 'ready'>,
  scope: Scope,
  cycle: PayFlowDto['cycle'] = null,
): PayFlowDto {
  return {
    state,
    cycle,
    baseCents: 0,
    baseLabel: scope === 'joint' ? 'money in' : 'pay',
    overAllocatedCents: null,
    nodes: [],
    edges: [],
  }
}

/**
 * A pay event as a pay-flow source: the deposit plus its extra deposits. A deposit the viewer
 * can't read the transactions of is just "Pay"; no deposit stays null, which reads "Expected".
 */
function toFlowPay(db: Db, e: PayEventRow, userName: string, viewerId: string): FlowPay {
  const extraIds = JSON.parse(e.extraTxIdsJson) as string[]
  const extras = extraIds.length
    ? db
        .select({ cents: sql<number>`coalesce(sum(${s.transactions.amountCents}), 0)` })
        .from(s.transactions)
        .where(inArray(s.transactions.id, extraIds))
        .get()!.cents
    : 0
  const deposit = e.transactionId
    ? db.select().from(s.transactions).where(eq(s.transactions.id, e.transactionId)).get()
    : undefined
  const readable = deposit
    ? canSeeAccount(db, viewerId, accountOwnership(db, deposit.accountId), 'transactions')
    : false
  return {
    userId: e.userId,
    userName,
    amountCents: (e.amountCents ?? 0) + extras,
    accountId: deposit?.accountId ?? null,
    txIds: [...(e.transactionId ? [e.transactionId] : []), ...extraIds],
    date: e.payDate,
    description: deposit ? (readable ? deposit.description : 'Pay') : null,
  }
}

function accountOwnership(db: Db, accountId: string): { ownership: string; ownerUserId: string | null } {
  return (
    db
      .select({ ownership: s.accounts.ownership, ownerUserId: s.accounts.ownerUserId })
      .from(s.accounts)
      .where(eq(s.accounts.id, accountId))
      .get() ?? { ownership: 'INDIVIDUAL', ownerUserId: null }
  )
}

interface Snapshot {
  budget: BudgetRow
  lineIds: string[]
  categories: Map<string, string[]>
  expanded: Map<string, Set<string>>
}

/**
 * Pay flow for one pay cycle, calendar month, calendar year or financial year:
 * gathers the period's data and runs the view's builder.
 */
export function getPayFlow(
  db: Db,
  p: {
    scope: Scope
    mode: PayFlowMode
    group: PayFlowGroup
    /** Defaults to one pay cycle. */
    range?: PayFlowRange
    date: LocalDate
    viewerId: string
    now: Date
    tz: string
  },
): PayFlowDto {
  ensureBudgets(db, p.now)
  const users = db
    .select({ id: s.users.id, name: s.users.displayName })
    .from(s.users)
    .orderBy(asc(s.users.createdAt), sql`rowid`)
    .all()
  // A budget, and a person's pays, only count when the viewer may see that person's finances.
  const budgets = listBudgetRows(db).filter((b) => canSee(db, p.viewerId, b.ownerUserId, 'finances'))
  const jointBudget = budgets.find((b) => b.kind === 'joint')
  const personalOf = (userId: string | null) =>
    budgets.find((b) => b.kind === 'personal' && b.ownerUserId === userId)

  // The cycle comes from one budget; the lines from every budget in scope.
  let cycleBudget: BudgetRow | undefined
  let scopeBudgets: BudgetRow[]
  // Whose pays count: one person's in Me and Partner, everyone's otherwise.
  let payUserIds: string[] = users.filter((u) => canSee(db, p.viewerId, u.id, 'finances')).map((u) => u.id)
  if (p.scope === 'partner') {
    const partner = users.find((u) => u.id !== p.viewerId)
    if (partner && !canSee(db, p.viewerId, partner.id, 'finances')) return empty('private', p.scope)
    const connected =
      partner && db.select().from(s.upConnections).where(eq(s.upConnections.userId, partner.id)).get()
    if (!partner || !connected) return empty('partner-not-connected', p.scope)
    cycleBudget = personalOf(partner.id)
    scopeBudgets = cycleBudget ? [cycleBudget] : []
    payUserIds = [partner.id]
  } else if (p.scope === 'me') {
    payUserIds = [p.viewerId]
    cycleBudget = personalOf(p.viewerId)
    scopeBudgets = cycleBudget ? [cycleBudget] : []
  } else {
    cycleBudget = jointBudget
    scopeBudgets = p.scope === 'joint' ? (jointBudget ? [jointBudget] : []) : budgets
  }
  // A pay cycle needs the pay schedule; a month, year or FY is just dates.
  const range = p.range ?? 'pay'
  let cycle: NonNullable<PayFlowDto['cycle']>
  let bounds: { from: string; to: string | null }
  let events: PayEventRow[]
  if (range === 'pay') {
    const period = cycleBudget ? findPeriod(db, cycleBudget, p.date) : null
    if (!period) return empty('needs-pay', p.scope)
    cycle = {
      start: period.start,
      end: period.end,
      prevDate: period.prevDate,
      nextDate: period.nextDate,
      isCurrent: period.isCurrent,
    }
    bounds = periodBounds(period, p.tz)
    events = cycleEvents(db, p.scope, period)
  } else {
    cycle = rangeSpan(range, p.date, todayLocal(p.now, p.tz))
    const utc = periodRangeUtc(cycle.start, cycle.end ?? cycle.start, p.tz)
    bounds = { from: utc.start, to: cycle.end ? utc.end : null }
    events = rangeEvents(db, payUserIds, cycle.start, cycle.end)
  }
  // The cycle's events can be anyone's; only those of people the viewer may see are drawn.
  events = events.filter((e) => payUserIds.includes(e.userId))

  const nameOf = (userId: string) => users.find((u) => u.id === userId)?.name ?? 'Someone'
  const accountRows = db.select().from(s.accounts).all()
  // An account the viewer can't even see the balance of isn't synced as far as the graph knows: no name, no box.
  const accounts: FlowAccount[] = accountRows
    .filter((a) => canSeeAccount(db, p.viewerId, a, 'balances'))
    .map((a) => ({
      id: a.id,
      name: a.displayName,
      type: a.accountType,
      ownership: a.ownership as FlowAccount['ownership'],
      ownerUserId: a.ownerUserId,
      colorToken: PALETTE[a.colorIndex % PALETTE.length],
    }))
  const scopeLabel = SCOPE_LABEL[p.scope]
  const inScope = scopeAccountIds(db, p.scope, p.viewerId, 'finances')

  // Line snapshots, memoised per (budget, period start).
  const snapshots = new Map<string, Snapshot>()
  const snapshot = (budget: BudgetRow, start: LocalDate): Snapshot => {
    const key = `${budget.id}|${start}`
    let snap = snapshots.get(key)
    if (!snap) {
      const lineIds = ensurePeriodSnapshot(db, budget.id, start).map((r) => r.lineId)
      const categories = snapshotCategories(db, budget.id, start)
      const expanded = new Map(lineIds.map((id) => [id, expandCategories(db, categories.get(id) ?? [])]))
      snap = { budget, lineIds, categories, expanded }
      snapshots.set(key, snap)
    }
    return snap
  }
  const periods = new Map<string, Period | null>()
  const periodOf = (budget: BudgetRow, date: LocalDate): Period | null => {
    const key = `${budget.id}|${date}`
    if (!periods.has(key)) periods.set(key, findPeriod(db, budget, date))
    return periods.get(key)!
  }

  /** Lines of the given budgets: each one's snapshot at the cycle start, plus any snapshot a transaction used. */
  const linesOf = (wanted: BudgetRow[]): FlowLine[] => {
    const cats = new Map<string, { budget: BudgetRow; categoryIds: string[] }>()
    for (const b of wanted) {
      const at = periodOf(b, cycle.start)
      if (at) snapshot(b, at.start)
      // A budget with no period yet has no snapshot; its active lines stand in.
      else for (const l of activeLines(db, b.id)) cats.set(l.id, { budget: b, categoryIds: l.categoryIds })
    }
    const ids = new Set(wanted.map((b) => b.id))
    for (const snap of snapshots.values()) {
      if (!ids.has(snap.budget.id)) continue
      for (const id of snap.lineIds) {
        if (!cats.has(id)) cats.set(id, { budget: snap.budget, categoryIds: snap.categories.get(id) ?? [] })
      }
    }
    if (cats.size === 0) return []
    return db
      .select()
      .from(s.budgetLines)
      .where(inArray(s.budgetLines.id, [...cats.keys()]))
      .orderBy(asc(s.budgetLines.sortOrder), asc(s.budgetLines.createdAt))
      .all()
      .map((l) => {
        const { budget, categoryIds } = cats.get(l.id)!
        return {
          id: l.id,
          name: l.name,
          kind: l.kind,
          saverAccountId: l.saverAccountId,
          colorToken: lineColorToken(db, categoryIds),
          joint: budget.kind === 'joint',
        }
      })
  }

  let graph: FlowGraph
  if (p.mode === 'planned') {
    const planned = events.map((e) => ({
      pay: toFlowPay(db, e, nameOf(e.userId), p.viewerId),
      plan: getPayPlan(db, e.userId, e.payDate, p.now, p.tz),
    }))
    if (planned.every(({ pay, plan }) => plan.items.length === 0 && !getTemplate(db, pay.userId))) {
      // Keep the cycle so the card can still step to other cycles.
      return empty('no-plan', p.scope, cycle)
    }
    // A person's plan can target Joint lines, so the Me and Partner views need those too.
    const lineBudgets =
      (p.scope === 'me' || p.scope === 'partner') && jointBudget
        ? [...scopeBudgets, jointBudget]
        : scopeBudgets
    const transactional = (userId: string) =>
      accountRows.find(
        (a) => a.ownerUserId === userId && a.ownership === 'INDIVIDUAL' && a.accountType === 'TRANSACTIONAL',
      )?.id
    const input: PlannedInput = {
      scope: p.scope,
      scopeLabel,
      users,
      accounts,
      scopeAccountIds: inScope,
      lines: linesOf(lineBudgets),
      pays: planned.map(({ pay, plan }) => ({
        pay,
        plan,
        landsIn: pay.accountId ?? transactional(pay.userId) ?? '',
      })),
    }
    graph = p.group === 'budget' ? plannedBudgetFlow(input) : plannedAccountsFlow(input)
  } else {
    const { from, to } = bounds
    // Both sides: the builders need the sending side of transfers into scope.
    const rows = inScope.length
      ? db
          .select()
          .from(s.transactions)
          .where(
            and(
              isNull(s.transactions.deletedAt),
              gte(s.transactions.createdAt, from),
              to ? lt(s.transactions.createdAt, to) : undefined,
              or(
                inArray(s.transactions.accountId, inScope),
                inArray(s.transactions.transferAccountId, inScope),
              ),
            ),
          )
          .orderBy(asc(s.transactions.createdAt))
          .all()
      : []

    const accountById = new Map<string, AccountRow>(accountRows.map((a) => [a.id, a]))
    // The line a transaction counts toward, by the rule transactionBudgetLine uses.
    const lineOf = (t: (typeof rows)[number]): string | null => {
      if (t.isTransfer) return null
      const account = accountById.get(t.accountId)
      if (!account) return null
      const budget = account.ownership === 'JOINT' ? jointBudget : personalOf(account.ownerUserId)
      if (!budget) return null
      const at = periodOf(budget, localDate(t.createdAt, p.tz))
      if (!at) return null
      const snap = snapshot(budget, at.start)
      return (
        snap.lineIds.find((id) => {
          const expanded = snap.expanded.get(id)!
          return (
            (t.categoryId !== null && expanded.has(t.categoryId)) ||
            (t.parentCategoryId !== null && expanded.has(t.parentCategoryId))
          )
        }) ?? null
      )
    }

    const debts = debtsInScope(db, p.scope, p.viewerId)
    const debtOf = new Map<string, string>()
    for (const d of debts) {
      const first = startingPoints(db, d.id)[0]
      if (!first) continue
      // Only this cycle's: the debt's whole history isn't needed here.
      for (const r of matchedRepayments(db, d, first.asOf, p.tz, { from, to })) {
        if (!debtOf.has(r.transactionId)) debtOf.set(r.transactionId, d.id)
      }
    }

    // What a transaction was called names boxes (Up's "Transfer to $sam"), so it stays with those who may read it.
    const readable = new Map<string, boolean>()
    const mayRead = (accountId: string) => {
      if (!readable.has(accountId)) {
        const account = accountById.get(accountId)
        readable.set(accountId, account !== undefined && canSeeAccount(db, p.viewerId, account, 'transactions'))
      }
      return readable.get(accountId)!
    }
    // The sender's leg of a transfer into scope stays only where the viewer may see that account's balance.
    const seen = new Set(accounts.map((a) => a.id))
    const txs: FlowTx[] = rows.filter((t) => seen.has(t.accountId)).map((t) => ({
      id: t.id,
      accountId: t.accountId,
      amountCents: t.amountCents,
      transferAccountId: t.transferAccountId,
      transactionType: t.transactionType,
      categorised: t.categoryId !== null,
      lineId: lineOf(t),
      debtId: debtOf.get(t.id) ?? null,
      createdAt: t.createdAt,
      automatic: t.performingCustomer === null,
      description: mayRead(t.accountId) ? t.description : null,
    }))
    const input: FlowInput = {
      scope: p.scope,
      scopeLabel,
      viewerId: p.viewerId,
      users,
      accounts,
      scopeAccountIds: inScope,
      // Joint's money comes from people's transfers in, not from their pays.
      pays: p.scope === 'joint' ? [] : events.map((e) => toFlowPay(db, e, nameOf(e.userId), p.viewerId)),
      txs,
      lines: linesOf(scopeBudgets),
      debts: debts.map((d) => ({ id: d.id, name: d.name })),
    }
    graph = p.group === 'budget' ? actualBudgetFlow(input) : actualAccountsFlow(input)
  }

  return {
    state: 'ready',
    cycle,
    ...graph,
  }
}

/** The pays of these people dated in [start, end); an open end runs to today. */
function rangeEvents(db: Db, userIds: string[], start: LocalDate, end: LocalDate | null): PayEventRow[] {
  return db
    .select()
    .from(s.payEvents)
    .where(
      and(
        inArray(s.payEvents.userId, userIds),
        gte(s.payEvents.payDate, start),
        end ? lt(s.payEvents.payDate, end) : undefined,
      ),
    )
    .orderBy(asc(s.payEvents.payDate), asc(s.payEvents.userId))
    .all()
}

/** Me and Partner: the cycle's own pay. Joint and Everyone: every pay of either person dated in the cycle. */
function cycleEvents(db: Db, scope: Scope, period: Period): PayEventRow[] {
  const where =
    scope === 'me' || scope === 'partner'
      ? and(eq(s.payEvents.userId, period.payUserId), eq(s.payEvents.payDate, period.start))
      : and(
          gte(s.payEvents.payDate, period.start),
          period.end ? lt(s.payEvents.payDate, period.end) : undefined,
        )
  return db
    .select()
    .from(s.payEvents)
    .where(where)
    .orderBy(asc(s.payEvents.payDate), asc(s.payEvents.userId))
    .all()
}
