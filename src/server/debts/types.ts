import type { LocalDate } from '../budgets/dates'

/** A balance the user entered: the debt's closing balance on `asOf`. */
export interface StartingPoint {
  id: string
  asOf: LocalDate
  balanceCents: number
}

/** A matched repayment; `amountCents` is positive. */
export interface Repayment {
  transactionId: string
  date: LocalDate
  amountCents: number
}

/** Closing balance of a day, in unrounded cents. */
export interface TimelineDay {
  date: LocalDate
  balance: number
}

export interface Timeline {
  days: TimelineDay[]
  /** Starting point id → entered − calculated, for every point after the first. */
  corrections: Record<string, number>
  paidOffOn: LocalDate | null
  /** No repayment rule: repayments are assumed from the usual repayment. */
  estimated: boolean
}
