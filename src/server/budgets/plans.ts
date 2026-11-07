import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import type { PayChangesInput, PayPlanDto, PlanItemDto, PlanItemInput, PlanTemplateDto } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { periodRangeUtc, todayLocal, type LocalDate } from './dates'
import { BudgetError } from './errors'

const BUFFER_NAME = 'Leave in Spending'
const PROPOSAL_WINDOW_MS = 24 * 3_600_000
const notRoundUp = sql`coalesce(${s.transactions.transactionType}, '') <> 'Round Up'`

type StoredItem = PlanItemInput & { id: string }

const toInput = (r: StoredItem): StoredItem => ({
  id: r.id,
  targetKind: r.targetKind,
  lineId: r.lineId,
  saverAccountId: r.saverAccountId,
  amountCents: r.amountCents,
})

/** Budget ids whose lines a user may plan for: their personal budget and Joint. */
function plannableBudgetIds(db: Db, userId: string): string[] {
  return db
    .select({ id: s.budgets.id, kind: s.budgets.kind, owner: s.budgets.ownerUserId })
    .from(s.budgets)
    .all()
    .filter((b) => b.kind === 'joint' || b.owner === userId)
    .map((b) => b.id)
}

function individualAccountIds(db: Db, userId: string): string[] {
  return db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(and(eq(s.accounts.ownerUserId, userId), eq(s.accounts.ownership, 'INDIVIDUAL')))
    .all()
    .map((r) => r.id)
}

interface Resolved {
  targetName: string
  resolvedSaverId: string | null
}

function resolver(db: Db) {
  const lines = new Map(
    db
      .select()
      .from(s.budgetLines)
      .all()
      .map((l) => [l.id, l]),
  )
  const accounts = new Map(
    db
      .select()
      .from(s.accounts)
      .all()
      .map((a) => [a.id, a]),
  )
  return {
    lines,
    accounts,
    resolve(item: PlanItemInput): Resolved {
      if (item.targetKind === 'buffer') return { targetName: BUFFER_NAME, resolvedSaverId: null }
      if (item.targetKind === 'line') {
        const line = item.lineId ? lines.get(item.lineId) : undefined
        return { targetName: line?.name ?? 'Line not found', resolvedSaverId: line?.saverAccountId ?? null }
      }
      const saver = item.saverAccountId ? accounts.get(item.saverAccountId) : undefined
      return { targetName: saver?.displayName ?? 'Saver not found', resolvedSaverId: item.saverAccountId }
    },
  }
}

function validate(db: Db, userId: string, items: PlanItemInput[]) {
  const r = resolver(db)
  const budgets = new Set(plannableBudgetIds(db, userId))
  const seenSavers = new Set<string>()
  if (items.filter((i) => i.targetKind === 'buffer').length > 1) {
    throw new BudgetError(400, `Only one "${BUFFER_NAME}" item per plan.`)
  }
  for (const item of items) {
    if (!Number.isInteger(item.amountCents) || item.amountCents < 0)
      throw new BudgetError(400, 'Amounts must be $0 or more.')
    if (item.targetKind === 'line') {
      const line = item.lineId ? r.lines.get(item.lineId) : undefined
      if (!line || line.archivedAt || !budgets.has(line.budgetId)) {
        throw new BudgetError(400, "That bucket isn't in your budget or Joint.")
      }
    }
    if (item.targetKind === 'saver') {
      const saver = item.saverAccountId ? r.accounts.get(item.saverAccountId) : undefined
      const ok =
        saver?.accountType === 'SAVER' &&
        (saver.ownership === 'JOINT' || (saver.ownership === 'INDIVIDUAL' && saver.ownerUserId === userId))
      if (!ok) throw new BudgetError(400, "That Saver isn't yours or joint.")
    }
    const saverId = r.resolve(item).resolvedSaverId
    if (saverId) {
      if (seenSavers.has(saverId)) {
        throw new BudgetError(
          400,
          `${r.accounts.get(saverId)?.displayName ?? 'A Saver'} is in more than one bucket.`,
        )
      }
      seenSavers.add(saverId)
    }
  }
}

const itemRows = (items: PlanItemInput[]) =>
  items.map((i, sortOrder) => ({
    id: randomUUID(),
    targetKind: i.targetKind,
    lineId: i.targetKind === 'line' ? i.lineId : null,
    saverAccountId: i.targetKind === 'saver' ? i.saverAccountId : null,
    amountCents: i.amountCents,
    sortOrder,
  }))

function templateItems(db: Db, userId: string): StoredItem[] {
  return db
    .select()
    .from(s.planTemplateItems)
    .where(eq(s.planTemplateItems.userId, userId))
    .orderBy(asc(s.planTemplateItems.sortOrder))
    .all()
    .map(toInput)
}

