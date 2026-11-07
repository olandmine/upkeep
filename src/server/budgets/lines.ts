import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm'
import { categoryColorToken } from '../../shared/categories'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { BudgetLineRow, BudgetRow } from '../db/schema'
import { canEditBudget, findPeriod, getBudget } from './budgets'
import { todayLocal, type LocalDate } from './dates'
import { BudgetError } from './errors'
import { canSee } from '../sharing/policy'

export interface LineInput {
  kind: 'spending' | 'fund'
  name: string
  amountCents: number
  categoryIds: string[]
  saverAccountId: string | null
}

export type ActiveLine = BudgetLineRow & { categoryIds: string[] }

/** Someone who can't see a budget gets the same answer as for one that doesn't exist. */
export function requireEditor(db: Db, b: BudgetRow, userId: string) {
  if (!canSee(db, userId, b.ownerUserId, 'finances')) throw new BudgetError(404, 'Budget not found')
  if (canEditBudget(db, b, userId)) return
  const owner = db
    .select({ name: s.users.displayName })
    .from(s.users)
    .where(eq(s.users.id, b.ownerUserId ?? ''))
    .get()
  throw new BudgetError(403, `Only ${owner?.name ?? 'the owner'} can edit their budget.`)
}

function lineCategoryIds(db: Db, lineIds: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>(lineIds.map((id) => [id, []]))
  if (lineIds.length === 0) return out
  for (const r of db
    .select()
    .from(s.budgetLineCategories)
    .where(inArray(s.budgetLineCategories.lineId, lineIds))
    .all()) {
    out.get(r.lineId)!.push(r.categoryId)
  }
  for (const ids of out.values()) ids.sort()
  return out
}

export function activeLines(db: Db, budgetId: string): ActiveLine[] {
  const rows = db
    .select()
    .from(s.budgetLines)
    .where(and(eq(s.budgetLines.budgetId, budgetId), isNull(s.budgetLines.archivedAt)))
    .orderBy(asc(s.budgetLines.sortOrder), asc(s.budgetLines.createdAt))
    .all()
  const cats = lineCategoryIds(
    db,
    rows.map((r) => r.id),
  )
  return rows.map((r) => ({ ...r, categoryIds: cats.get(r.id) ?? [] }))
}

/** A line's colour: its first category's parent colour, as on Budgets. */
export function lineColorToken(db: Db, categoryIds: string[]): string {
  const categories = db.select({ id: s.categories.id, parentId: s.categories.parentId }).from(s.categories).all()
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]))
  const parentIds = categories.filter((c) => c.parentId === null).map((c) => c.id)
  const first = [...categoryIds].sort()[0] ?? null
  return categoryColorToken(first ? (parentOf.get(first) ?? first) : null, parentIds)
}

/** A set of category ids plus the children of any parents in it. */
export function expandCategories(db: Db, ids: string[]): Set<string> {
  const out = new Set(ids)
  if (ids.length === 0) return out
  for (const c of db
    .select({ id: s.categories.id })
    .from(s.categories)
    .where(inArray(s.categories.parentId, ids))
    .all()) {
    out.add(c.id)
  }
  return out
}

const categoryNames = (db: Db) =>
  new Map(
    db
      .select({ id: s.categories.id, name: s.categories.name })
      .from(s.categories)
      .all()
      .map((c) => [c.id, c.name]),
  )

function assertNoClash(db: Db, names: Map<string, string>, categoryIds: string[], others: ActiveLine[]) {
  const mine = expandCategories(db, categoryIds)
  for (const other of others) {
    const clash = [...expandCategories(db, other.categoryIds)].find((id) => mine.has(id))
    if (clash) throw new BudgetError(400, `${names.get(clash)} is already in ${other.name}`)
  }
}

/** Checks every pair of active lines, once a batch of writes has made the budget's lines final. */
export function assertNoCategoryOverlap(db: Db, budgetId: string) {
  const names = categoryNames(db)
  const lines = activeLines(db, budgetId)
  lines.forEach((line, i) => assertNoClash(db, names, line.categoryIds, lines.slice(0, i)))
}

