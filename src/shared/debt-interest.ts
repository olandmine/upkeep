import type { DebtKind, InterestSettingsDto } from './types'

const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
const parts = (date: string) => date.split('-').map(Number) as [number, number, number]

/** The interest settings a kind starts with. `firstAsOf` is the first balance's date. */
export function interestDefaults(kind: DebtKind, firstAsOf: string): InterestSettingsDto {
  switch (kind) {
    case 'loan':
    case 'credit_card':
      return { calc: 'on_charge', charge: 'monthly', chargeDay: parts(firstAsOf)[2], chargeDate: null }
    case 'ato':
      return { calc: 'daily', charge: 'monthly', chargeDay: 1, chargeDate: null }
    case 'hecs':
      return { calc: 'on_charge', charge: 'yearly', chargeDay: null, chargeDate: '06-01' }
    case 'bnpl':
      return { calc: 'on_charge', charge: 'monthly', chargeDay: 1, chargeDate: null }
  }
}

/** Whether interest is charged on `date`. Day 29–31 and `02-29` clamp to the month's last day. */
export function isChargeDay(s: InterestSettingsDto, date: string): boolean {
  if (s.charge === 'daily') return true
  const [y, m, d] = parts(date)
  if (s.charge === 'monthly') return d === Math.min(s.chargeDay ?? 1, lastDayOf(y, m))
  const [cm, cd] = (s.chargeDate ?? '06-01').split('-').map(Number) as [number, number]
  return m === cm && d === Math.min(cd, lastDayOf(y, m))
}

/** The date an interest edit is stored under: the month's last day for daily charging, else the charge date. */
export function editKey(s: InterestSettingsDto, chargeDate: string): string {
  if (s.charge !== 'daily') return chargeDate
  const [y, m] = parts(chargeDate)
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDayOf(y, m)).padStart(2, '0')}`
}
