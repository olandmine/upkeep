/** A calendar date in the configured timezone, as 'YYYY-MM-DD'. */
export type LocalDate = string

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const parts = (d: LocalDate) => d.split('-').map(Number) as [number, number, number]

// Calendar arithmetic through UTC midnight, so it never sees a DST shift.
export function addDays(d: LocalDate, n: number): LocalDate {
  const [y, m, day] = parts(d)
  const t = new Date(Date.UTC(y, m - 1, day) + n * DAY_MS)
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

export function dayOfMonth(d: LocalDate): number {
  return parts(d)[2]
}

/** Moves `months` calendar months and lands on `day`, clamped to that month's last day (31 → 30 Nov). */
export function addMonthsClamped(d: LocalDate, months: number, day: number): LocalDate {
  const [y, m] = parts(d)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return ymd(year, month, Math.min(day, last))
}

/** a − b in whole days. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  const [ay, am, ad] = parts(a)
  const [by, bm, bd] = parts(b)
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / DAY_MS)
}
