import { count, eq } from 'drizzle-orm'
import { interestDefaults } from '../../shared/debt-interest'
import type { HelpDebtInputDto, HelpImportSummaryDto } from '../../shared/types'
import type { LocalDate } from '../budgets/dates'
import { BudgetError } from '../budgets/errors'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { DebtRow } from '../db/schema'
import { checkOwner, debtRates, getDebt, interestColumns, requireEditableDebt } from './debts'
import { parseHelpStatement, planHelpImport } from './help-statement'
import { debtLedger, rateOn } from './ledger'

const tally = (
  db: Db,
  table: typeof s.debtBalances | typeof s.debtRates | typeof s.debtEntries | typeof s.debtInterestEdits,
  debtId: string,
) => db.select({ n: count() }).from(table).where(eq(table.debtId, debtId)).get()?.n ?? 0

const NOTHING = { balances: 0, rates: 0, entries: 0, edits: 0 }

/** Reads a statement and works out what it writes; `fallbackRate` gives the rate when it has no indexation. */
function prepare(csv: string, today: LocalDate, fallbackRate: (closing: LocalDate) => number) {
  const rows = parseHelpStatement(csv)
  if (rows.some((r) => r.processed > today || r.effective > today)) {
    throw new BudgetError(400, 'That statement has dates after today.')
  }
  const plan = planHelpImport(rows)

  const settings = interestDefaults('hecs', plan.start)
  const rates = plan.rates.length > 0 ? plan.rates : [{ fromDate: plan.start, rateBp: fallbackRate(plan.closing.asOf) }]
  const ids = { start: crypto.randomUUID(), closing: crypto.randomUUID() }
  const points = [
    { id: ids.start, asOf: plan.start, balanceCents: 0 },
    // Only a statement processed before its own effective dates could close on or before the start.
    ...(plan.closing.asOf > plan.start ? [{ id: ids.closing, ...plan.closing }] : []),
  ]
  const entries = plan.entries.map((e) => ({ ...e, id: crypto.randomUUID() }))

  const replay = debtLedger(
    {
      settings,
      rates: rates.map((r) => ({ ...r, id: r.fromDate })),
      points: points.slice(0, 1),
      repayments: [],
      entries,
      edits: plan.edits,
      usual: { repaymentCents: 0, repaymentFrequency: 'monthly' },
    },
    plan.closing.asOf,
  )
  const sum = (kind: 'added' | 'payment') => {
    const of = plan.entries.filter((e) => e.kind === kind)
    return { count: of.length, cents: of.reduce((n, e) => n + e.amountCents, 0) }
  }
  const summary: HelpImportSummaryDto = {
    rows: rows.length,
    from: rows.reduce((min, r) => (r.effective < min ? r.effective : min), rows[0]!.effective),
    to: plan.closing.asOf,
    added: sum('added'),
    credits: sum('payment'),
    indexationYears: Object.values(plan.edits).filter((c) => c > 0).length,
    closingCents: plan.closing.balanceCents,
    replayCents: Math.round(replay.days.at(-1)?.balance ?? 0),
    replaces: NOTHING,
  }
  return { plan, settings, rates, points, entries, summary }
}

type Prepared = ReturnType<typeof prepare>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Replaces the debt's balances, rates, entries and interest edits with the statement's. */
function write(t: Tx, debtId: string, { plan, settings, rates, points, entries }: Prepared, stamp: string) {
  for (const table of [s.debtBalances, s.debtRates, s.debtEntries, s.debtInterestEdits]) {
    t.delete(table).where(eq(table.debtId, debtId)).run()
  }
  t.update(s.debts)
    .set({ ...interestColumns(settings), historyThrough: plan.closing.asOf, updatedAt: stamp })
    .where(eq(s.debts.id, debtId))
    .run()
  t.insert(s.debtBalances)
    .values(points.map((p) => ({ ...p, debtId, createdAt: stamp })))
    .run()
  t.insert(s.debtRates)
    .values(rates.map((r) => ({ ...r, id: crypto.randomUUID(), debtId, createdAt: stamp })))
    .run()
  if (entries.length > 0) {
    t.insert(s.debtEntries)
      .values(entries.map((e) => ({ ...e, debtId, createdAt: stamp, updatedAt: stamp })))
      .run()
  }
  const edits = Object.entries(plan.edits)
  if (edits.length > 0) {
    t.insert(s.debtInterestEdits)
      .values(edits.map(([chargeDate, amountCents]) => ({ debtId, chargeDate, amountCents })))
      .run()
  }
}

/**
 * Previews or imports an ATO HELP statement. An import replaces the debt's
 * balances, rates, entries and interest edits in one transaction; repayment rules and exclusions stay.
 */
export function importHelpStatement(
  db: Db,
  debtId: string,
  csv: string,
  dryRun: boolean,
  viewerId: string,
  now: Date,
  today: LocalDate,
): HelpImportSummaryDto {
  const debt = requireEditableDebt(db, debtId, viewerId)
  if (debt.kind !== 'hecs') throw new BudgetError(400, 'Only HECS debts can import an ATO HELP statement.')
  // No indexation on the statement: keep the debt's current rate, from the start.
  const prepared = prepare(csv, today, (closing) => rateOn(debtRates(db, debtId), closing))
  const summary = {
    ...prepared.summary,
    replaces: {
      balances: tally(db, s.debtBalances, debtId),
      rates: tally(db, s.debtRates, debtId),
      entries: tally(db, s.debtEntries, debtId),
      edits: tally(db, s.debtInterestEdits, debtId),
    },
  }
  if (dryRun) return summary
  db.transaction((t) => write(t, debtId, prepared, now.toISOString()))
  return summary
}

/** Previews a statement for a HECS debt not yet added. */
export function previewHelpStatement(csv: string, today: LocalDate): HelpImportSummaryDto {
  return prepare(csv, today, () => 0).summary
}

/** Adds a HECS debt whose history is the statement's, in one transaction. */
export function createHelpDebt(
  db: Db,
  { csv, ...input }: HelpDebtInputDto,
  viewerId: string,
  now: Date,
  today: LocalDate,
): DebtRow {
  checkOwner(db, input.ownerUserId, viewerId)
  const prepared = prepare(csv, today, () => input.rateBp)
  const stamp = now.toISOString()
  const id = crypto.randomUUID()
  db.transaction((t) => {
    t.insert(s.debts)
      .values({
        id,
        ownerUserId: input.ownerUserId,
        kind: 'hecs',
        name: input.name,
        ...interestColumns(prepared.settings),
        repaymentCents: input.repaymentCents,
        repaymentFrequency: input.repaymentFrequency,
        createdByUserId: viewerId,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run()
    write(t, id, prepared, stamp)
  })
  return getDebt(db, id)
}
