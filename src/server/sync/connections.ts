import { and, eq, ne } from 'drizzle-orm'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { ConnectionRow } from '../db/schema'

export function getConnection(db: Db, connectionId: string): ConnectionRow | undefined {
  return db.select().from(s.upConnections).where(eq(s.upConnections.id, connectionId)).get()
}

export function getConnectionByUser(db: Db, userId: string): ConnectionRow | undefined {
  return db.select().from(s.upConnections).where(eq(s.upConnections.userId, userId)).get()
}

export function listConnections(db: Db): ConnectionRow[] {
  return db.select().from(s.upConnections).all()
}

export function accountIdsForConnection(db: Db, connectionId: string): string[] {
  return db
    .select({ id: s.accountConnections.accountId })
    .from(s.accountConnections)
    .where(eq(s.accountConnections.connectionId, connectionId))
    .all()
    .map((r) => r.id)
}

/**
 * The token to write back with: the acting user's if it can see the account, else any other that can.
 * Only a token Up rejected is excluded; a connection whose last sync hit a transient error still works.
 */
export function pickConnectionForAccount(db: Db, accountId: string, actingUserId: string): ConnectionRow | null {
  const candidates = db
    .select({ conn: s.upConnections })
    .from(s.accountConnections)
    .innerJoin(s.upConnections, eq(s.upConnections.id, s.accountConnections.connectionId))
    .where(and(eq(s.accountConnections.accountId, accountId), ne(s.upConnections.status, 'unauthorized')))
    .all()
    .map((r) => r.conn)
  return candidates.find((c) => c.userId === actingUserId) ?? candidates[0] ?? null
}
