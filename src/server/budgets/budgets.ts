import { randomUUID } from 'node:crypto'
import { and, asc, eq, notInArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { BudgetRow, PayEventRow } from '../db/schema'
import { addDays, type LocalDate } from './dates'
import { BudgetError } from './errors'

const FREQUENCY_DAYS = 14

// Insertion order breaks createdAt ties, so the owner (created first) always comes first.
export const usersInOrder = (db: Db) =>
  db.select({ id: s.users.id }).from(s.users).orderBy(asc(s.users.createdAt), sql`rowid`).all()

/** One personal budget per user and one Joint budget anchored to the first user. Idempotent. */
export function ensureBudgets(db: Db, now: Date): void {
  const users = usersInOrder(db)
  const createdAt = now.toISOString()
  db.transaction((t) => {
    for (const u of users) {
      t.insert(s.budgets)
        .values({ id: randomUUID(), kind: 'personal', ownerUserId: u.id, createdAt })
        .onConflictDoNothing({ target: s.budgets.ownerUserId })
        .run()
    }
    const joint = t.select().from(s.budgets).where(eq(s.budgets.kind, 'joint')).get()
    const firstUser = users[0]?.id ?? null
    if (!joint) {
      t.insert(s.budgets)
        .values({ id: randomUUID(), kind: 'joint', anchorUserId: firstUser, createdAt })
        .run()
    } else if (!joint.anchorUserId && firstUser) {
      t.update(s.budgets).set({ anchorUserId: firstUser }).where(eq(s.budgets.id, joint.id)).run()
    }
  })
}

export function listBudgetRows(db: Db): BudgetRow[] {
  return db.select().from(s.budgets).orderBy(asc(s.budgets.createdAt)).all()
}

export function getBudget(db: Db, id: string): BudgetRow {
  const row = db.select().from(s.budgets).where(eq(s.budgets.id, id)).get()
  if (!row) throw new BudgetError(404, 'Budget not found')
  return row
}

/** Personal: the owner's INDIVIDUAL accounts. Joint: every JOINT account. */
export function budgetAccountIds(db: Db, b: BudgetRow): string[] {
  const where =
    b.kind === 'joint'
      ? eq(s.accounts.ownership, 'JOINT')
      : and(eq(s.accounts.ownership, 'INDIVIDUAL'), eq(s.accounts.ownerUserId, b.ownerUserId ?? ''))
  return db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(where)
    .all()
    .map((r) => r.id)
}

export function setJointAnchor(db: Db, budgetId: string, userId: string, today: LocalDate): void {
  const b = getBudget(db, budgetId)
  if (b.kind !== 'joint') throw new BudgetError(400, 'Only the joint budget has an anchor')
  if (!db.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, userId)).get()) {
    throw new BudgetError(400, 'Unknown user')
  }
  db.transaction((t) => {
    t.update(s.budgets).set({ anchorUserId: userId }).where(eq(s.budgets.id, budgetId)).run()
    t.insert(s.budgetAnchorChanges)
      .values({ budgetId, effectiveDate: today, userId })
      .onConflictDoUpdate({
        target: [s.budgetAnchorChanges.budgetId, s.budgetAnchorChanges.effectiveDate],
        set: { userId },
      })
      .run()
  })
  pruneJointSnapshots(db)
}

export interface Period {
  start: LocalDate
  end: LocalDate | null
  nominalEnd: LocalDate
  isCurrent: boolean
  prevDate: LocalDate | null
  nextDate: LocalDate | null
  source: 'detected' | 'scheduled'
  payTxId: string | null
  payUserId: string
}

const eventsOf = (db: Db, userId: string) =>
  db.select().from(s.payEvents).where(eq(s.payEvents.userId, userId)).orderBy(asc(s.payEvents.payDate)).all()

/**
 * The pay events a budget's periods run between, ascending. Personal: the owner's.
 * Joint: each anchor's events within its segment [effectiveDate, next effectiveDate);
 * before the first change, the first user's.
 */
export function budgetPayEvents(db: Db, b: BudgetRow): PayEventRow[] {
  if (b.kind === 'personal') return b.ownerUserId ? eventsOf(db, b.ownerUserId) : []
  const changes = db
    .select()
    .from(s.budgetAnchorChanges)
    .where(eq(s.budgetAnchorChanges.budgetId, b.id))
    .orderBy(asc(s.budgetAnchorChanges.effectiveDate))
    .all()
  const initial = changes.length > 0 ? usersInOrder(db)[0]?.id : b.anchorUserId
  const segments = [
    { userId: initial ?? null, from: null as LocalDate | null },
    ...changes.map((c) => ({ userId: c.userId, from: c.effectiveDate })),
  ]
  return segments.flatMap((seg, i) => {
    if (!seg.userId) return []
    const until = segments[i + 1]?.from ?? null
    return eventsOf(db, seg.userId).filter(
      (e) => (!seg.from || e.payDate >= seg.from) && (!until || e.payDate < until),
    )
  })
}

export function findPeriod(db: Db, b: BudgetRow, date: LocalDate): Period | null {
  const events = budgetPayEvents(db, b)
  let i = -1
  for (let k = 0; k < events.length && events[k].payDate <= date; k++) i = k
  if (i < 0) return null
  const event = events[i]
  const next = events[i + 1]?.payDate ?? null
  return {
    start: event.payDate,
    end: next,
    nominalEnd: next ?? addDays(event.payDate, FREQUENCY_DAYS),
    isCurrent: next === null,
    prevDate: events[i - 1]?.payDate ?? null,
    nextDate: next,
    source: event.source,
    payTxId: event.transactionId,
    payUserId: event.userId,
  }
}

export function canEditBudget(_db: Db, b: BudgetRow, userId: string): boolean {
  return b.kind === 'joint' || b.ownerUserId === userId
}

/** Drops Joint snapshots whose period start is no longer one of Joint's pay dates. */
export function pruneJointSnapshots(db: Db): void {
  const joint = db.select().from(s.budgets).where(eq(s.budgets.kind, 'joint')).get()
  if (!joint) return
  const starts = budgetPayEvents(db, joint).map((e) => e.payDate)
  db.delete(s.periodLines)
    .where(and(eq(s.periodLines.budgetId, joint.id), notInArray(s.periodLines.periodStart, starts)))
    .run()
}
