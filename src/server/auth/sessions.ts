import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { UserRow } from '../db/schema'

const DAY_MS = 86_400_000
const SESSION_TTL_MS = 90 * DAY_MS
const RENEW_AFTER_MS = DAY_MS

export const SESSION_COOKIE = 'upkeep_session'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function createSession(db: Db, userId: string, now: Date): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString()
  db.insert(s.sessions)
    .values({ id: hashToken(token), userId, createdAt: now.toISOString(), lastSeenAt: now.toISOString(), expiresAt })
    .run()
  return { token, expiresAt }
}

/**
 * Returns the session's user, extending the expiry (at most once a day) while it's in use.
 * `renewedExpiresAt` is set when it was extended, so the caller can refresh the cookie too.
 */
export function validateSession(
  db: Db,
  token: string,
  now: Date,
): { user: UserRow; renewedExpiresAt: string | null } | null {
  const id = hashToken(token)
  const row = db
    .select({ session: s.sessions, user: s.users })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(eq(s.sessions.id, id))
    .get()
  if (!row) return null
  if (Date.parse(row.session.expiresAt) <= now.getTime()) {
    db.delete(s.sessions).where(eq(s.sessions.id, id)).run()
    return null
  }
  if (now.getTime() - Date.parse(row.session.lastSeenAt) > RENEW_AFTER_MS) {
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString()
    db.update(s.sessions).set({ lastSeenAt: now.toISOString(), expiresAt }).where(eq(s.sessions.id, id)).run()
    return { user: row.user, renewedExpiresAt: expiresAt }
  }
  return { user: row.user, renewedExpiresAt: null }
}

export function deleteSession(db: Db, token: string): void {
  db.delete(s.sessions).where(eq(s.sessions.id, hashToken(token))).run()
}
