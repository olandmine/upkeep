import { and, asc, count, eq, isNotNull, isNull, ne } from 'drizzle-orm'
import type {
  DebtBalancePoint,
  DebtRange,
  DebtDetailDto,
  DebtDto,
  DebtFeeDto,
  DebtInputDto,
  DebtPatchDto,
  DebtRateDto,
  InterestSettingsDto,
  Scope,
} from '../../shared/types'
import { interestDefaults } from '../../shared/debt-interest'
import { addDays, addMonthsClamped, dayOfMonth, type LocalDate } from '../budgets/dates'
import { BudgetError } from '../budgets/errors'
import { rangeSpan } from '../payflow/range'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { DebtRow } from '../db/schema'
import { canSee } from '../sharing/policy'
import { debtLedger, rateOn, type Ledger, type LedgerInput } from './ledger'
import { projectDebt } from './projection'
import { hiddenTransactionIds, listRepaymentExclusions, matchedRepayments, repaymentRules, tracksRepayments } from './repayments'
import { chargeDayFor, nextDue } from './schedule'
import type { Repayment, StartingPoint, TimelineDay } from './types'

export function debtsInScope(db: Db, scope: Scope, viewerId: string): DebtRow[] {
  const where = {
    everyone: undefined,
    me: eq(s.debts.ownerUserId, viewerId),
    partner: and(isNotNull(s.debts.ownerUserId), ne(s.debts.ownerUserId, viewerId)),
    joint: isNull(s.debts.ownerUserId),
  }[scope]
  return db
    .select()
    .from(s.debts)
    .where(where)
    .orderBy(asc(s.debts.createdAt), asc(s.debts.name))
    .all()
    .filter((d) => canSee(db, viewerId, d.ownerUserId, 'finances'))
}

/** Personal debts: their owner. Joint debts: both users. */
export function canEditDebt(debt: DebtRow, viewerId: string): boolean {
  return debt.ownerUserId === null || debt.ownerUserId === viewerId
}

const displayName = (db: Db, userId: string) =>
  db.select({ name: s.users.displayName }).from(s.users).where(eq(s.users.id, userId)).get()?.name ??
  'someone else'

const forbidden = (db: Db, userId: string) =>
  new BudgetError(403, `Only ${displayName(db, userId)} can edit that.`)

export function getDebt(db: Db, id: string): DebtRow {
  const debt = db.select().from(s.debts).where(eq(s.debts.id, id)).get()
  if (!debt) throw new BudgetError(404, 'Debt not found')
  return debt
}

/** A debt whose owner hides their finances looks the same as one that doesn't exist. */
export function requireVisibleDebt(db: Db, id: string, viewerId: string): DebtRow {
  const debt = getDebt(db, id)
  if (!canSee(db, viewerId, debt.ownerUserId, 'finances')) throw new BudgetError(404, 'Debt not found')
  return debt
}

export function requireEditableDebt(db: Db, id: string, viewerId: string): DebtRow {
  const debt = requireVisibleDebt(db, id, viewerId)
  if (!canEditDebt(debt, viewerId)) throw forbidden(db, debt.ownerUserId!)
  return debt
}

/** A new debt is the viewer's own or joint. */
export function checkOwner(db: Db, ownerUserId: string | null, viewerId: string) {
  if (ownerUserId !== null && ownerUserId !== viewerId) throw forbidden(db, ownerUserId)
}

function checkAsOf(asOf: LocalDate, today: LocalDate) {
  if (asOf > today) throw new BudgetError(400, "Balance date can't be in the future.")
}

/** Days in each month; 02-29 is allowed and clamps to 28 Feb in other years. */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Monthly charging needs a day from 1 to 31, yearly a real 'MM-DD' date. */
export function validateInterest(i: InterestSettingsDto): void {
  if (i.charge === 'monthly') {
    const day = i.chargeDay
    if (day === null || !Number.isInteger(day) || day < 1 || day > 31)
      throw new BudgetError(400, 'Pick a day from 1 to 31.')
  }
  if (i.charge === 'yearly') {
    const [, month, day] = /^(\d{2})-(\d{2})$/.exec(i.chargeDate ?? '')?.map(Number) ?? []
    if (!month || !day || month > 12 || day > MONTH_DAYS[month - 1]!)
      throw new BudgetError(400, 'Pick a date for yearly interest.')
  }
}