export function validateLine(
  db: Db,
  b: BudgetRow,
  input: LineInput,
  selfId: string | null,
  { skipOverlap }: { skipOverlap: boolean },
) {
  if (!input.name.trim()) throw new BudgetError(400, 'Give the bucket a name.')
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0)
    throw new BudgetError(400, 'Amount must be $0 or more.')
  if (input.kind === 'fund' && !input.saverAccountId) throw new BudgetError(400, 'A fund line needs a Saver.')
  if (input.kind === 'spending' && input.categoryIds.length === 0) {
    throw new BudgetError(400, 'Pick at least one category.')
  }

  const names = categoryNames(db)
  const unknown = input.categoryIds.find((id) => !names.has(id))
  if (unknown) throw new BudgetError(400, `Unknown category ${unknown}`)

  if (!skipOverlap) {
    const others = activeLines(db, b.id).filter((other) => other.id !== selfId)
    assertNoClash(db, names, input.categoryIds, others)
  }

  if (input.saverAccountId) {
    const saver = db.select().from(s.accounts).where(eq(s.accounts.id, input.saverAccountId)).get()
    const allowed =
      saver?.accountType === 'SAVER' &&
      (b.kind === 'joint'
        ? saver.ownership === 'JOINT'
        : saver.ownership === 'INDIVIDUAL' && saver.ownerUserId === b.ownerUserId)
    if (!allowed) throw new BudgetError(400, "That Saver can't be linked to this budget.")
    const linked = db
      .select({ id: s.budgetLines.id, name: s.budgetLines.name })
      .from(s.budgetLines)
      .where(and(eq(s.budgetLines.saverAccountId, input.saverAccountId), isNull(s.budgetLines.archivedAt)))
      .all()
      .find((l) => l.id !== selfId)
    if (linked) throw new BudgetError(400, `${saver.displayName} is already linked to ${linked.name}`)
  }
}

function writeCategories(db: Db, lineId: string, categoryIds: string[]) {
  db.delete(s.budgetLineCategories).where(eq(s.budgetLineCategories.lineId, lineId)).run()
  if (categoryIds.length > 0) {
    db.insert(s.budgetLineCategories)
      .values([...new Set(categoryIds)].map((categoryId) => ({ lineId, categoryId })))
      .run()
  }
}

/** Rewrites a period's snapshot from the template. `keep` holds lineId → one-off amounts to leave as they are. */
export function writeSnapshot(db: Db, budgetId: string, periodStart: LocalDate, keep?: Map<string, number>) {
  db.delete(s.periodLines)
    .where(and(eq(s.periodLines.budgetId, budgetId), eq(s.periodLines.periodStart, periodStart)))
    .run()
  const lines = activeLines(db, budgetId)
  if (lines.length > 0) {
    db.insert(s.periodLines)
      .values(
        lines.map((l, i) => ({
          budgetId,
          periodStart,
          lineId: l.id,
          amountCents: keep?.get(l.id) ?? l.amountCents,
          sortOrder: i,
        })),
      )
      .run()
    const categories = lines.flatMap((l) => l.categoryIds.map((categoryId) => ({ budgetId, periodStart, lineId: l.id, categoryId })))
    if (categories.length > 0) db.insert(s.periodLineCategories).values(categories).run()
  }
}

/** lineId → the categories that line had when this period's snapshot was taken. */
export function snapshotCategories(db: Db, budgetId: string, periodStart: LocalDate): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const rows = db
    .select()
    .from(s.periodLineCategories)
    .where(and(eq(s.periodLineCategories.budgetId, budgetId), eq(s.periodLineCategories.periodStart, periodStart)))
    .all()
  for (const r of rows) out.set(r.lineId, [...(out.get(r.lineId) ?? []), r.categoryId])
  for (const ids of out.values()) ids.sort()
  return out
}

/** Template edits apply to the current period's snapshot (and future periods, which snapshot on first view). */
function syncCurrentSnapshot(db: Db, b: BudgetRow, now: Date, tz: string) {
  const period = findPeriod(db, b, todayLocal(now, tz))
  if (period) writeSnapshot(db, b.id, period.start)
}

/** The period's lines and amounts, copied from the active template the first time it is asked for. */
export function ensurePeriodSnapshot(
  db: Db,
  budgetId: string,
  periodStart: LocalDate,
): { lineId: string; amountCents: number; sortOrder: number }[] {
  const read = () =>
    db
      .select({
        lineId: s.periodLines.lineId,
        amountCents: s.periodLines.amountCents,
        sortOrder: s.periodLines.sortOrder,
      })
      .from(s.periodLines)
      .where(and(eq(s.periodLines.budgetId, budgetId), eq(s.periodLines.periodStart, periodStart)))
      .orderBy(asc(s.periodLines.sortOrder))
      .all()
  const existing = read()
  if (existing.length > 0) return existing
  writeSnapshot(db, budgetId, periodStart)
  return read()
}

