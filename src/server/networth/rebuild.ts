import type { GoalRange } from '../../shared/types'
import { addDays, addMonthsClamped, dayOfMonth, type LocalDate } from '../budgets/dates'

/** A transaction's effect on a balance at a UTC instant (stored `created_at`, ISO). */
export interface Delta {
  at: string
  cents: number
}

/** An account opening further than $1 from $0 means its early history was never synced. */
const OPENING_TOLERANCE = 100

/**
 * Balances just before each cutoff (ascending UTC ISO instants, e.g. the local midnight after each point):
 * today's balance minus everything at or after the cutoff. ISO strings compare in time order, so no
 * per-transaction timezone conversion is needed.
 */
export function rebuildTotals(balanceNow: number, deltas: Delta[], cutoffs: string[]): number[] {
  const newest = [...deltas].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const out = cutoffs.map(() => 0)
  let balance = balanceNow
  let i = 0
  for (let k = cutoffs.length - 1; k >= 0; k--) {
    while (i < newest.length && newest[i]!.at >= cutoffs[k]!) balance -= newest[i++]!.cents
    out[k] = balance
  }
  return out
}

/** The latest first-transaction date among accounts whose rebuilt opening balance isn't about $0. */
export function historyStart(
  accounts: { type: string; balanceNow: number; totalCents: number; firstDate: LocalDate | null }[],
): LocalDate | null {
  let start: LocalDate | null = null
  for (const a of accounts) {
    if (a.type === 'HOME_LOAN' || !a.firstDate) continue
    if (Math.abs(a.balanceNow - a.totalCents) <= OPENING_TOLERANCE) continue
    if (!start || a.firstDate > start) start = a.firstDate
  }
  return start
}

/** How many months each range reaches back; `all` has no limit. */
export const RANGE_MONTHS: Record<Exclude<GoalRange, 'all'>, number> = { '3m': 3, '6m': 6, '1y': 12 }

/** Weekly back from today for 3m/6m/1y; month ends from `firstDate` plus today for all. Ascending. */
export function pointDates(range: GoalRange, today: LocalDate, firstDate: LocalDate): LocalDate[] {
  if (range === 'all') {
    const dates: LocalDate[] = []
    const thisMonth = today.slice(0, 7)
    for (let m = `${firstDate.slice(0, 7)}-01`; m.slice(0, 7) < thisMonth; m = addMonthsClamped(m, 1, 1)) {
      dates.push(addMonthsClamped(m, 0, 31))
    }
    return [...dates, today]
  }
  const start = addMonthsClamped(today, -RANGE_MONTHS[range], dayOfMonth(today))
  const dates: LocalDate[] = []
  for (let d = today; d >= start; d = addDays(d, -7)) dates.unshift(d)
  return dates
}
