import { and, desc, eq } from 'drizzle-orm'
import type { SyncStatusDto } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { canSee } from '../sharing/policy'

/** Sync status of each connection; what a sync run did or failed on is left out for a person whose transactions the viewer can't see. */
export function getSyncStatus(db: Db, viewerId: string): SyncStatusDto {
  const rows = db
    .select({ conn: s.upConnections, displayName: s.users.displayName })
    .from(s.upConnections)
    .innerJoin(s.users, eq(s.users.id, s.upConnections.userId))
    .orderBy(s.users.createdAt)
    .all()

  return {
    connections: rows.map(({ conn, displayName }) => {
      const run = db
        .select()
        .from(s.syncRuns)
        .where(and(eq(s.syncRuns.connectionId, conn.id), eq(s.syncRuns.status, 'running')))
        .orderBy(desc(s.syncRuns.startedAt))
        .get()
      const failed = db
        .select({ finishedAt: s.syncRuns.finishedAt })
        .from(s.syncRuns)
        .where(and(eq(s.syncRuns.connectionId, conn.id), eq(s.syncRuns.status, 'failed')))
        .orderBy(desc(s.syncRuns.startedAt))
        .get()
      const detail = canSee(db, viewerId, conn.userId, 'transactions')
      return {
        userId: conn.userId,
        displayName,
        status: conn.status,
        lastSyncedAt: conn.lastSyncedAt,
        lastError: detail ? conn.lastError : null,
        lastFailedAt: failed?.finishedAt ?? null,
        backfillCompletedAt: conn.backfillCompletedAt,
        running: run
          ? { kind: run.kind, startedAt: run.startedAt, transactionsUpserted: detail ? run.transactionsUpserted : 0 }
          : null,
      }
    }),
  }
}
