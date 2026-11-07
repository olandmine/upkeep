import { and, count, eq } from 'drizzle-orm'
import { editKey, isChargeDay } from '../../shared/debt-interest'
import type { DebtEntryInputDto } from '../../shared/types'
import type { LocalDate } from '../budgets/dates'
import { BudgetError } from '../budgets/errors'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { requireEditableDebt, settingsOf, startingPoints } from './debts'

const RATE = 'Rate must be between 0% and 100%.'

/** Adding a rate for a date that has one replaces it. */
export function addRate(
  db: Db,
  debtId: string,
  body: { fromDate: LocalDate; rateBp: number },
  viewerId: string,
  now: Date,
): void {
  const debt = requireEditableDebt(db, debtId, viewerId)
  if (!Number.isInteger(body.rateBp) || body.rateBp < 0 || body.rateBp > 10_000) throw new BudgetError(400, RATE)
  if (debt.kind === 'bnpl' && body.rateBp !== 0) throw new BudgetError(400, "BNPL debts don't charge interest.")
  db.insert(s.debtRates)
    .values({ id: crypto.randomUUID(), debtId, ...body, createdAt: now.toISOString() })
    .onConflictDoUpdate({
      target: [s.debtRates.debtId, s.debtRates.fromDate],
      set: { rateBp: body.rateBp, createdAt: now.toISOString() },
    })
    .run()
}

export function removeRate(db: Db, debtId: string, rateId: string, viewerId: string): void {
  requireEditableDebt(db, debtId, viewerId)
  const where = and(eq(s.debtRates.id, rateId), eq(s.debtRates.debtId, debtId))
  if (!db.select().from(s.debtRates).where(where).get()) throw new BudgetError(404, 'Rate not found')
  const total = db.select({ n: count() }).from(s.debtRates).where(eq(s.debtRates.debtId, debtId)).get()?.n ?? 0
  if (total <= 1) throw new BudgetError(400, 'A debt needs at least one rate.')
  db.delete(s.debtRates).where(where).run()
}

function checkEntry(db: Db, debtId: string, body: DebtEntryInputDto, today: LocalDate) {
  if (body.date > today) throw new BudgetError(400, "Entry date can't be in the future.")
  // A balance is that day's closing figure, so the first one already counts anything dated on or before it.
  const first = startingPoints(db, debtId)[0]
  if (first && body.date <= first.asOf) throw new BudgetError(400, 'Entry date must be after the first balance.')
  if (!Number.isInteger(body.amountCents) || body.amountCents <= 0)
    throw new BudgetError(400, 'Amount must be more than $0.')
  const note = body.note?.trim() || null
  if (note && note.length > 100) throw new BudgetError(400, 'Keep the note under 100 characters.')
  return note
}

export function addEntry(
  db: Db,
  debtId: string,
  body: DebtEntryInputDto,
  viewerId: string,
  now: Date,
  today: LocalDate,
): void {
  requireEditableDebt(db, debtId, viewerId)
  const note = checkEntry(db, debtId, body, today)
  const stamp = now.toISOString()
  db.insert(s.debtEntries)
    .values({ id: crypto.randomUUID(), debtId, ...body, note, createdAt: stamp, updatedAt: stamp })
    .run()
}

function requireEntry(db: Db, debtId: string, entryId: string) {
  const where = and(eq(s.debtEntries.id, entryId), eq(s.debtEntries.debtId, debtId))
  if (!db.select().from(s.debtEntries).where(where).get()) throw new BudgetError(404, 'Entry not found')
  return where
}

export function updateEntry(
  db: Db,
  debtId: string,
  entryId: string,
  body: DebtEntryInputDto,
  viewerId: string,
  now: Date,
  today: LocalDate,
): void {
  requireEditableDebt(db, debtId, viewerId)
  const where = requireEntry(db, debtId, entryId)
  const note = checkEntry(db, debtId, body, today)
  db.update(s.debtEntries)
    .set({ ...body, note, updatedAt: now.toISOString() })
    .where(where)
    .run()
}

export function deleteEntry(db: Db, debtId: string, entryId: string, viewerId: string): void {
  requireEditableDebt(db, debtId, viewerId)
  db.delete(s.debtEntries).where(requireEntry(db, debtId, entryId)).run()
}

/**
 * Sets an interest charge to what the lender charged. The date must be a charge date under the debt's
 * settings (for daily charging, a month's last day), no earlier than the first balance and not in the future.
 */
export function setInterestEdit(
  db: Db,
  debtId: string,
  chargeDate: LocalDate,
  amountCents: number,
  viewerId: string,
  today: LocalDate,
): void {
  const debt = requireEditableDebt(db, debtId, viewerId)
  const settings = settingsOf(debt)
  const first = startingPoints(db, debtId)[0]
  const valid =
    isChargeDay(settings, chargeDate) &&
    editKey(settings, chargeDate) === chargeDate &&
    (!first || chargeDate > first.asOf) &&
    chargeDate <= today
  if (!valid) throw new BudgetError(400, `That isn't one of ${debt.name}'s interest charges.`)
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new BudgetError(400, "Interest can't be negative.")
  db.insert(s.debtInterestEdits)
    .values({ debtId, chargeDate, amountCents })
    .onConflictDoUpdate({ target: [s.debtInterestEdits.debtId, s.debtInterestEdits.chargeDate], set: { amountCents } })
    .run()
}

/** Back to the calculated amount. */
export function clearInterestEdit(db: Db, debtId: string, chargeDate: LocalDate, viewerId: string): void {
  requireEditableDebt(db, debtId, viewerId)
  db.delete(s.debtInterestEdits)
    .where(and(eq(s.debtInterestEdits.debtId, debtId), eq(s.debtInterestEdits.chargeDate, chargeDate)))
    .run()
}