function payPlanItems(db: Db, userId: string, payDate: LocalDate): StoredItem[] {
  return db
    .select()
    .from(s.payPlanItems)
    .where(and(eq(s.payPlanItems.userId, userId), eq(s.payPlanItems.payDate, payDate)))
    .orderBy(asc(s.payPlanItems.sortOrder))
    .all()
    .map(toInput)
}

function writePayPlan(
  db: Db,
  userId: string,
  payDate: LocalDate,
  items: PlanItemInput[],
  customised: boolean,
) {
  db.transaction(() => {
    db.delete(s.payPlanItems)
      .where(and(eq(s.payPlanItems.userId, userId), eq(s.payPlanItems.payDate, payDate)))
      .run()
    if (items.length > 0) {
      db.insert(s.payPlanItems)
        .values(itemRows(items).map((r) => ({ ...r, userId, payDate })))
        .run()
    }
    db.insert(s.payPlans)
      .values({ userId, payDate, customised })
      .onConflictDoUpdate({ target: [s.payPlans.userId, s.payPlans.payDate], set: { customised } })
      .run()
  })
}

function writeTemplate(db: Db, userId: string, expectedIncomeCents: number, items: PlanItemInput[]) {
  db.insert(s.planTemplates)
    .values({ userId, expectedIncomeCents })
    .onConflictDoUpdate({ target: s.planTemplates.userId, set: { expectedIncomeCents } })
    .run()
  db.delete(s.planTemplateItems).where(eq(s.planTemplateItems.userId, userId)).run()
  if (items.length > 0) {
    db.insert(s.planTemplateItems)
      .values(itemRows(items).map((r) => ({ ...r, userId })))
      .run()
  }
}

export function getTemplate(db: Db, userId: string): PlanTemplateDto | null {
  const t = db.select().from(s.planTemplates).where(eq(s.planTemplates.userId, userId)).get()
  if (!t) return null
  const r = resolver(db)
  return {
    expectedIncomeCents: t.expectedIncomeCents,
    items: templateItems(db, userId).map((i) => ({ ...i, ...r.resolve(i), check: null, movedCents: null })),
  }
}

function currentPayDate(db: Db, userId: string, today: LocalDate): LocalDate | null {
  return (
    db
      .select({ payDate: s.payEvents.payDate })
      .from(s.payEvents)
      .where(and(eq(s.payEvents.userId, userId), sql`${s.payEvents.payDate} <= ${today}`))
      .orderBy(desc(s.payEvents.payDate))
      .get()?.payDate ?? null
  )
}

export function putTemplate(
  db: Db,
  userId: string,
  t: { expectedIncomeCents: number; items: PlanItemInput[] },
  now: Date,
  tz: string,
): PlanTemplateDto {
  validate(db, userId, t.items)
  if (!Number.isInteger(t.expectedIncomeCents) || t.expectedIncomeCents < 0) {
    throw new BudgetError(400, 'Expected income must be $0 or more.')
  }
  db.transaction(() => {
    writeTemplate(db, userId, t.expectedIncomeCents, t.items)
    // Template edits reach the current pay's plan until it has been customised.
    const current = currentPayDate(db, userId, todayLocal(now, tz))
    const plan = current
      ? db
          .select()
          .from(s.payPlans)
          .where(and(eq(s.payPlans.userId, userId), eq(s.payPlans.payDate, current)))
          .get()
      : undefined
    if (current && plan && !plan.customised) writePayPlan(db, userId, current, t.items, false)
  })
  return getTemplate(db, userId)!
}

function requireEvent(db: Db, userId: string, payDate: LocalDate, status: 400 | 404) {
  const event = db
    .select()
    .from(s.payEvents)
    .where(and(eq(s.payEvents.userId, userId), eq(s.payEvents.payDate, payDate)))
    .get()
  if (!event) throw new BudgetError(status, 'No pay on that date')
  return event
}

/** Sum moved into `saverId` from the user's individual accounts within [from, to), excluding round-ups. */
function moved(db: Db, saverId: string, sourceIds: string[], from: string, to: string | null): number {
  const sources = sourceIds.filter((id) => id !== saverId)
  if (sources.length === 0) return 0
  return db
    .select({ cents: sql<number>`coalesce(sum(${s.transactions.amountCents}), 0)` })
    .from(s.transactions)
    .where(
      and(
        eq(s.transactions.accountId, saverId),
        gt(s.transactions.amountCents, 0),
        inArray(s.transactions.transferAccountId, sources),
        notRoundUp,
        isNull(s.transactions.deletedAt),
        gte(s.transactions.createdAt, from),
        to ? lt(s.transactions.createdAt, to) : undefined,
      ),
    )
    .get()!.cents
}

