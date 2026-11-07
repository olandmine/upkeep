import { formatMoney } from '../../shared/money'
import type { InterestSettingsDto, PayoffScenarioDto, PayoffStrategy } from '../../shared/types'
import { monthlyInterest } from './projection'

export interface PayoffDebt {
  id: string
  name: string
  interest: InterestSettingsDto
  rateBp: number
  balanceCents: number
  /** The usual repayment as a monthly amount. */
  monthlyCents: number
  /** The account fee as a monthly amount; not interest. */
  feeMonthlyCents?: number
}

export interface PayoffMonth {
  month: string
  /** Debt id → closing balance, unrounded. */
  balances: Record<string, number>
  interest: number
}

const MAX_MONTHS = 600
/** Below half a cent a debt counts as paid. */
const PAID = 0.5

function addMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const index = y * 12 + (m - 1) + n
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

const monthsBetween = (later: string, earlier: string) => {
  const [ly, lm] = later.split('-').map(Number) as [number, number]
  const [ey, em] = earlier.split('-').map(Number) as [number, number]
  return (ly - ey) * 12 + (lm - em)
}

function interestFor(d: PayoffDebt, balance: number, month: string): number {
  if (balance <= 0) return 0
  if (d.interest.charge === 'yearly') {
    const chargeMonth = (d.interest.chargeDate ?? '06-01').slice(0, 2)
    return month.endsWith(`-${chargeMonth}`) ? (balance * d.rateBp) / 10_000 : 0
  }
  return monthlyInterest(d.interest, d.rateBp, balance)
}

/**
 * Month-by-month payoff. Each debt pays its own repayment; for Avalanche and Snowball the extra,
 * the repayments of paid-off debts and any unused repayment this month go to the targets in order.
 */
export function simulateBalances(
  debts: PayoffDebt[],
  extraCents: number,
  strategy: PayoffStrategy,
  startMonth: string,
): PayoffMonth[] {
  const balance = new Map(debts.map((d) => [d.id, d.balanceCents]))
  const months: PayoffMonth[] = []
  const owing = () => debts.some((d) => (balance.get(d.id) ?? 0) > PAID)

  for (let i = 0; i < MAX_MONTHS && owing(); i++) {
    const month = addMonth(startMonth, i)
    let interest = 0
    let pool = strategy === 'as-is' ? 0 : extraCents
    for (const d of debts) {
      let b = balance.get(d.id) ?? 0
      const charged = interestFor(d, b, month)
      interest += charged
      b += charged + (b > 0 ? (d.feeMonthlyCents ?? 0) : 0)
      const paid = Math.min(d.monthlyCents, Math.max(b, 0))
      b -= paid
      if (strategy !== 'as-is') pool += d.monthlyCents - paid
      balance.set(d.id, b <= PAID ? 0 : b)
    }
    if (strategy !== 'as-is') {
      const order = [...debts].sort((a, b) =>
        strategy === 'avalanche'
          ? b.rateBp - a.rateBp || balance.get(a.id)! - balance.get(b.id)!
          : balance.get(a.id)! - balance.get(b.id)! || b.rateBp - a.rateBp,
      )
      for (const d of order) {
        const b = balance.get(d.id)!
        if (b <= 0 || pool <= 0) continue
        const paid = Math.min(pool, b)
        pool -= paid
        balance.set(d.id, b - paid <= PAID ? 0 : b - paid)
      }
    }
    months.push({ month, balances: Object.fromEntries(balance), interest })
  }
  return months
}

export function simulatePayoff(
  debts: PayoffDebt[],
  extraCents: number,
  strategy: PayoffStrategy,
  startMonth: string,
): PayoffScenarioDto {
  const months = simulateBalances(debts, extraCents, strategy, startMonth)
  const payoffMonth = (id: string) => months.find((m) => (m.balances[id] ?? 0) <= 0)?.month ?? null
  const result = debts.map((d) => ({
    id: d.id,
    name: d.name,
    payoffMonth: d.balanceCents <= 0 ? null : payoffMonth(d.id),
  }))
  const unpaid = result.some((d, i) => d.payoffMonth === null && debts[i]!.balanceCents > 0)
  return {
    strategy,
    debtFreeMonth: unpaid ? null : (months.at(-1)?.month ?? null),
    totalInterestCents: Math.round(months.reduce((sum, m) => sum + m.interest, 0)),
    debts: result,
    series: months.map((m) => ({
      month: m.month,
      totalCents: Math.round(Object.values(m.balances).reduce((a, b) => a + b, 0)),
    })),
  }
}

const NAMES: Record<PayoffStrategy, string> = {
  'as-is': 'As is',
  avalanche: 'Avalanche',
  snowball: 'Snowball',
}

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  )
}

const byRate = (a: PayoffDebt, b: PayoffDebt) => b.rateBp - a.rateBp || a.balanceCents - b.balanceCents
const byBalance = (a: PayoffDebt, b: PayoffDebt) => a.balanceCents - b.balanceCents || b.rateBp - a.rateBp

/** Avalanche and Snowball would target the debts in the same order from the start. */
function sameTargetOrder(debts: PayoffDebt[]): boolean {
  const avalanche = [...debts].sort(byRate)
  const snowball = [...debts].sort(byBalance)
  return debts.length > 1 && avalanche.every((d, i) => d.id === snowball[i]!.id)
}

/** The spelled-out comparisons against As is. */
export function payoffDifferences(scenarios: PayoffScenarioDto[], debts: PayoffDebt[]): string[] {
  const by = (s: PayoffStrategy) => scenarios.find((x) => x.strategy === s)
  const asIs = by('as-is')
  const lines: string[] = []
  // Nothing owing in this plan: there is nothing to compare.
  if (!asIs || asIs.debts.length === 0) return lines
  for (const strategy of ['avalanche', 'snowball'] as const) {
    const s = by(strategy)
    if (!s?.debtFreeMonth) continue
    const name = NAMES[strategy]
    if (!asIs.debtFreeMonth) {
      lines.push(`${name}: debt-free by ${monthLabel(s.debtFreeMonth)} instead of never.`)
      continue
    }
    const sooner = monthsBetween(asIs.debtFreeMonth, s.debtFreeMonth)
    const saved = asIs.totalInterestCents - s.totalInterestCents
    if (sooner <= 0 && saved <= 0) continue
    const when = sooner > 0 ? `${sooner} month${sooner === 1 ? '' : 's'} sooner` : 'the same month'
    lines.push(`${name}: debt-free ${when} and ${formatMoney(Math.max(saved, 0))} less interest than As is.`)
  }
  const av = by('avalanche')
  const sn = by('snowball')
  if (av && sn && av.debtFreeMonth === sn.debtFreeMonth && av.totalInterestCents === sn.totalInterestCents) {
    lines.push(
      sameTargetOrder(debts)
        ? 'Avalanche and Snowball finish together: your highest-rate debts are also your smallest, so both pay them off in the same order.'
        : 'Avalanche and Snowball finish together.',
    )
  }
  return lines
}
