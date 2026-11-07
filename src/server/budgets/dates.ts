import { TZDate } from '@date-fns/tz'
import type { LocalDate } from '../../shared/dates'

// The timezone-free helpers live in shared code (the web uses them too); everything imports them from here.
export { addDays, addMonthsClamped, dayOfMonth, diffDays, type LocalDate } from '../../shared/dates'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const parts = (d: LocalDate) => d.split('-').map(Number) as [number, number, number]

/** The local date in `tz` of a UTC ISO instant. */
export function localDate(iso: string, tz: string): LocalDate {
  const t = new TZDate(new Date(iso).getTime(), tz)
  return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate())
}

export function todayLocal(now: Date, tz: string): LocalDate {
  return localDate(now.toISOString(), tz)
}

/** [start, end) local midnights in `tz` as UTC ISO strings. */
export function periodRangeUtc(start: LocalDate, end: LocalDate, tz: string): { start: string; end: string } {
  const at = (d: LocalDate) => {
    const [y, m, day] = parts(d)
    return new Date(new TZDate(y, m - 1, day, tz).getTime()).toISOString()
  }
  return { start: at(start), end: at(end) }
}