export function getPayPlan(db: Db, userId: string, payDate: LocalDate, _now: Date, tz: string): PayPlanDto {
  const event = requireEvent(db, userId, payDate, 404)
  let plan = db
    .select()
    .from(s.payPlans)
    .where(and(eq(s.payPlans.userId, userId), eq(s.payPlans.payDate, payDate)))
    .get()
  if (!plan && getTemplate(db, userId)) {
    writePayPlan(db, userId, payDate, templateItems(db, userId), false)
    plan = { userId, payDate, customised: false }
  }
  const items = plan ? payPlanItems(db, userId, payDate) : []

  const extraIds = JSON.parse(event.extraTxIdsJson) as string[]
  const extras = extraIds.length
    ? db
        .select({ cents: sql<number>`coalesce(sum(${s.transactions.amountCents}), 0)` })
        .from(s.transactions)
        .where(inArray(s.transactions.id, extraIds))
        .get()!.cents
    : 0
  const incomeIsExpected = event.amountCents === null
  const expected = db.select().from(s.planTemplates).where(eq(s.planTemplates.userId, userId)).get()
  const incomeCents = incomeIsExpected
    ? (expected?.expectedIncomeCents ?? 0) + extras
    : event.amountCents! + extras

  const next = db
    .select({ payDate: s.payEvents.payDate })
    .from(s.payEvents)
    .where(and(eq(s.payEvents.userId, userId), gt(s.payEvents.payDate, payDate)))
    .orderBy(asc(s.payEvents.payDate))
    .get()?.payDate
  const range = periodRangeUtc(payDate, next ?? payDate, tz)
  const sources = individualAccountIds(db, userId)

  const r = resolver(db)
  const dtoItems: PlanItemDto[] = items.map((i) => {
    const resolved = r.resolve(i)
    if (!resolved.resolvedSaverId || i.amountCents === 0)
      return { ...i, ...resolved, check: null, movedCents: null }
    const movedCents = moved(db, resolved.resolvedSaverId, sources, range.start, next ? range.end : null)
    const check = movedCents >= i.amountCents ? 'done' : movedCents > 0 ? 'partial' : 'pending'
    return { ...i, ...resolved, check, movedCents }
  })
  const allocatedCents = items.reduce((sum, i) => sum + i.amountCents, 0)
  return {
    userId,
    payDate,
    incomeCents,
    incomeIsExpected,
    allocatedCents,
    customised: plan?.customised ?? false,
    items: dtoItems,
  }
}

export function putPayPlan(
  db: Db,
  userId: string,
  payDate: LocalDate,
  items: PlanItemInput[],
  now: Date,
  tz: string,
): PayPlanDto {
  requireEvent(db, userId, payDate, 400)
  validate(db, userId, items)
  writePayPlan(db, userId, payDate, items, true)
  return getPayPlan(db, userId, payDate, now, tz)
}

/**
 * An item can't stay on an archived line, which may have happened since it was planned (the partner can
 * archive a Joint line). Its money keeps going to the line's Saver; with no Saver, it stays in Spending.
 */
function offArchivedLine(item: PlanItemInput, r: ReturnType<typeof resolver>): PlanItemInput[] {
  const line = item.targetKind === 'line' && item.lineId ? r.lines.get(item.lineId) : undefined
  if (!line?.archivedAt) return [item]
  if (!line.saverAccountId) return []
  return [{ ...item, targetKind: 'saver', lineId: null, saverAccountId: line.saverAccountId }]
}

/**
 * Items match by resolved Saver, or by line when they have no Saver.
 * Removals go first, so a Saver can be removed and added back.
 */
function mergeItems(
  items: PlanItemInput[],
  changes: { set: PlanItemInput[]; remove: string[] },
  r: ReturnType<typeof resolver>,
): PlanItemInput[] {
  const key = (i: PlanItemInput) => r.resolve(i).resolvedSaverId ?? i.lineId
  const merged = items
    .filter((i) => {
      const k = key(i)
      return k === null || !changes.remove.includes(k)
    })
    .flatMap((i) => offArchivedLine(i, r))
  for (const item of changes.set) {
    const at = merged.findIndex((m) => key(m) === key(item))
    if (at >= 0) merged[at] = { ...merged[at], amountCents: item.amountCents }
    else merged.push(item)
  }
  return merged
}

/**
 * Changes only the given items, and tidies away buffer items and items on archived lines on every-pay. The caller
 * runs it in a transaction, with the lines the items point at already written. With nothing to change, this pay's
 * plan stays uncustomised, and someone with no template doesn't get an empty one.
 */
