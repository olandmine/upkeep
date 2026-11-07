import { editKey, isChargeDay } from '../../shared/debt-interest'
import type {
  DebtActivityDto,
  DebtFeeDto,
  DebtEntryKind,
  DebtRateDto,
  InterestSettingsDto,
  RepaymentFrequency,
} from '../../shared/types'
import { addDays, dayOfMonth, type LocalDate } from '../budgets/dates'
import { isFeeDay, nextDue } from './schedule'
import type { Repayment, StartingPoint, Timeline, TimelineDay } from './types'

export interface LedgerInput {
  settings: InterestSettingsDto
  /** Any order. */
  rates: DebtRateDto[]
  points: StartingPoint[]
  /** `null`: no repayment rule, so the usual repayment is assumed on its due dates. */
  repayments: (Repayment & { description: string; oneOff: boolean })[] | null
  entries: { id: string; kind: DebtEntryKind; date: LocalDate; amountCents: number; note: string | null }[]
  /** Edit key (the charge date; for daily charging the month's last day) → cents. */
  edits: Record<LocalDate, number>
  usual: { repaymentCents: number; repaymentFrequency: RepaymentFrequency }
  /** The account fee, if any. */
  fee?: DebtFeeDto | null
  /** Projection only: interest already built up at the first point, and the assumed schedule. */
  openingAccrued?: number
  schedule?: { nextDue: LocalDate; dueDay: number }
  stopWhenPaidOff?: boolean
  /** Through this date an imported statement is the whole history: Up and assumed repayments are left out. */
  historyThrough?: LocalDate | null
}

export interface Ledger extends Timeline {
  /** Oldest first. */
  activity: DebtActivityDto[]
  /** Interest built up at the end of `to`, not yet charged. */
  accruing: number
  nextChargeOn: LocalDate | null
}

const byFromDate = (a: DebtRateDto, b: DebtRateDto) => a.fromDate.localeCompare(b.fromDate)

/** `sorted` is ordered by `fromDate`. The earliest rate also applies before its own date. */
function rateAt(sorted: DebtRateDto[], date: LocalDate): number {
  let found = sorted[0]
  for (const r of sorted) if (r.fromDate <= date) found = r
  return found?.rateBp ?? 0
}

/** The rate in force on `date`, in basis points. */
export function rateOn(rates: DebtRateDto[], date: LocalDate): number {
  return rateAt([...rates].sort(byFromDate), date)
}

/** A charge day's share of a year for interest worked out when charged. */
const SHARE = { daily: 1 / 365, monthly: 1 / 12, yearly: 1 } as const

function group<T extends { date: LocalDate }>(items: T[]): Map<LocalDate, T[]> {
  const map = new Map<LocalDate, T[]>()
  for (const item of items) map.set(item.date, [...(map.get(item.date) ?? []), item])
  return map
}

/**
 * Walks a debt day by day from its first starting point to `to`, carrying the charged balance and the
 * interest built up. The first balance opens the first day, and that day's additions and payments follow it;
 * later days charge, build up, add, pay, then check.
 */
