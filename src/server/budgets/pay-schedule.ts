import { and, desc, eq, gt, gte, isNull, notInArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { PayEventRow, PayScheduleRow } from '../db/schema'
import { pruneJointSnapshots } from './budgets'
import { localDate, todayLocal, type LocalDate } from './dates'
import { BudgetError } from './errors'
import { derivePayEvents, type PayDeposit } from './pay-events'

const FREQUENCY_DAYS = 14
const CANDIDATE_WINDOW_DAYS = 60
const DAY_MS = 86_400_000

/** How pay and repayment descriptions are compared (in JS, so non-ASCII text matches). */
export const normaliseDescription = (description: string) => description.trim().toLowerCase()

export function getSchedule(db: Db, userId: string): PayScheduleRow | undefined {
  return db.select().from(s.paySchedules).where(eq(s.paySchedules.userId, userId)).get()
}

/** The caller's own positive, non-transfer deposit on one of their INDIVIDUAL accounts, or a 400. */
function requireOwnDeposit(db: Db, userId: string, transactionId: string) {
  const row = db
    .select({ tx: s.transactions, account: s.accounts })
    .from(s.transactions)
    .innerJoin(s.accounts, eq(s.accounts.id, s.transactions.accountId))
    .where(eq(s.transactions.id, transactionId))
    .get()
  const ok =
    row &&
    row.tx.deletedAt === null &&
    !row.tx.isTransfer &&
    row.tx.amountCents > 0 &&
    row.account.ownership === 'INDIVIDUAL' &&
    row.account.ownerUserId === userId
  if (!ok) throw new BudgetError(400, 'Pick a deposit into one of your own accounts.')
  return row.tx
}

export function createScheduleFromTransaction(
  db: Db,
  userId: string,
  transactionId: string,
  now: Date,
  tz: string,
): PayScheduleRow {
  const tx = requireOwnDeposit(db, userId, transactionId)
  const stamp = now.toISOString()
  const values = {
    accountId: tx.accountId,
    descriptionMatch: normaliseDescription(tx.description),
    minAmountCents: Math.floor(tx.amountCents / 2),
    frequencyDays: FREQUENCY_DAYS,
    updatedAt: stamp,
  }
  db.insert(s.paySchedules)
    .values({ userId, createdAt: stamp, ...values })
    .onConflictDoUpdate({ target: s.paySchedules.userId, set: values })
    .run()
  rederivePayEvents(db, userId, now, tz)
  return getSchedule(db, userId)!
}

export function updateSchedule(
  db: Db,
  userId: string,
  patch: { descriptionMatch?: string; minAmountCents?: number },
  now: Date,
  tz: string,
): PayScheduleRow {
  if (!getSchedule(db, userId)) throw new BudgetError(404, 'No pay schedule yet')
  const set: Partial<PayScheduleRow> = { updatedAt: now.toISOString() }
  if (patch.descriptionMatch !== undefined) set.descriptionMatch = normaliseDescription(patch.descriptionMatch)
  if (patch.minAmountCents !== undefined) set.minAmountCents = patch.minAmountCents
  db.update(s.paySchedules).set(set).where(eq(s.paySchedules.userId, userId)).run()
  rederivePayEvents(db, userId, now, tz)
  return getSchedule(db, userId)!
}

export function deleteSchedule(db: Db, userId: string): void {
  db.transaction((t) => {
    t.delete(s.paySchedules).where(eq(s.paySchedules.userId, userId)).run()
    t.delete(s.payEvents).where(eq(s.payEvents.userId, userId)).run()
  })
}

function matchingDeposits(db: Db, schedule: PayScheduleRow, tz: string): PayDeposit[] {
  const excluded = db
    .select({ id: s.payExclusions.transactionId })
    .from(s.payExclusions)
    .where(eq(s.payExclusions.userId, schedule.userId))
  return db
    .select({
      id: s.transactions.id,
      createdAt: s.transactions.createdAt,
      amountCents: s.transactions.amountCents,
      description: s.transactions.description,
    })
    .from(s.transactions)
    .where(
      and(
        eq(s.transactions.accountId, schedule.accountId),
        isNull(s.transactions.deletedAt),
        eq(s.transactions.isTransfer, false),
        gte(s.transactions.amountCents, schedule.minAmountCents),
        notInArray(s.transactions.id, excluded),
      ),
    )
    .orderBy(s.transactions.createdAt, s.transactions.id)
    .all()
    // Compared in JS, not SQL: SQLite's lower()/trim() only handle ASCII letters and spaces.
    .filter((r) => normaliseDescription(r.description) === schedule.descriptionMatch)
    .map((r) => ({ txId: r.id, localDate: localDate(r.createdAt, tz), amountCents: r.amountCents }))
}

/** Replaces the user's pay events from their schedule, and drops snapshots of pay dates that disappeared. */
export function rederivePayEvents(db: Db, userId: string, now: Date, tz: string): void {
  const schedule = getSchedule(db, userId)
  if (!schedule) return
  const derived = derivePayEvents(
    matchingDeposits(db, schedule, tz),
    todayLocal(now, tz),
    schedule.frequencyDays,
  )
  const dates = derived.map((e) => e.payDate)
  const derivedAt = now.toISOString()

  db.transaction((t) => {
    t.delete(s.payEvents).where(eq(s.payEvents.userId, userId)).run()
    if (derived.length > 0) {
      t.insert(s.payEvents)
        .values(
          derived.map((e) => ({
            userId,
            payDate: e.payDate,
            source: e.source,
            transactionId: e.txId,
            amountCents: e.amountCents,
            extraTxIdsJson: JSON.stringify(e.extraTxIds),
            derivedAt,
          })),
        )
        .run()
    }
    const personal = t
      .select({ id: s.budgets.id })
      .from(s.budgets)
      .where(eq(s.budgets.ownerUserId, userId))
      .get()
    if (personal) {
      t.delete(s.periodLines)
        .where(and(eq(s.periodLines.budgetId, personal.id), notInArray(s.periodLines.periodStart, dates)))
        .run()
    }
    const stale = and(
      eq(s.payPlans.userId, userId),
      eq(s.payPlans.customised, false),
      notInArray(s.payPlans.payDate, dates),
    )
    for (const p of t.select({ payDate: s.payPlans.payDate }).from(s.payPlans).where(stale).all()) {
      t.delete(s.payPlanItems)
        .where(and(eq(s.payPlanItems.userId, userId), eq(s.payPlanItems.payDate, p.payDate)))
        .run()
    }
    t.delete(s.payPlans).where(stale).run()
  })
  pruneJointSnapshots(db)
}

export function rederiveAll(db: Db, now: Date, tz: string): void {
  for (const { userId } of db.select({ userId: s.paySchedules.userId }).from(s.paySchedules).all()) {
    rederivePayEvents(db, userId, now, tz)
  }
}

export function listPayEvents(db: Db, userId: string): PayEventRow[] {
  return db
    .select()
    .from(s.payEvents)
    .where(eq(s.payEvents.userId, userId))
    .orderBy(desc(s.payEvents.payDate))
    .all()
}

export function excludePayEvent(db: Db, userId: string, payDate: LocalDate, now: Date, tz: string): void {
  const event = db
    .select()
    .from(s.payEvents)
    .where(and(eq(s.payEvents.userId, userId), eq(s.payEvents.payDate, payDate)))
    .get()
  if (!event) throw new BudgetError(404, 'No pay on that date')
  if (event.source !== 'detected' || !event.transactionId) {
    throw new BudgetError(400, "Pay not seen events can't be removed")
  }
  db.insert(s.payExclusions)
    .values({ userId, transactionId: event.transactionId })
    .onConflictDoNothing()
    .run()
  rederivePayEvents(db, userId, now, tz)
}

export function undoExclusion(db: Db, userId: string, transactionId: string, now: Date, tz: string): void {
  db.delete(s.payExclusions)
    .where(and(eq(s.payExclusions.userId, userId), eq(s.payExclusions.transactionId, transactionId)))
    .run()
  rederivePayEvents(db, userId, now, tz)
}

export function listExclusions(db: Db, userId: string): string[] {
  return db
    .select({ id: s.payExclusions.transactionId })
    .from(s.payExclusions)
    .where(eq(s.payExclusions.userId, userId))
    .all()
    .map((r) => r.id)
}

/**
 * Recent deposits that could be the user's pay: one per description (the latest),
 * ranked by how many deposits share that description, then by amount.
 */
export function payCandidates(
  db: Db,
  userId: string,
  now: Date,
): { transactionId: string; sameDescriptionCount: number }[] {
  const since = new Date(now.getTime() - CANDIDATE_WINDOW_DAYS * DAY_MS).toISOString()
  const rows = db
    .select({
      id: s.transactions.id,
      description: s.transactions.description,
      amountCents: s.transactions.amountCents,
    })
    .from(s.transactions)
    .innerJoin(s.accounts, eq(s.accounts.id, s.transactions.accountId))
    .where(
      and(
        eq(s.accounts.ownerUserId, userId),
        eq(s.accounts.ownership, 'INDIVIDUAL'),
        isNull(s.transactions.deletedAt),
        eq(s.transactions.isTransfer, false),
        gt(s.transactions.amountCents, 0),
        gte(s.transactions.createdAt, since),
      ),
    )
    .orderBy(desc(s.transactions.createdAt))
    .all()

  const byDescription = new Map<string, { latest: (typeof rows)[number]; count: number }>()
  for (const r of rows) {
    const group = byDescription.get(normaliseDescription(r.description))
    if (group) group.count++
    else byDescription.set(normaliseDescription(r.description), { latest: r, count: 1 })
  }
  return [...byDescription.values()]
    .sort((a, b) => b.count - a.count || b.latest.amountCents - a.latest.amountCents)
    .map((g) => ({ transactionId: g.latest.id, sameDescriptionCount: g.count }))
}