/** The debt's interest columns, keeping only the day or date its charging uses. */
export function interestColumns(i: InterestSettingsDto) {
  return {
    interestCalc: i.calc,
    interestCharge: i.charge,
    interestChargeDay: i.charge === 'monthly' ? i.chargeDay : null,
    interestChargeDate: i.charge === 'yearly' ? i.chargeDate : null,
  }
}

/** The debt's fee columns; null clears the fee. */
const feeColumns = (fee: DebtFeeDto | null) => ({
  feeCents: fee?.amountCents ?? null,
  feeFrequency: fee?.frequency ?? null,
  feeFrom: fee?.from ?? null,
})

export const feeOf = (debt: DebtRow): DebtFeeDto | null =>
  debt.feeCents && debt.feeFrequency && debt.feeFrom
    ? { amountCents: debt.feeCents, frequency: debt.feeFrequency, from: debt.feeFrom }
    : null

export const settingsOf = (debt: DebtRow): InterestSettingsDto => ({
  calc: debt.interestCalc,
  charge: debt.interestCharge,
  chargeDay: debt.interestChargeDay,
  chargeDate: debt.interestChargeDate,
})

export function createDebt(
  db: Db,
  input: DebtInputDto,
  viewerId: string,
  now: Date,
  today: LocalDate,
): DebtRow {
  checkOwner(db, input.ownerUserId, viewerId)
  checkAsOf(input.asOf, today)
  if (input.interest) validateInterest(input.interest)
  const stamp = now.toISOString()
  const id = crypto.randomUUID()
  db.transaction((tx) => {
    tx.insert(s.debts)
      .values({
        id,
        ownerUserId: input.ownerUserId,
        kind: input.kind,
        name: input.name,
        ...interestColumns(input.interest ?? interestDefaults(input.kind, input.asOf)),
        repaymentCents: input.repaymentCents,
        repaymentFrequency: input.repaymentFrequency,
        ...feeColumns(input.fee ?? null),
        createdByUserId: viewerId,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run()
    tx.insert(s.debtBalances)
      .values({
        id: crypto.randomUUID(),
        debtId: id,
        asOf: input.asOf,
        balanceCents: input.balanceCents,
        createdAt: stamp,
      })
      .run()
    // The first rate, dated the first balance's.
    tx.insert(s.debtRates)
      .values({
        id: crypto.randomUUID(),
        debtId: id,
        fromDate: input.asOf,
        rateBp: input.kind === 'bnpl' ? 0 : input.rateBp,
        createdAt: stamp,
      })
      .run()
  })
  return getDebt(db, id)
}

/** Name, usual repayment and interest settings; the rate changes through the rate history. */
export function updateDebt(db: Db, id: string, patch: DebtPatchDto, viewerId: string, now: Date): DebtRow {
  requireEditableDebt(db, id, viewerId)
  const { interest, fee, ...fields } = patch
  if (interest) validateInterest(interest)
  db.update(s.debts)
    .set({
      ...fields,
      ...(interest && interestColumns(interest)),
      ...(fee !== undefined && feeColumns(fee)),
      updatedAt: now.toISOString(),
    })
    .where(eq(s.debts.id, id))
    .run()
  return getDebt(db, id)
}

/**
 * A goal that followed the debt stays as a Save up to goal at the last left amount, remembering the debt's name. A paid-off
 * debt leaves a $0 target, so its goal keeps the start target to archive as what it was (a $0 target is always reached).
 */
export function deleteDebt(db: Db, id: string, viewerId: string, today: LocalDate, tz: string): void {
  const debt = requireEditableDebt(db, id, viewerId)
  db.transaction((tx) => {
    const followers = tx.select({ accountId: s.goals.accountId }).from(s.goals).where(eq(s.goals.debtId, id)).all()
    if (followers.length > 0) {
      const leftCents = debtLeft(tx, debt, today, tz).leftCents
      tx.update(s.goals)
        .set({
          kind: 'save',
          targetCents: leftCents,
          debtId: null,
          ...(leftCents > 0 && { startTargetCents: null }),
          followedDebtName: debt.name,
        })
        .where(eq(s.goals.debtId, id))
        .run()
    }
    tx.delete(s.debts).where(eq(s.debts.id, id)).run()
  })
}

/** "Update balance": a balance for a date that already has one replaces it. */
export function addBalance(
  db: Db,
  id: string,
  body: { balanceCents: number; asOf: LocalDate },
  viewerId: string,
  now: Date,
  today: LocalDate,
): void {
  requireEditableDebt(db, id, viewerId)
  checkAsOf(body.asOf, today)
  db.insert(s.debtBalances)
    .values({ id: crypto.randomUUID(), debtId: id, ...body, createdAt: now.toISOString() })
    .onConflictDoUpdate({
      target: [s.debtBalances.debtId, s.debtBalances.asOf],
      set: { balanceCents: body.balanceCents, createdAt: now.toISOString() },
    })
    .run()
}

export function removeBalance(db: Db, id: string, balanceId: string, viewerId: string): void {
  requireEditableDebt(db, id, viewerId)
  const where = and(eq(s.debtBalances.id, balanceId), eq(s.debtBalances.debtId, id))
  if (!db.select().from(s.debtBalances).where(where).get()) throw new BudgetError(404, 'Balance not found')
  const total =
    db.select({ n: count() }).from(s.debtBalances).where(eq(s.debtBalances.debtId, id)).get()?.n ?? 0
  if (total <= 1) throw new BudgetError(400, 'A debt needs at least one balance.')
  db.delete(s.debtBalances).where(where).run()
}

export function startingPoints(db: Db, debtId: string): StartingPoint[] {
  return db
    .select({ id: s.debtBalances.id, asOf: s.debtBalances.asOf, balanceCents: s.debtBalances.balanceCents })
    .from(s.debtBalances)
    .where(eq(s.debtBalances.debtId, debtId))
    .orderBy(asc(s.debtBalances.asOf))
    .all()
}

/** The rate history, oldest first. */
export function debtRates(db: Db, debtId: string): DebtRateDto[] {
  return db
    .select({ id: s.debtRates.id, fromDate: s.debtRates.fromDate, rateBp: s.debtRates.rateBp })
    .from(s.debtRates)
    .where(eq(s.debtRates.debtId, debtId))
    .orderBy(asc(s.debtRates.fromDate))
    .all()
}

/** Added to debt and Payment outside Up entries, by date then as entered. */
export function debtEntries(db: Db, debtId: string): LedgerInput['entries'] {
  return db
    .select({
      id: s.debtEntries.id,
      kind: s.debtEntries.kind,
      date: s.debtEntries.date,
      amountCents: s.debtEntries.amountCents,
      note: s.debtEntries.note,
    })
    .from(s.debtEntries)
    .where(eq(s.debtEntries.debtId, debtId))
    .orderBy(asc(s.debtEntries.date), asc(s.debtEntries.createdAt))
    .all()
}

/** Edited interest charges: charge date (the month's last day for daily charging) → cents. */
export function interestEdits(db: Db, debtId: string): Record<string, number> {
  const rows = db
    .select({ chargeDate: s.debtInterestEdits.chargeDate, amountCents: s.debtInterestEdits.amountCents })
    .from(s.debtInterestEdits)
    .where(eq(s.debtInterestEdits.debtId, debtId))
    .all()
  return Object.fromEntries(rows.map((r) => [r.chargeDate, r.amountCents]))
}

/** The debt's ledger to today, with what it was built from. */
export function debtLedgerFor(
  db: Db,
  debt: DebtRow,
  today: LocalDate,
  tz: string,
): { ledger: Ledger; points: StartingPoint[]; repayments: LedgerInput['repayments']; rates: DebtRateDto[] } {
  const points = startingPoints(db, debt.id)
  const rates = debtRates(db, debt.id)
  // Nothing marked: past repayments are estimated from the usual repayment.
  const repayments = tracksRepayments(db, debt.id) && points[0] ? matchedRepayments(db, debt, points[0].asOf, tz) : null
  const ledger = debtLedger(
    {
      settings: settingsOf(debt),
      rates,
      points,
      repayments,
      entries: debtEntries(db, debt.id),
      edits: interestEdits(db, debt.id),
      usual: { repaymentCents: debt.repaymentCents, repaymentFrequency: debt.repaymentFrequency },
      historyThrough: debt.historyThrough,
      fee: feeOf(debt),
    },
    today,
  )
  return { ledger, points, repayments, rates }
}

/** What's left on a debt today: its balance plus interest built up but not yet charged, each rounded as the Debts page shows them (never below 0). */
export function debtLeft(
  db: Db,
  debt: DebtRow,
  today: LocalDate,
  tz: string,
): { leftCents: number; days: TimelineDay[] } {
  const { ledger } = debtLedgerFor(db, debt, today, tz)
  const balance = ledger.days.at(-1)?.balance ?? 0
  return { leftCents: Math.max(0, Math.round(balance) + Math.round(ledger.accruing)), days: ledger.days }
}

/** The next due date after today: one step after the last matched repayment, else on the latest point's schedule. */
function upcomingDue(
  debt: DebtRow,
  points: StartingPoint[],
  repayments: Repayment[] | null,
  today: LocalDate,
) {
  const latest = points.filter((p) => p.asOf <= today).at(-1)!
  const lastPaid = repayments?.at(-1)?.date
  // Real repayments set the rhythm: monthly dues repeat on the day they're actually made.
  const base = lastPaid && lastPaid > latest.asOf ? lastPaid : latest.asOf
  const anchorDay = base === latest.asOf ? chargeDayFor(points, today) : dayOfMonth(base)
  let due = nextDue(
    base,
    debt.repaymentFrequency,
    anchorDay,
  )
  while (due <= today) due = nextDue(due, debt.repaymentFrequency, anchorDay)
  return { due, anchorDay }
}

/** The next due date after today; null for a debt with no starting point to count from. */
export function debtNextDue(db: Db, debt: DebtRow, today: LocalDate, tz: string): LocalDate | null {
  const { points, repayments } = debtLedgerFor(db, debt, today, tz)
  return points.some((p) => p.asOf <= today) ? upcomingDue(debt, points, repayments, today).due : null
}

const ownerName = (db: Db, debt: DebtRow) => (debt.ownerUserId ? displayName(db, debt.ownerUserId) : 'Joint')

export function toDebtDto(db: Db, debt: DebtRow, viewerId: string, today: LocalDate, tz: string): DebtDto {
  return assemble(db, debt, viewerId, today, tz).dto
}

function assemble(db: Db, debt: DebtRow, viewerId: string, today: LocalDate, tz: string) {
  const { ledger, points, repayments, rates } = debtLedgerFor(db, debt, today, tz)
  const balance = ledger.days.at(-1)?.balance ?? 0
  const { due, anchorDay } = upcomingDue(debt, points, repayments, today)
  const first = points[0]!
  const settings = settingsOf(debt)
  const projection = projectDebt(
    {
      settings,
      rates,
      usual: { repaymentCents: debt.repaymentCents, repaymentFrequency: debt.repaymentFrequency },
      fee: feeOf(debt),
    },
    { balance, accruing: ledger.accruing, today, nextDue: due, dueDay: anchorDay },
  )
  const dto: DebtDto = {
    id: debt.id,
    name: debt.name,
    kind: debt.kind,
    ownerUserId: debt.ownerUserId,
    ownerName: ownerName(db, debt),
    rateBp: rateOn(rates, today),
    interest: settings,
    repaymentCents: debt.repaymentCents,
    repaymentFrequency: debt.repaymentFrequency,
    fee: feeOf(debt),
    // A personal debt's rules are descriptions from its owner's transactions; a joint debt's are shared.
    repaymentRules:
      debt.ownerUserId === null || canSee(db, viewerId, debt.ownerUserId, 'transactions')
        ? repaymentRules(db, debt.id)
        : [],
    balanceCents: Math.round(balance),
    accruingCents: Math.round(ledger.accruing),
    nextChargeOn: ledger.nextChargeOn,
    firstBalance: { asOf: first.asOf, balanceCents: first.balanceCents },
    paidOffOn: ledger.paidOffOn,
    projection,
    estimated: ledger.estimated,
    canEdit: canEditDebt(debt, viewerId),
  }
  return { dto, ledger, points, rates }
}

/** `first`, then every 7 days back from `today` that falls after it, ending at today. Ascending. */
export function weeklyDates(first: LocalDate, today: LocalDate): LocalDate[] {
  const dates: LocalDate[] = []
  for (let d = today; d > first; d = addDays(d, -7)) dates.unshift(d)
  dates.unshift(first)
  return dates
}

/** Where a range starts, before it's held to the first balance. */
function rangeStart(range: Exclude<DebtRange, 'all'>, today: LocalDate): LocalDate {
  if (range === 'week') return addDays(today, -7)
  if (range === 'fy') return rangeSpan('fy', today, today).start
  return addMonthsClamped(today, range === 'month' ? -1 : -12, dayOfMonth(today))
}

/**
 * The debts' combined balance from the range's start (never before the earliest first balance) to today:
 * daily for a week or month, weekly otherwise. A debt adds 0 before its first balance.
 */
export function debtsTimeline(
  db: Db,
  debts: DebtRow[],
  today: LocalDate,
  tz: string,
  range: DebtRange = 'all',
): DebtBalancePoint[] {
  const ledgers = debts.map((debt) => debtLedgerFor(db, debt, today, tz))
  const firsts = ledgers.flatMap(({ points }) => (points[0] ? [points[0].asOf] : []))
  if (firsts.length === 0) return []
  const first = firsts.reduce((a, b) => (b < a ? b : a))
  const start = range === 'all' ? first : [rangeStart(range, today), first].reduce((a, b) => (b > a ? b : a))
  const dates: LocalDate[] = []
  if (range === 'week' || range === 'month') for (let d = start; d <= today; d = addDays(d, 1)) dates.push(d)
  else dates.push(...weeklyDates(start, today))
  const byDate = ledgers.map(({ ledger }) => new Map(ledger.days.map((d) => [d.date, d.balance])))
  return dates.map((date) => ({
    date,
    balanceCents: byDate.reduce((sum, m) => sum + Math.round(m.get(date) ?? 0), 0),
  }))
}

export function toDebtDetailDto(
  db: Db,
  debt: DebtRow,
  viewerId: string,
  today: LocalDate,
  tz: string,
): DebtDetailDto {
  const { dto, ledger, points, rates } = assemble(db, debt, viewerId, today, tz)
  const byDate = new Map(ledger.days.map((d) => [d.date, d.balance]))
  const dates = weeklyDates(points[0]!.asOf, today)
  // Repayments from an account the viewer can't see stay in the balance but not in the lists.
  const repaymentIds = ledger.activity.flatMap((a) => (a.kind === 'repayment' ? [a.transactionId] : []))
  const hidden = hiddenTransactionIds(db, viewerId, repaymentIds)
  return {
    ...dto,
    timeline: dates.map((date) => ({ date, balanceCents: Math.round(byDate.get(date) ?? 0) })),
    balances: points.map((p) => ({
      id: p.id,
      asOf: p.asOf,
      balanceCents: p.balanceCents,
      correctionCents: p.id in ledger.corrections ? Math.round(ledger.corrections[p.id]!) : null,
    })),
    rates,
    activity: [...ledger.activity].reverse().filter((a) => a.kind !== 'repayment' || !hidden.has(a.transactionId)),
    exclusions: listRepaymentExclusions(db, debt, viewerId, tz),
  }
}
