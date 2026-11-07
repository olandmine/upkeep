import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { LocalDate } from '../budgets/dates'
import { BudgetError } from '../budgets/errors'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { AccountRow } from '../db/schema'
import { canSee, canSeeAccount } from '../sharing/policy'
import { canEditSaver, notYours, planLookup, putGoal, toGoalDto } from './goals'

const notFound = () => new BudgetError(404, 'Goal not found')

/** A Saver the viewer may see; hidden, missing and not a Saver all look the same. */
function requireVisibleSaver(db: Db, accountId: string, viewerId: string): AccountRow {
  const saver = db.select().from(s.accounts).where(eq(s.accounts.id, accountId)).get()
  if (!saver || saver.accountType !== 'SAVER' || !canSeeAccount(db, viewerId, saver, 'finances')) throw notFound()
  return saver
}

/** A visible Saver the viewer may also change: their own, or a joint one. */
function requireChangeableSaver(db: Db, accountId: string, viewerId: string): AccountRow {
  const saver = requireVisibleSaver(db, accountId, viewerId)
  if (!canEditSaver(saver, viewerId)) throw notYours(db, saver.ownerUserId)
  return saver
}

/**
 * Records that this person has seen the celebration for the goal's current reached date. Seeing the goal is
 * enough, not editing it: each person dismisses their own banner. A Saver without a reached goal is a no-op.
 */
export function markSeen(db: Db, accountId: string, viewerId: string): void {
  requireVisibleSaver(db, accountId, viewerId)
  const reachedOn = db.select().from(s.goals).where(eq(s.goals.accountId, accountId)).get()?.reachedOn
  if (!reachedOn) return
  db.insert(s.goalCelebrationsSeen)
    .values({ accountId, userId: viewerId, reachedOn })
    .onConflictDoUpdate({
      target: [s.goalCelebrationsSeen.accountId, s.goalCelebrationsSeen.userId],
      set: { reachedOn },
    })
    .run()
}

/** The Saver's goal as the viewer sees it today, which is what "reached" is judged on. */
function currentGoal(db: Db, saver: AccountRow, viewerId: string, today: LocalDate, tz: string) {
  const saved = db.select().from(s.goals).where(eq(s.goals.accountId, saver.id)).get()
  return { saved, dto: toGoalDto(db, saver, saved, saver.id, viewerId, today, tz, planLookup(db)) }
}

/**
 * Starts a new, higher goal from a reached one. It goes through `putGoal`, so the start resets and the
 * reached date clears. The built-in goal gets its first real row. Debt goals and buffers have nothing to raise.
 */
export function setNewTarget(
  db: Db,
  accountId: string,
  targetCents: number,
  viewerId: string,
  now: Date,
  today: LocalDate,
  tz: string,
): void {
  const saver = requireChangeableSaver(db, accountId, viewerId)
  const { dto } = currentGoal(db, saver, viewerId, today, tz)
  if (dto.status !== 'reached' || !dto.goal || dto.goal.kind !== 'save') {
    throw new BudgetError(400, 'Only a reached goal can have a new target.')
  }
  if (targetCents <= saver.balanceCents) throw new BudgetError(400, 'The new target must be more than the balance.')
  putGoal(db, accountId, { kind: 'save', name: dto.goal.name, targetCents }, viewerId, now, today, tz)
}

/**
 * Moves a reached goal to the archive and frees its Saver, in one step. A debt keeps its name on the row, so
 * deleting it later changes nothing; a paid-off debt keeps what it started at, as a $0 target says nothing.
 */
export function archiveGoal(db: Db, accountId: string, viewerId: string, now: Date, today: LocalDate, tz: string): void {
  const saver = requireChangeableSaver(db, accountId, viewerId)
  const { saved, dto } = currentGoal(db, saver, viewerId, today, tz)
  if (!saved || !dto.goal || dto.status !== 'reached' || !dto.reachedOn) {
    throw new BudgetError(400, 'Only a reached goal can be archived.')
  }
  // A debt deleted after it was paid off leaves a $0 Save up to goal that still remembers the debt.
  const paidOff = dto.debt?.paidOff ?? (saved.followedDebtName !== null && dto.goal.targetCents <= 0)
  const startTargetCents = dto.debt?.startTargetCents ?? saved.startTargetCents ?? 0
  db.transaction((tx) => {
    tx.insert(s.archivedGoals)
      .values({
        id: randomUUID(),
        accountId,
        ownerUserId: saver.ownership === 'JOINT' ? null : saver.ownerUserId,
        saverName: saver.displayName,
        name: dto.goal!.name,
        kind: dto.goal!.kind,
        targetCents: paidOff ? startTargetCents : dto.goal!.targetCents,
        debtName: dto.debt?.name ?? saved.followedDebtName,
        debtPaidOff: paidOff,
        reachedOn: dto.reachedOn!,
        archivedAt: now.toISOString(),
      })
      .run()
    tx.delete(s.goals).where(eq(s.goals.accountId, accountId)).run()
    tx.delete(s.goalCelebrationsSeen).where(eq(s.goalCelebrationsSeen.accountId, accountId)).run()
  })
}

/** Removes an archived goal for good. Whoever owns it, or either person for a joint Saver's. */
export function deleteArchived(db: Db, id: string, viewerId: string): void {
  const row = db.select().from(s.archivedGoals).where(eq(s.archivedGoals.id, id)).get()
  if (!row || !canSee(db, viewerId, row.ownerUserId, 'finances')) throw notFound()
  if (row.ownerUserId !== null && row.ownerUserId !== viewerId) throw notYours(db, row.ownerUserId)
  db.delete(s.archivedGoals).where(eq(s.archivedGoals.id, id)).run()
}
