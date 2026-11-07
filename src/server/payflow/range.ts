import type { PayFlowRange } from '../../shared/types'
import type { LocalDate } from '../budgets/dates'

export interface RangeSpan {
  start: LocalDate
  /** Exclusive; null for the current period, which runs to today. */
  end: LocalDate | null
  prevDate: LocalDate
  nextDate: LocalDate | null
  isCurrent: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number) => `${y}-${pad(m)}-01`

/** The first day of the month, year or financial year (from 1 July) holding `date`, and its neighbours. */
function startOf(range: Exclude<PayFlowRange, 'pay'>, date: LocalDate): { y: number; m: number } {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  if (range === 'month') return { y, m }
  if (range === 'year') return { y, m: 1 }
  return { y: m >= 7 ? y : y - 1, m: 7 }
}

function step(range: Exclude<PayFlowRange, 'pay'>, { y, m }: { y: number; m: number }, by: number) {
  if (range !== 'month') return { y: y + by, m }
  const i = y * 12 + (m - 1) + by
  return { y: Math.floor(i / 12), m: (i % 12) + 1 }
}

/** A calendar month, calendar year or Australian financial year: its bounds and the ones either side. */
export function rangeSpan(range: Exclude<PayFlowRange, 'pay'>, date: LocalDate, today: LocalDate): RangeSpan {
  const current = startOf(range, today)
  const at = startOf(range, date < today ? date : today)
  const next = step(range, at, 1)
  const isCurrent = at.y === current.y && at.m === current.m
  const prev = step(range, at, -1)
  return {
    start: ymd(at.y, at.m),
    end: isCurrent ? null : ymd(next.y, next.m),
    prevDate: ymd(prev.y, prev.m),
    nextDate: isCurrent ? null : ymd(next.y, next.m),
    isCurrent,
  }
}
