import type { DebtFeeDto, FeeFrequency, RepaymentFrequency } from '../../shared/types'
import { addDays, addMonthsClamped, dayOfMonth, diffDays, type LocalDate } from '../budgets/dates'
import type { StartingPoint } from './types'

/** The due date after `prev`: +7 or +14 days, or next month on `anchorDay` (clamped). */
export function nextDue(prev: LocalDate, frequency: RepaymentFrequency, anchorDay: number): LocalDate {
  if (frequency === 'weekly') return addDays(prev, 7)
  if (frequency === 'fortnightly') return addDays(prev, 14)
  return addMonthsClamped(prev, 1, anchorDay)
}

export function monthlyEquivalent(cents: number, frequency: FeeFrequency): number {
  if (frequency === 'weekly') return (cents * 52) / 12
  if (frequency === 'fortnightly') return (cents * 26) / 12
  if (frequency === 'yearly') return cents / 12
  return cents
}

/** Whether the fee comes out on `d`: every 7 or 14 days from `from`, or monthly or yearly on its day (clamped). */
export function isFeeDay(fee: DebtFeeDto, d: LocalDate): boolean {
  if (d < fee.from) return false
  if (fee.frequency === 'weekly') return diffDays(d, fee.from) % 7 === 0
  if (fee.frequency === 'fortnightly') return diffDays(d, fee.from) % 14 === 0
  if (fee.frequency === 'yearly' && d.slice(5, 7) !== fee.from.slice(5, 7)) return false
  return d === addMonthsClamped(d, 0, dayOfMonth(fee.from))
}

/** Day of month of the latest starting point on or before `d`: the usual repayment's due day until one is matched. */
export function chargeDayFor(points: StartingPoint[], d: LocalDate): number {
  const latest = [...points]
    .filter((p) => p.asOf <= d)
    .sort((a, b) => a.asOf.localeCompare(b.asOf))
    .at(-1)
  return dayOfMonth(latest?.asOf ?? d)
}
