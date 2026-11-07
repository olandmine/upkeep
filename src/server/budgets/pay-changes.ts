import { and, eq } from 'drizzle-orm'
import type { PayChangesInput, PlanItemInput } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { BudgetLineRow, BudgetRow } from '../db/schema'
import { findPeriod, getBudget, listBudgetRows } from './budgets'
import { todayLocal, type LocalDate } from './dates'
import { BudgetError } from './errors'
import {
  activeLines,
  assertNoCategoryOverlap,
  ensurePeriodSnapshot,
  insertLine,
  markLineArchived,
  patchedLine,
  requireActiveLine,
  requireEditor,
  requireLine,
  validateLine,
  writeLine,
  writeSnapshot,
} from './lines'
import { applyPlanChanges } from './plans'

const setLineAmount = (db: Db, lineId: string, amountCents: number) =>
  db.update(s.budgetLines).set({ amountCents }).where(eq(s.budgetLines.id, lineId)).run()

/** lineId → snapshot amount, for lines whose snapshot in this period differs from their template amount. */
function periodOneOffs(db: Db, budgetId: string, periodStart: LocalDate): Map<string, number> {
  const out = new Map<string, number>()
  const templateAmounts = new Map(activeLines(db, budgetId).map((l) => [l.id, l.amountCents]))
  for (const snap of ensurePeriodSnapshot(db, budgetId, periodStart)) {
    const templateAmount = templateAmounts.get(snap.lineId)
    if (templateAmount !== undefined && templateAmount !== snap.amountCents) {
      out.set(snap.lineId, snap.amountCents)
    }
  }
  return out
}

function setSnapshotAmount(db: Db, line: BudgetLineRow, amountCents: number, today: LocalDate) {
  const period = findPeriod(db, getBudget(db, line.budgetId), today)
  const written = period
    ? db
        .update(s.periodLines)
        .set({ amountCents })
        .where(
          and(
            eq(s.periodLines.budgetId, line.budgetId),
            eq(s.periodLines.periodStart, period.start),
            eq(s.periodLines.lineId, line.id),
          ),
        )
        .run().changes
    : 0
  if (written === 0) throw new BudgetError(400, `${line.name} isn't in this pay's period.`)
}

/**
 * Applies a whole Edit-mode draft: all of it, or none of it. Amounts land in each budget's period
 * running today, which for Joint can be a later period than the one this pay began in.
 */
