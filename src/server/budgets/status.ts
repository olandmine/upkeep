import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { BudgetPeriodDto, LineStatusDto } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { budgetAccountIds, findPeriod, getBudget, type Period } from './budgets'
import { diffDays, localDate, periodRangeUtc, todayLocal, type LocalDate } from './dates'
import { ensurePeriodSnapshot, expandCategories, lineColorToken, snapshotCategories } from './lines'
import { goalCaption } from '../goals/goals'

const WARNING_RATIO = 0.85
const ROUND_UP = 'Round Up'

/** UTC bounds for a period; the current period is open-ended so nothing after a late pay is lost. */
export function periodBounds(p: Period, tz: string) {
  const range = periodRangeUtc(p.start, p.end ?? p.start, tz)
  return { from: range.start, to: p.end ? range.end : null }
}

/** The transactions a period counts: its UTC range, and nothing deleted. */
export function periodFilter(p: Period, tz: string): ReturnType<typeof and> {
  const { from, to } = periodBounds(p, tz)
  return and(
    gte(s.transactions.createdAt, from),
    to ? lt(s.transactions.createdAt, to) : undefined,
    isNull(s.transactions.deletedAt),
  )
}

export interface SpendingGroup {
  categoryId: string | null
  parentId: string | null
  cents: number
  inflow: boolean
}

/** Counted money (no transfers) in a period, summed by category and direction. */
export function spendingGroups(db: Db, accountIds: string[], inPeriod: ReturnType<typeof and>): SpendingGroup[] {
  if (!accountIds.length) return []
  return db
    .select({
      categoryId: s.transactions.categoryId,
      parentId: s.transactions.parentCategoryId,
      cents: sql<number>`sum(${s.transactions.amountCents})`,
      inflow: sql<boolean>`${s.transactions.amountCents} > 0`,
    })
    .from(s.transactions)
    .where(and(inArray(s.transactions.accountId, accountIds), eq(s.transactions.isTransfer, false), inPeriod))
    .groupBy(s.transactions.categoryId, s.transactions.parentCategoryId, sql`${s.transactions.amountCents} > 0`)
    .all()
}

const inCategories = (g: SpendingGroup, ids: Set<string>) =>
  Boolean((g.categoryId && ids.has(g.categoryId)) || (g.parentId && ids.has(g.parentId)))

/** Spent on a line's categories: outflows less refunds, so a net refund is negative. */
export function spentOn(groups: SpendingGroup[], expanded: Set<string>): number {
  return 0 - groups.filter((g) => inCategories(g, expanded)).reduce((sum, g) => sum + g.cents, 0)
}

/** Spending no line claims ("Not budgeted"). Uncategorised inflows are pay and other income, not refunds, so they never offset it. */
export function unclaimedSpend(groups: SpendingGroup[], claimed: Set<string>): number {
  const unmatched = groups
    .filter((g) => !(g.categoryId === null && g.inflow))
    .filter((g) => !inCategories(g, claimed))
    .reduce((sum, g) => sum + g.cents, 0)
  return Math.max(0, -unmatched)
}

const notRoundUp = sql`coalesce(${s.transactions.transactionType}, '') <> ${ROUND_UP}`

