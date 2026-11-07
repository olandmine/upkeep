import { TZDate } from '@date-fns/tz'

/** 'YYYY-MM' → [start, end) as UTC ISO strings, with month boundaries in `tz`. */
export function monthRangeUtc(month: string, tz: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number)
  const start = new TZDate(year, m - 1, 1, tz)
  const end = new TZDate(year, m, 1, tz)
  return { start: new Date(start.getTime()).toISOString(), end: new Date(end.getTime()).toISOString() }
}

export function currentMonth(now: Date, tz: string): string {
  const local = new TZDate(now.getTime(), tz)
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number)
  const index = year * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}