export function applyPayChanges(db: Db, userId: string, input: PayChangesInput, now: Date, tz: string): void {
  const today = todayLocal(now, tz)
  const everyPay = input.applyTo === 'every-pay'
  const { create, update, archive } = input.lines

  db.transaction(() => {
    const budgets = listBudgetRows(db)
    const mine = budgets.find((b) => b.ownerUserId === userId)
    const joint = budgets.find((b) => b.kind === 'joint')

    // 1. Is this request still about the current pay, and can it apply this way?
    if (!mine || findPeriod(db, mine, today)?.start !== input.payDate) {
      throw new BudgetError(400, 'A new pay has arrived. Check your changes and try again.')
    }
    const structural = create.length + update.length + archive.length + input.savers.remove.length > 0
    if (!everyPay && structural) {
      throw new BudgetError(400, 'Adding, removing or renaming applies to every pay.')
    }
    const invalidLimit = input.limits.some((l) => !Number.isInteger(l.amountCents) || l.amountCents < 0)
    if (invalidLimit) throw new BudgetError(400, 'Amount must be $0 or more.')

    const budgetFor = (budget: 'personal' | 'joint') => {
      if (budget === 'personal') return mine
      if (!joint) throw new BudgetError(404, 'Budget not found')
      return joint
    }

    // 2. May the viewer edit every budget this touches?
    const touched = new Map<string, BudgetRow>()
    if (input.savers.set.length > 0) touched.set(mine.id, mine)
    for (const { budget } of create) touched.set(budgetFor(budget).id, budgetFor(budget))
    const editedLineIds = [...input.limits.map((l) => l.lineId), ...update.map((u) => u.lineId), ...archive]
    for (const lineId of editedLineIds) {
      const budgetId = requireLine(db, lineId).budgetId
      touched.set(budgetId, getBudget(db, budgetId))
    }
    for (const b of touched.values()) requireEditor(db, b, userId)

    // 3. Which amounts are one-offs in the period running today, before anything changes them?
    const periods = [...touched.values()].flatMap((b) => {
      const start = findPeriod(db, b, today)?.start
      return start ? [{ budgetId: b.id, start, oneOffs: periodOneOffs(db, b.id, start) }] : []
    })

    // 4. Line writes. Lines whose amount this request sets lose any one-off, and may need a plan item.
    const newAmounts = new Map<string, number>()
    for (const lineId of archive) {
      requireActiveLine(db, lineId)
      markLineArchived(db, lineId, now)
    }
    for (const { lineId, ...patch } of update) {
      const line = requireActiveLine(db, lineId)
      const next = patchedLine(db, line, patch)
      validateLine(db, getBudget(db, line.budgetId), next, lineId, { skipOverlap: true })
      writeLine(db, lineId, next, patch)
      if (patch.amountCents !== undefined) newAmounts.set(lineId, patch.amountCents)
    }
    for (const { budget, ...fields } of create) {
      const b = budgetFor(budget)
      validateLine(db, b, fields, null, { skipOverlap: true })
      newAmounts.set(insertLine(db, b.id, fields, now), fields.amountCents)
    }

    // 5. Limits: the line for every pay, the period's snapshot for this one.
    for (const { lineId, amountCents } of input.limits) {
      const line = requireActiveLine(db, lineId)
      if (everyPay) setLineAmount(db, lineId, amountCents)
      else setSnapshotAmount(db, line, amountCents, today)
      newAmounts.set(lineId, amountCents)
    }

    // 6. The plan, then the personal fund lines that follow it. A joint line's amount is a separate shared figure.
    const myLines = activeLines(db, mine.id)
    const plannable = [...myLines, ...(joint ? activeLines(db, joint.id) : [])]
    const planSet: PlanItemInput[] = input.savers.set.map(({ saverAccountId, amountCents }) => {
      const linked = plannable.find((l) => l.saverAccountId === saverAccountId)
      return linked
        ? { targetKind: 'line', lineId: linked.id, saverAccountId: null, amountCents }
        : { targetKind: 'saver', lineId: null, saverAccountId, amountCents }
    })
    for (const [lineId, amountCents] of newAmounts) {
      const line = myLines.find((l) => l.id === lineId)
      if (line?.kind === 'spending' && !line.saverAccountId) {
        planSet.push({ targetKind: 'line', lineId, saverAccountId: null, amountCents })
      }
    }
    applyPlanChanges(
      db,
      userId,
      input.payDate,
      { set: planSet, remove: input.savers.remove },
      input.applyTo,
      now,
      tz,
    )
    if (everyPay) {
      for (const { saverAccountId, amountCents } of input.savers.set) {
        const fund = myLines.find((l) => l.kind === 'fund' && l.saverAccountId === saverAccountId)
        if (fund) {
          setLineAmount(db, fund.id, amountCents)
          newAmounts.set(fund.id, amountCents)
        }
      }
    }

    // 7. Only now are the lines final, so a category swapped between two lines doesn't clash with itself.
    for (const b of touched.values()) assertNoCategoryOverlap(db, b.id)

    // 8. Rewrite those periods from the template, keeping one-offs on lines this request didn't set. No other period changes.
    if (everyPay) {
      for (const { budgetId, start, oneOffs } of periods) {
        const keep = new Map([...oneOffs].filter(([lineId]) => !newAmounts.has(lineId)))
        writeSnapshot(db, budgetId, start, keep)
      }
    }
  })
}