export function getBudgetPeriod(
  db: Db,
  p: { budgetId: string; date: LocalDate; now: Date; tz: string },
): BudgetPeriodDto | null {
  const budget = getBudget(db, p.budgetId)
  const period = findPeriod(db, budget, p.date)
  if (!period) return null
  const inPeriod = periodFilter(period, p.tz)
  const accountIds = budgetAccountIds(db, budget)

  // Counted outflows, grouped by category, then bucketed into lines below.
  const groups = spendingGroups(db, accountIds, inPeriod)

  const snapshot = ensurePeriodSnapshot(db, budget.id, period.start)
  const lineRows = snapshot.length
    ? db
        .select()
        .from(s.budgetLines)
        .where(
          inArray(
            s.budgetLines.id,
            snapshot.map((r) => r.lineId),
          ),
        )
        .all()
    : []
  const byId = new Map(lineRows.map((l) => [l.id, l]))
  // Categories as of this period's snapshot: moving a category later never rewrites past periods.
  const categoriesByLine = snapshotCategories(db, budget.id, period.start)

  const savers = new Map(
    db
      .select()
      .from(s.accounts)
      .where(
        inArray(
          s.accounts.id,
          lineRows.flatMap((l) => (l.saverAccountId ? [l.saverAccountId] : [])),
        ),
      )
      .all()
      .map((a) => [a.id, a]),
  )

  const today = todayLocal(p.now, p.tz)
  const claimed = new Set<string>()
  const lines: LineStatusDto[] = snapshot.map((snap) => {
    const line = byId.get(snap.lineId)!
    const categoryIds = (categoriesByLine.get(line.id) ?? []).sort()
    const expanded = expandCategories(db, categoryIds)
    for (const id of expanded) claimed.add(id)
    const spentCents = spentOn(groups, expanded)
    const colorToken = lineColorToken(db, categoryIds)
    const saver = line.saverAccountId ? savers.get(line.saverAccountId) : undefined
    const saverMissing = Boolean(line.saverAccountId) && !saver
    const amountCents = snap.amountCents

    const base: LineStatusDto = {
      lineId: line.id,
      kind: line.kind,
      name: line.name,
      amountCents,
      categoryIds,
      colorToken,
      saverAccountId: line.saverAccountId,
      saverName: saver?.displayName ?? null,
      saverBalanceCents: saver?.balanceCents ?? null,
      saverMissing,
      spentCents: categoryIds.length ? spentCents : 0,
      remainingCents: null,
      spentRatio: null,
      state: null,
      coverage: null,
      contributedCents: null,
      withdrawnCents: null,
      contribution: null,
      goal: line.kind === 'fund' && line.saverAccountId ? goalCaption(db, line.saverAccountId, today, p.tz) : null,
    }

    if (line.kind === 'spending') {
      const remaining = amountCents - spentCents
      const ratio = amountCents > 0 ? spentCents / amountCents : spentCents > 0 ? Infinity : 0
      base.remainingCents = remaining
      base.spentRatio = Number.isFinite(ratio) ? Math.round(ratio * 10000) / 10000 : null
      base.state = ratio > 1 ? 'over' : ratio >= WARNING_RATIO ? 'warning' : 'ok'
      if (saver) {
        const need = Math.max(remaining, 0)
        base.coverage =
          saver.balanceCents >= need
            ? { state: 'covered', shortCents: 0 }
            : { state: 'short', shortCents: need - saver.balanceCents }
      }
      return base
    }

    if (saver) {
      const flows = db
        .select({
          contributed: sql<number>`coalesce(sum(case when ${s.transactions.amountCents} > 0 and ${notRoundUp} then ${s.transactions.amountCents} end), 0)`,
          withdrawn: sql<number>`coalesce(sum(case when ${s.transactions.amountCents} < 0 then -${s.transactions.amountCents} end), 0)`,
        })
        .from(s.transactions)
        .where(and(eq(s.transactions.accountId, saver.id), eq(s.transactions.isTransfer, true), inPeriod))
        .get()!
      base.contributedCents = flows.contributed
      base.withdrawnCents = flows.withdrawn
      base.contribution =
        flows.contributed >= amountCents ? 'funded' : flows.contributed > 0 ? 'partial' : 'none'
    }
    return base
  })

  const daysTotal = diffDays(period.end ?? period.nominalEnd, period.start)
  const daysElapsed = period.isCurrent
    ? Math.min(daysTotal, Math.max(0, diffDays(today, period.start) + 1))
    : daysTotal

  const spending = lines.filter((l) => l.kind === 'spending')
  const firstLine = db
    .select({ createdAt: s.budgetLines.createdAt })
    .from(s.budgetLines)
    .where(eq(s.budgetLines.budgetId, budget.id))
    .orderBy(asc(s.budgetLines.createdAt))
    .get()
  const setupDate = firstLine ? localDate(firstLine.createdAt, p.tz) : null

  return {
    budgetId: budget.id,
    start: period.start,
    end: period.end,
    nominalEnd: period.nominalEnd,
    isCurrent: period.isCurrent,
    prevDate: period.prevDate,
    nextDate: period.nextDate,
    source: period.source,
    payNotSeen: period.source === 'scheduled' && period.payTxId === null,
    daysTotal,
    daysElapsed,
    incomeCents: income(db, budget.kind, period, inPeriod),
    movedBackCents: movedBack(db, budget.kind, accountIds, inPeriod),
    lines,
    notBudgetedCents: unclaimedSpend(groups, claimed),
    totals: {
      limitCents: spending.reduce((sum, l) => sum + l.amountCents, 0),
      spentCents: spending.reduce((sum, l) => sum + l.spentCents, 0),
    },
    beforeSetup: setupDate !== null && period.end !== null && period.end <= setupDate,
  }
}

