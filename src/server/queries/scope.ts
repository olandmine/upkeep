import { and, eq, isNotNull, ne } from 'drizzle-orm'
import type { SharedData } from '../../shared/sharing'
import type { Scope } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { canSeeAccount } from '../sharing/policy'

/** Account ids in a scope, by ownership, leaving out what the owner's sharing level hides for `data`. */
export function scopeAccountIds(db: Db, scope: Scope, viewerId: string, data: SharedData): string[] {
  const where = {
    everyone: undefined,
    me: and(eq(s.accounts.ownership, 'INDIVIDUAL'), eq(s.accounts.ownerUserId, viewerId)),
    partner: and(eq(s.accounts.ownership, 'INDIVIDUAL'), isNotNull(s.accounts.ownerUserId), ne(s.accounts.ownerUserId, viewerId)),
    joint: eq(s.accounts.ownership, 'JOINT'),
  }[scope]
  return db
    .select({ id: s.accounts.id, ownership: s.accounts.ownership, ownerUserId: s.accounts.ownerUserId })
    .from(s.accounts)
    .where(where)
    .all()
    .filter((a) => canSeeAccount(db, viewerId, a, data))
    .map((a) => a.id)
}

/** The `everyone` scope: every account the viewer may see for `data`. */
export function viewableAccountIds(db: Db, viewerId: string, data: SharedData): string[] {
  return scopeAccountIds(db, 'everyone', viewerId, data)
}