export function debtLedger(input: LedgerInput, to: LocalDate): Ledger {
  const { settings, edits, usual } = input
  const estimated = input.repayments === null
  const sorted = [...input.points].sort((a, b) => a.asOf.localeCompare(b.asOf))
  const first = sorted[0]
  if (!first) {
    return {
      days: [],
      corrections: {},
      paidOffOn: null,
      estimated,
      activity: [],
      accruing: 0,
      nextChargeOn: null,
    }
  }

  const rates = [...input.rates].sort(byFromDate)
  const pointOn = new Map(sorted.map((p) => [p.asOf, p]))
  const through = input.historyThrough ?? null
  const repaidOn = group((input.repayments ?? []).filter((r) => through === null || r.date > through))
  const entriesOn = group(input.entries)
  // A rate dated before the first balance is listed on the first balance's day.
  const ratesOn = group(rates.map((r) => ({ ...r, date: r.fromDate < first.asOf ? first.asOf : r.fromDate })))

  const days: TimelineDay[] = []
  const activity: DebtActivityDto[] = []
  const corrections: Record<string, number> = {}
  let balance = first.balanceCents
  let accrued = first.balanceCents <= 0 ? 0 : (input.openingAccrued ?? 0)
  let paidOffOn: LocalDate | null = first.balanceCents <= 0 ? first.asOf : null
  let lastCharge: LocalDate | null = null
  let dueDay = input.schedule?.dueDay ?? dayOfMonth(first.asOf)
  // Without a schedule, the first balance starts one.
  let due: LocalDate = input.schedule?.nextDue ?? nextDue(first.asOf, usual.repaymentFrequency, dueDay)
  // Daily charging: this calendar month's charges so far, shown as one row.
  let monthStart = first.asOf
  let monthCharged = 0

  const row = (
    date: LocalDate,
    amount: number,
    extra: DistributiveOmit<DebtActivityDto, 'date' | 'amountCents' | 'balanceAfterCents'>,
  ) =>
    ({
      date,
      amountCents: Math.round(amount),
      balanceAfterCents: Math.round(balance),
      ...extra,
    }) as DebtActivityDto

  // Only the first day can have a schedule due on or before it; step past those.
  while (due <= first.asOf) due = nextDue(due, usual.repaymentFrequency, dueDay)

  for (let d = first.asOf; d <= to; d = addDays(d, 1)) {
    const isFirst = d === first.asOf
    let paidToday = false
    for (const r of ratesOn.get(d) ?? []) {
      activity.push(row(d, 0, { key: `rate:${r.id}`, kind: 'rate', rateId: r.id, rateBp: r.rateBp }))
    }
    if (isFirst) {
      activity.push(
        row(d, 0, { key: `check:${first.id}`, kind: 'check', balanceId: first.id, correctionCents: null }),
      )
    }
    const interestAt = activity.length
    let lateGroup: DebtActivityDto | null = null

    if (!isFirst) {
      const rateBp = rateAt(rates, d)

      // 1. Charge.
      if (isChargeDay(settings, d)) {
        // Whole cents once charged, as a lender would; what builds up in between stays unrounded.
        const calculated = Math.round(
          settings.calc === 'daily'
            ? accrued
            : balance > 0
              ? ((balance * rateBp) / 10_000) * SHARE[settings.charge]
              : 0,
        )
        accrued = 0
        if (settings.charge === 'daily') {
          if (dayOfMonth(d) === 1) {
            monthStart = d
            monthCharged = 0
          }
          balance += calculated
          monthCharged += calculated
          const key = editKey(settings, d)
          const edit = key === d ? edits[key] : undefined
          if (edit !== undefined) balance += edit - monthCharged
          const amount = edit ?? monthCharged
          const month = row(d, amount, {
            key: `interest:${key}`,
            kind: 'interest',
            chargeDate: key,
            periodStart: monthStart,
            periodEnd: d,
            calculatedCents: Math.round(monthCharged),
            edited: edit !== undefined,
          })
          if (key === d || d === to) {
            if (month.amountCents !== 0 || edit !== undefined) activity.push(month)
          } else if (month.amountCents !== 0) {
            lateGroup = month
          }
        } else {
          const edit = edits[d]
          const amount = edit ?? calculated
          balance += amount
          if (Math.round(amount) !== 0 || edit !== undefined) {
            activity.push(
              row(d, amount, {
                key: `interest:${d}`,
                kind: 'interest',
                chargeDate: d,
                periodStart: lastCharge ?? first.asOf,
                periodEnd: addDays(d, -1),
                calculatedCents: Math.round(calculated),
                edited: edit !== undefined,
              }),
            )
          }
          lastCharge = d
        }
      }

      // Then the account fee, while something is owed.
      if (input.fee && balance > 0 && isFeeDay(input.fee, d)) {
        balance += input.fee.amountCents
        activity.push(row(d, input.fee.amountCents, { key: `fee:${d}`, kind: 'fee' }))
      }

      // 2. Build up.
      if (settings.calc === 'daily' && balance > 0) accrued += (balance * rateBp) / 10_000 / 365
    }

    {
      // 3. Added to debt.
      const todays = entriesOn.get(d) ?? []
      for (const e of todays.filter((e) => e.kind === 'added')) {
        balance += e.amountCents
        activity.push(
          row(d, e.amountCents, { key: `entry:${e.id}`, kind: 'added', entryId: e.id, note: e.note }),
        )
      }

      // 4. Payments: outside Up, then repayments from Up or the assumed one. Once at $0 they change nothing.
      const pay = (cents: number) => {
        if (balance <= 0) return
        balance -= cents
        if (balance <= 0) {
          balance = 0
          accrued = 0
          paidToday = true
          paidOffOn = d
        }
      }
      for (const e of todays.filter((e) => e.kind === 'payment')) {
        pay(e.amountCents)
        activity.push(
          row(d, -e.amountCents, { key: `entry:${e.id}`, kind: 'payment', entryId: e.id, note: e.note }),
        )
      }
      for (const r of repaidOn.get(d) ?? []) {
        pay(r.amountCents)
        activity.push(
          row(d, -r.amountCents, {
            key: `repayment:${r.transactionId}`,
            kind: 'repayment',
            transactionId: r.transactionId,
            description: r.description,
            oneOff: r.oneOff,
          }),
        )
      }
      if (estimated && d === due) {
        if (balance > 0 && usual.repaymentCents > 0 && (through === null || d > through)) {
          pay(usual.repaymentCents)
          activity.push(row(d, -usual.repaymentCents, { key: `assumed:${d}`, kind: 'assumed' }))
        }
        due = nextDue(d, usual.repaymentFrequency, dueDay)
      }
    }

    // 5. Balance check; the first balance opened the day instead.
    const point = isFirst ? undefined : pointOn.get(d)
    if (point) {
      const correction = point.balanceCents - balance
      corrections[point.id] = correction
      balance = point.balanceCents
      if (balance <= 0) accrued = 0
      paidOffOn = balance <= 0 ? d : null
      if (!input.schedule) {
        dueDay = dayOfMonth(d)
        due = nextDue(d, usual.repaymentFrequency, dueDay)
      }
      activity.push(
        row(d, correction, {
          key: `check:${point.id}`,
          kind: 'check',
          balanceId: point.id,
          correctionCents: Math.round(correction),
        }),
      )
    } else if (balance > 0) {
      paidOffOn = null
    }

    // A part-month daily charge row is still owed when the walk stops early on payoff.
    const stopping = input.stopWhenPaidOff === true && paidToday && !point
    if (stopping && lateGroup) activity.splice(interestAt, 0, lateGroup)
    days.push({ date: d, balance })
    if (stopping) break
  }

  let nextChargeOn: LocalDate | null = null
  for (let d = addDays(to, 1), i = 0; i < 366 && nextChargeOn === null; d = addDays(d, 1), i++) {
    if (isChargeDay(settings, d)) nextChargeOn = d
  }
  return { days, corrections, paidOffOn, estimated, activity, accruing: accrued, nextChargeOn }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
