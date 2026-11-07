import { and, eq, gte, isNull, sql } from 'drizzle-orm'
import type { GoalDto, GoalKind, GoalRange } from '../../shared/types'
import { addDays, localDate, periodRangeUtc, type LocalDate } from '../budgets/dates'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { AccountRow } from '../db/schema'
import type { TimelineDay } from '../debts/types'
import { historyStart, pointDates, rebuildTotals, type Delta } from '../networth/rebuild'

/** The range the goal cards' sparklines cover. */
const SPARKLINE_RANGE: GoalRange = '6m'

/**
 * A Saver's balance at the end of each point's local day, rebuilt backwards from today the way Net worth does it.
 * Points before its history is complete (an opening balance that was never synced) are dropped, not invented.
 */
export function saverHistory(
  db: Db,
  saver: AccountRow,
  range: GoalRange,
  today: LocalDate,
  tz: string,
): { date: LocalDate; balanceCents: number }[] {
  const counted = and(eq(s.transactions.accountId, saver.id), isNull(s.transactions.deletedAt))
  // A purchase's round-up leaves the balance separately from its amount, as Net worth counts it.
  const cents = sql<number>`${s.transactions.amountCents} + coalesce(${s.transactions.roundUpCents}, 0)`
  const totals = db
    .select({ total: sql<number>`sum(${cents})`, first: sql<string | null>`min(${s.transactions.createdAt})` })
    .from(s.transactions)
    .where(counted)
    .get()
  if (!totals?.first) return [{ date: today, balanceCents: saver.balanceCents }]

  const firstDate = localDate(totals.first, tz)
  const historyFrom = historyStart([
    { type: saver.accountType, balanceNow: saver.balanceCents, totalCents: Number(totals.total ?? 0), firstDate },
  ])
  const ends = pointDates(range, today, historyFrom ?? firstDate)
  // All starts on the first transaction's day, not at the end of that month (Net worth keeps its month ends).
  const dates = (range === 'all' && !ends.includes(firstDate) ? [firstDate, ...ends] : ends).filter(
    (d) => !historyFrom || d >= historyFrom,
  )

  const cutoffs = dates.map((d) => periodRangeUtc(d, addDays(d, 1), tz).end)
  const since = cutoffs[0]
  const deltas: Delta[] = since
    ? db
        .select({ at: s.transactions.createdAt, cents })
        .from(s.transactions)
        .where(and(counted, gte(s.transactions.createdAt, since)))
        .all()
    : []
  const balances = rebuildTotals(saver.balanceCents, deltas, cutoffs)
  return dates.map((date, i) => ({ date, balanceCents: Math.round(balances[i]!) }))
}

/**
 * The debt's closing balance on each date, rounded; null before the ledger's first day. Dates the ledger has no row
 * for carry the last known balance, and the last entry is what's left today so the line ends on the card's figure.
 */
export function debtSeries(days: TimelineDay[], dates: LocalDate[], leftCents: number): (number | null)[] {
  const series = dates.map((date) => {
    let balance: number | null = null
    for (const d of days) {
      if (d.date > date) break
      balance = d.balance
    }
    return balance === null ? null : Math.round(balance)
  })
  if (series.length > 0) series[series.length - 1] = leftCents
  return series
}

/** The card's sparkline: the Saver's balance, and the line it chases. Null with fewer than 2 points. */
export function goalSparkline(
  db: Db,
  saver: AccountRow,
  kind: GoalKind,
  targetCents: number,
  followed: { leftCents: number; days: TimelineDay[] } | null,
  today: LocalDate,
  tz: string,
): GoalDto['sparkline'] {
  const points = saverHistory(db, saver, SPARKLINE_RANGE, today, tz)
  if (points.length < 2) return null
  const dates = points.map((p) => p.date)
  const target =
    kind === 'buffer'
      ? dates.map(() => targetCents)
      : kind === 'debt' && followed
        ? debtSeries(followed.days, dates, followed.leftCents)
        : null
  return { balance: points.map((p) => p.balanceCents), target }
}