/** Personal: money moved from any Saver back into the budget's Spending accounts. Joint has no Spending to return to. */
export function movedBack(
  db: Db,
  kind: 'personal' | 'joint',
  accountIds: string[],
  inPeriod: ReturnType<typeof and>,
): number {
  if (kind === 'joint' || !accountIds.length) return 0
  const savers = db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.accountType, 'SAVER'))
  const spendingIds = db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(and(inArray(s.accounts.id, accountIds), eq(s.accounts.accountType, 'TRANSACTIONAL')))
  return db
    .select({ cents: sql<number>`coalesce(sum(${s.transactions.amountCents}), 0)` })
    .from(s.transactions)
    .where(
      and(
        inArray(s.transactions.accountId, spendingIds),
        inArray(s.transactions.transferAccountId, savers),
        sql`${s.transactions.amountCents} > 0`,
        inPeriod,
      ),
    )
    .get()!.cents
}

/** Personal: the pay plus its extra deposits. Joint: transfers from individual accounts into joint Savers. */
function income(
  db: Db,
  kind: 'personal' | 'joint',
  period: Period,
  inPeriod: ReturnType<typeof and>,
): number {
  if (kind === 'personal') {
    const event = db
      .select()
      .from(s.payEvents)
      .where(and(eq(s.payEvents.userId, period.payUserId), eq(s.payEvents.payDate, period.start)))
      .get()
    if (!event) return 0
    const extraIds = JSON.parse(event.extraTxIdsJson) as string[]
    const extras = extraIds.length
      ? db
          .select({ cents: sql<number>`coalesce(sum(${s.transactions.amountCents}), 0)` })
          .from(s.transactions)
          .where(inArray(s.transactions.id, extraIds))
          .get()!.cents
      : 0
    return (event.amountCents ?? 0) + extras
  }
  const jointSavers = db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(and(eq(s.accounts.ownership, 'JOINT'), eq(s.accounts.accountType, 'SAVER')))
  const individual = db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(eq(s.accounts.ownership, 'INDIVIDUAL'))
  return db
    .select({ cents: sql<number>`coalesce(sum(${s.transactions.amountCents}), 0)` })
    .from(s.transactions)
    .where(
      and(
        inArray(s.transactions.accountId, jointSavers),
        inArray(s.transactions.transferAccountId, individual),
        sql`${s.transactions.amountCents} > 0`,
        notRoundUp,
        inPeriod,
      ),
    )
    .get()!.cents
}

/**
 * The budget and line a transaction counts toward, for the transaction drawer. `lineName` is null
 * for spending no line claims ("Not budgeted"); the whole result is null for transfers, deposits
 * no line claims, and transactions before a budget's first pay.
 */
export function transactionBudgetLine(
  db: Db,
  p: { transactionId: string; viewerId: string; tz: string },
): { budgetName: string; lineName: string | null } | null {
  const row = db
    .select({ tx: s.transactions, account: s.accounts })
    .from(s.transactions)
    .innerJoin(s.accounts, eq(s.accounts.id, s.transactions.accountId))
    .where(eq(s.transactions.id, p.transactionId))
    .get()
  if (!row || row.tx.isTransfer || row.tx.deletedAt) return null
  const budget = db
    .select()
    .from(s.budgets)
    .where(
      row.account.ownership === 'JOINT'
        ? eq(s.budgets.kind, 'joint')
        : eq(s.budgets.ownerUserId, row.account.ownerUserId ?? ''),
    )
    .get()
  if (!budget) return null
  const period = findPeriod(db, budget, localDate(row.tx.createdAt, p.tz))
  if (!period) return null

  const lineIds = ensurePeriodSnapshot(db, budget.id, period.start).map((r) => r.lineId)
  const cats = snapshotCategories(db, budget.id, period.start)
  const matched = lineIds.find((id) => {
    const expanded = expandCategories(db, cats.get(id) ?? [])
    return (
      (row.tx.categoryId !== null && expanded.has(row.tx.categoryId)) ||
      (row.tx.parentCategoryId !== null && expanded.has(row.tx.parentCategoryId))
    )
  })
  if (!matched && row.tx.amountCents >= 0) return null

  const owner = budget.ownerUserId
    ? db.select({ name: s.users.displayName }).from(s.users).where(eq(s.users.id, budget.ownerUserId)).get()
    : undefined
  const budgetName =
    budget.kind === 'joint' ? 'Joint' : budget.ownerUserId === p.viewerId ? 'Mine' : (owner?.name ?? 'Partner')
  const lineName = matched
    ? (db.select({ name: s.budgetLines.name }).from(s.budgetLines).where(eq(s.budgetLines.id, matched)).get()?.name ??
      null)
    : null
  return { budgetName, lineName }
}
