import type { LocalDate } from '../budgets/dates'
export { debtLeft } from '../debts/debts'
import type { TimelineDay } from '../debts/types'

/** The closing balance of the latest day before `date`, or the first balance when the debt starts later. */
function balanceBefore(days: TimelineDay[], date: LocalDate): number {
  let balance = days[0]!.balance
  for (const d of days) {
    if (d.date >= date) break
    balance = d.balance
  }
  return balance
}

/** How much the balance fell per period over the given periods (negative when it grew). */
export function debtFall(days: TimelineDay[], periods: [LocalDate, LocalDate][]): number {
  if (periods.length === 0 || days.length === 0) return 0
  const before = balanceBefore(days, periods[0]![0])
  const after = balanceBefore(days, periods.at(-1)![1])
  return Math.round((before - after) / periods.length)
}
