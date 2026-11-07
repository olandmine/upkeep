import { formatMoney } from '../../../shared/money'

/** Plain-text money for composed labels like "$60.00 / $100.00" (always positive figures here). */
export const money = (cents: number) => formatMoney(cents)

/** 'YYYY-MM-DD' → "30 Oct" without timezone drift. */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** "$1,234.5" / "600" → cents, or null when it isn't a non-negative amount. */
export function parseDollars(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  return Math.round(Number(clean) * 100)
}