export function applyPlanChanges(
  db: Db,
  userId: string,
  payDate: LocalDate,
  changes: { set: PlanItemInput[]; remove: string[] },
  applyTo: PayChangesInput['applyTo'],
  now: Date,
  tz: string,
): void {
  const nothingToChange = changes.set.length === 0 && changes.remove.length === 0
  if (nothingToChange && (applyTo === 'this-pay' || !getTemplate(db, userId))) return
  // Copies the template into this pay's plan if nothing has yet, so the plan starts from the old amounts.
  const plan = getPayPlan(db, userId, payDate, now, tz)
  const r = resolver(db)
  const currentPlan = mergeItems(payPlanItems(db, userId, payDate), changes, r)

  if (applyTo === 'this-pay') {
    validate(db, userId, currentPlan)
    writePayPlan(db, userId, payDate, currentPlan, true)
    return
  }

  const notBuffer = (i: PlanItemInput) => i.targetKind !== 'buffer'
  const template = mergeItems(templateItems(db, userId), changes, r).filter(notBuffer)
  const plannedItems = currentPlan.filter(notBuffer)
  validate(db, userId, template)
  validate(db, userId, plannedItems)
  const expected = getTemplate(db, userId)?.expectedIncomeCents ?? plan.incomeCents
  writeTemplate(db, userId, expected, template)
  writePayPlan(db, userId, payDate, plannedItems, plan.customised)
}

export function saveAsTemplate(
  db: Db,
  userId: string,
  payDate: LocalDate,
  now: Date,
  tz: string,
): PlanTemplateDto {
  const plan = getPayPlan(db, userId, payDate, now, tz)
  const expected = getTemplate(db, userId)?.expectedIncomeCents ?? plan.incomeCents
  return putTemplate(db, userId, { expectedIncomeCents: expected, items: plan.items.map(toInput) }, now, tz)
}

/**
 * A template proposal from what Up's pay split did last time: Saver transfers from the
 * user's individual accounts within 24 hours of the latest detected pay.
 */
export function proposeFromLastPay(
  db: Db,
  userId: string,
  _tz: string,
): { expectedIncomeCents: number; items: PlanItemInput[] } | null {
  const last = db
    .select({ tx: s.transactions })
    .from(s.payEvents)
    .innerJoin(s.transactions, eq(s.transactions.id, s.payEvents.transactionId))
    .where(
      and(
        eq(s.payEvents.userId, userId),
        eq(s.payEvents.source, 'detected'),
        isNotNull(s.payEvents.transactionId),
      ),
    )
    .orderBy(desc(s.payEvents.payDate))
    .get()
  if (!last) return null
  const from = last.tx.createdAt
  const to = new Date(Date.parse(from) + PROPOSAL_WINDOW_MS).toISOString()
  const sources = individualAccountIds(db, userId)
  if (sources.length === 0) return null

  const savers = db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(
      and(
        eq(s.accounts.accountType, 'SAVER'),
        sql`(${s.accounts.ownership} = 'JOINT' or ${s.accounts.ownerUserId} = ${userId})`,
      ),
    )
  const flows = db
    .select({
      saverId: s.transactions.accountId,
      cents: sql<number>`sum(${s.transactions.amountCents})`,
      first: sql<string>`min(${s.transactions.createdAt})`,
    })
    .from(s.transactions)
    .where(
      and(
        inArray(s.transactions.accountId, savers),
        inArray(s.transactions.transferAccountId, sources),
        ne(s.transactions.accountId, s.transactions.transferAccountId),
        gt(s.transactions.amountCents, 0),
        notRoundUp,
        isNull(s.transactions.deletedAt),
        gte(s.transactions.createdAt, from),
        lt(s.transactions.createdAt, to),
      ),
    )
    .groupBy(s.transactions.accountId)
    .orderBy(sql`min(${s.transactions.createdAt})`)
    .all()

  const budgets = plannableBudgetIds(db, userId)
  const linked = new Map(
    (budgets.length
      ? db
          .select({ id: s.budgetLines.id, saver: s.budgetLines.saverAccountId })
          .from(s.budgetLines)
          .where(and(inArray(s.budgetLines.budgetId, budgets), isNull(s.budgetLines.archivedAt)))
          .all()
      : []
    ).flatMap((l) => (l.saver ? [[l.saver, l.id] as const] : [])),
  )
  return {
    expectedIncomeCents: last.tx.amountCents,
    items: flows.map((f) => {
      const lineId = linked.get(f.saverId)
      return lineId
        ? { targetKind: 'line' as const, lineId, saverAccountId: null, amountCents: f.cents }
        : { targetKind: 'saver' as const, lineId: null, saverAccountId: f.saverId, amountCents: f.cents }
    }),
  }
}
