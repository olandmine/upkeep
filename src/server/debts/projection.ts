import type { DebtFeeDto, DebtRateDto, InterestSettingsDto } from '../../shared/types'
import { addDays, type LocalDate } from '../budgets/dates'
import { debtLedger, rateOn, type LedgerInput } from './ledger'
import { monthlyEquivalent } from './schedule'

export interface Projection {
  payoffDate: LocalDate | null
  totalInterestCents: number
  shortfallCents: number | null
}

export interface ProjectionInput {
  settings: InterestSettingsDto
  rates: DebtRateDto[]
  usual: LedgerInput['usual']
  fee?: DebtFeeDto | null
}

const MAX_DAYS = 50 * 365

/** A month's interest on `balance`, used for the shortfall and the payoff plan. */
export function monthlyInterest(settings: InterestSettingsDto, rateBp: number, balance: number): number {
  const r = rateBp / 10_000
  if (settings.charge === 'daily') return balance * ((1 + r / 365) ** (365 / 12) - 1)
  return (balance * r) / 12
}

/**
 * Continues the ledger walk from today with the latest rates and the usual repayment on its due dates.
 * `accruing` is the interest already built up, charged at the next charge. Null once paid off.
 */
export function projectDebt(
  input: ProjectionInput,
  from: { balance: number; accruing: number; today: LocalDate; nextDue: LocalDate; dueDay: number },
): Projection | null {
  if (from.balance <= 0) return null
  const ledger = debtLedger(
    {
      ...input,
      points: [{ id: 'today', asOf: from.today, balanceCents: from.balance }],
      repayments: null,
      entries: [],
      edits: {},
      openingAccrued: from.accruing,
      schedule: { nextDue: from.nextDue, dueDay: from.dueDay },
      stopWhenPaidOff: true,
    },
    addDays(from.today, MAX_DAYS),
  )
  const interest = ledger.activity.reduce((sum, a) => sum + (a.kind === 'interest' ? a.amountCents : 0), 0)
  if (ledger.paidOffOn) {
    return { payoffDate: ledger.paidOffOn, totalInterestCents: interest, shortfallCents: null }
  }
  const short =
    monthlyInterest(input.settings, rateOn(input.rates, from.today), from.balance) +
    (input.fee ? monthlyEquivalent(input.fee.amountCents, input.fee.frequency) : 0) -
    monthlyEquivalent(input.usual.repaymentCents, input.usual.repaymentFrequency)
  return { payoffDate: null, totalInterestCents: interest, shortfallCents: short > 0 ? Math.round(short) : null }
}
