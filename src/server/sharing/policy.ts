import { eq, ne } from 'drizzle-orm'
import { levelAllows, type SharedData } from '../../shared/sharing'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { BudgetError } from '../budgets/errors'

/** The viewer's partner, if there is one. Knowing they exist says nothing they've hidden. */
export const partnerOf = (db: Db, viewerId: string) =>
  db
    .select({ id: s.users.id, name: s.users.displayName })
    .from(s.users)
    .where(ne(s.users.id, viewerId))
    .get() ?? null

/** Whether this person's level shows `data` to the other person. */
export function shares(db: Db, ownerId: string, data: SharedData): boolean {
  const owner = db.select({ level: s.users.sharingLevel }).from(s.users).where(eq(s.users.id, ownerId)).get()
  return levelAllows(owner?.level ?? null, data)
}

/** Whether `viewerId` may see `data` belonging to `ownerId`. A null owner is shared data, and you always see your own. */
export function canSee(db: Db, viewerId: string, ownerId: string | null, data: SharedData): boolean {
  if (ownerId === null || ownerId === viewerId) return true
  return shares(db, ownerId, data)
}

/** Joint accounts belong to both people; an individual account follows its owner's level. */
export function canSeeAccount(
  db: Db,
  viewerId: string,
  account: { ownership: string; ownerUserId: string | null },
  data: SharedData,
): boolean {
  if (account.ownership === 'JOINT') return true
  if (account.ownerUserId === null) return false
  return canSee(db, viewerId, account.ownerUserId, data)
}

/** For routes that take a user id: a missing user and one the viewer can't see finances for look the same. */
export function requireVisibleUser(db: Db, viewerId: string, userId: string): void {
  const exists = db.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, userId)).get()
  if (!exists || !canSee(db, viewerId, userId, 'finances')) throw new BudgetError(404, 'User not found')
}
