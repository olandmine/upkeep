import type { DebtActivityDto, DebtDto, DebtKind, FeeFrequency, InterestCharge, RepaymentFrequency } from '../../../shared/types'
import { money } from '../budgets/format'
import { longDate } from './DebtSections'

/** 649 → "6.49%". */
export function rateText(bp: number): string {
  return `${Number((bp / 100).toFixed(2))}%`
}

/** "6.49" → 649; null for anything that isn't a rate between 0% and 100%. */
export function parseRate(text: string): number | null {
  const t = text.trim().replace(/%$/, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const bp = Math.round(Number(t) * 100)
  return bp <= 10_000 ? bp : null
}

/** "2027-03" → "Mar 2027". */
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month.slice(0, 7)}-01T00:00:00Z`),
  )
}

export const KIND_LABEL: Record<DebtKind, string> = {
  loan: 'Loan',
  credit_card: 'Credit card',
  bnpl: 'BNPL',
  ato: 'ATO',
  hecs: 'HECS/HELP',
}

/** The rate field's label per kind; BNPL has no rate. */
export const RATE_LABEL: Record<DebtKind, string | null> = {
  loan: 'Interest rate (yearly)',
  credit_card: 'Interest rate (yearly)',
  bnpl: null,
  ato: 'Interest rate (yearly)',
  hecs: 'Indexation rate (yearly)',
}

export const FREQUENCY_LABEL: Record<RepaymentFrequency, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
}

export const FEE_FREQUENCY_LABEL: Record<FeeFrequency, string> = { ...FREQUENCY_LABEL, yearly: 'Yearly' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09-01" → "1 Sep" (fixed month names: the browser's short September is "Sept"). */
function dayMonth(date: string): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number]
  return `${d} ${MONTHS[m - 1]}`
}

/** "+$95.00 interest building up · charged 1 Nov 2026", or null when nothing is building up. */
export function buildingUpCaption(debt: DebtDto): string | null {
  if (debt.accruingCents < 1 || !debt.nextChargeOn) return null
  return `+${money(debt.accruingCents)} interest building up · charged ${longDate(debt.nextChargeOn)}`
}

/** The Activity description for a row; `firstRate` is the debt's opening rate. */
export function activityLabel(row: DebtActivityDto, charge: InterestCharge, firstRate = false): string {
  switch (row.kind) {
    case 'interest': {
      if (charge === 'daily') {
        const [y, m] = row.periodStart.split('-').map(Number) as [number, number]
        return `Interest ${MONTHS[m - 1]} ${y}`
      }
      return `Interest ${dayMonth(row.periodStart)} – ${dayMonth(row.periodEnd)}`
    }
    case 'repayment':
      return row.description
    case 'fee':
      return 'Account fee'
    case 'assumed':
      return 'Usual repayment (assumed)'
    case 'added':
      return row.note || 'Added to debt'
    case 'payment':
      return row.note || 'Payment outside Up'
    case 'check':
      return 'Balance check'
    case 'rate':
      return firstRate ? `Rate ${rateText(row.rateBp)}` : `Rate changed to ${rateText(row.rateBp)}`
  }
}