export function requireLine(db: Db, lineId: string): BudgetLineRow {
  const line = db.select().from(s.budgetLines).where(eq(s.budgetLines.id, lineId)).get()
  if (!line) throw new BudgetError(404, 'Line not found')
  return line
}

/** Like requireActiveLine, but a line in a budget the user can't see is "not found", archived or not. */
function requireVisibleActiveLine(db: Db, lineId: string, userId: string): BudgetLineRow {
  const line = requireLine(db, lineId)
  if (!canSee(db, userId, getBudget(db, line.budgetId).ownerUserId, 'finances')) {
    throw new BudgetError(404, 'Line not found')
  }
  return requireActiveLine(db, lineId)
}

/** Archived lines stay in past snapshots but can no longer change. */
export function requireActiveLine(db: Db, lineId: string): BudgetLineRow {
  const line = requireLine(db, lineId)
  if (line.archivedAt) throw new BudgetError(400, 'That bucket has been removed.')
  return line
}

/** Writes a validated new line. The caller runs it in a transaction and updates the snapshot. */
export function insertLine(db: Db, budgetId: string, input: LineInput, now: Date): string {
  const id = randomUUID()
  const last = db
    .select({ n: max(s.budgetLines.sortOrder) })
    .from(s.budgetLines)
    .where(eq(s.budgetLines.budgetId, budgetId))
    .get()
  db.insert(s.budgetLines)
    .values({
      id,
      budgetId,
      kind: input.kind,
      name: input.name.trim(),
      amountCents: input.amountCents,
      saverAccountId: input.saverAccountId,
      sortOrder: (last?.n ?? -1) + 1,
      createdAt: now.toISOString(),
    })
    .run()
  writeCategories(db, id, input.categoryIds)
  return id
}

/** A line's fields with `patch` over them, ready to validate. */
export function patchedLine(db: Db, line: BudgetLineRow, patch: Partial<LineInput>): LineInput {
  const current: LineInput = {
    kind: line.kind,
    name: line.name,
    amountCents: line.amountCents,
    categoryIds: lineCategoryIds(db, [line.id]).get(line.id) ?? [],
    saverAccountId: line.saverAccountId,
  }
  return { ...current, ...patch }
}

/** Writes a validated line. The caller runs it in a transaction and updates the snapshot. */
export function writeLine(db: Db, lineId: string, next: LineInput, patch: Partial<LineInput>) {
  db.update(s.budgetLines)
    .set({
      kind: next.kind,
      name: next.name.trim(),
      amountCents: next.amountCents,
      saverAccountId: next.saverAccountId,
    })
    .where(eq(s.budgetLines.id, lineId))
    .run()
  if (patch.categoryIds) writeCategories(db, lineId, next.categoryIds)
}

/** The caller runs it in a transaction and updates the snapshot. */
export function markLineArchived(db: Db, lineId: string, now: Date) {
  db.update(s.budgetLines).set({ archivedAt: now.toISOString() }).where(eq(s.budgetLines.id, lineId)).run()
}

export function createLine(
  db: Db,
  budgetId: string,
  userId: string,
  input: LineInput,
  now: Date,
  tz: string,
): BudgetLineRow {
  const b = getBudget(db, budgetId)
  requireEditor(db, b, userId)
  validateLine(db, b, input, null, { skipOverlap: false })
  const id = db.transaction(() => {
    const created = insertLine(db, budgetId, input, now)
    syncCurrentSnapshot(db, b, now, tz)
    return created
  })
  return requireLine(db, id)
}

export function updateLine(
  db: Db,
  lineId: string,
  userId: string,
  patch: Partial<LineInput>,
  now: Date,
  tz: string,
): BudgetLineRow {
  const line = requireVisibleActiveLine(db, lineId, userId)
  const b = getBudget(db, line.budgetId)
  requireEditor(db, b, userId)
  const next = patchedLine(db, line, patch)
  validateLine(db, b, next, lineId, { skipOverlap: false })
  db.transaction(() => {
    writeLine(db, lineId, next, patch)
    syncCurrentSnapshot(db, b, now, tz)
  })
  return requireLine(db, lineId)
}

export function archiveLine(db: Db, lineId: string, userId: string, now: Date, tz: string): void {
  const line = requireVisibleActiveLine(db, lineId, userId)
  const b = getBudget(db, line.budgetId)
  requireEditor(db, b, userId)
  db.transaction(() => {
    markLineArchived(db, lineId, now)
    syncCurrentSnapshot(db, b, now, tz)
  })
}
