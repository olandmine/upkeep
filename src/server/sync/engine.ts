import { randomUUID } from 'node:crypto'
import { and, eq, gte, inArray, isNull, lt, min } from 'drizzle-orm'
import type { SecretBox } from '../crypto'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { ConnectionRow } from '../db/schema'
import type { Logger } from '../logger'
import { UpClient } from '../up/client'
import { UpParseError, UpUnauthorizedError } from '../up/errors'
import type { UpTransaction } from '../up/schemas'
import { accountIdsForConnection, getConnection, getConnectionByUser } from './connections'
import { replaceTags, upsertAccounts, upsertCategories, upsertTransactions } from './upsert'

export interface EngineDeps {
  db: Db
  secrets: SecretBox
  upApiBaseUrl: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now: () => Date
  logger: Logger
  /** Runs after each successful run (pay events re-derive here). Errors are logged, never fail the run. */
  afterRun?: (connectionId: string) => void
}

export interface RunResult {
  runId: string
  status: 'ok' | 'failed'
  upserted: number
  deleted: number
  error?: string
}

export type RunKind = (typeof s.syncRuns.$inferSelect)['kind']

export interface SyncEngine {
  connect(userId: string, token: string): Promise<ConnectionRow>
  disconnect(userId: string): void
  backfill(connectionId: string): Promise<RunResult>
  incremental(connectionId: string): Promise<RunResult>
  reconcile(connectionId: string): Promise<RunResult>
  clientForConnection(conn: ConnectionRow): UpClient
}

const DAY_MS = 86_400_000
const INCREMENTAL_WINDOW_DAYS = 3
const RECONCILE_WINDOW_DAYS = 30
const SYNC_RUN_RETENTION_DAYS = 30
const CATALOGUE_REFRESH_MS = DAY_MS

interface RunContext {
  progress(upserted: number): void
}

export function createSyncEngine(deps: EngineDeps): SyncEngine {
  const { db, logger } = deps
  const nowIso = () => deps.now().toISOString()

  function clientFor(token: string): UpClient {
    return new UpClient({ token, baseUrl: deps.upApiBaseUrl, fetchImpl: deps.fetchImpl, sleep: deps.sleep, logger })
  }

  function clientForConnection(conn: ConnectionRow): UpClient {
    return clientFor(deps.secrets.decrypt(conn.tokenCiphertext))
  }

  function requireConnection(connectionId: string): ConnectionRow {
    const conn = getConnection(db, connectionId)
    if (!conn) throw new Error(`Unknown connection ${connectionId}`)
    return conn
  }

  async function withRun(
    connectionId: string,
    kind: RunKind,
    fn: (run: RunContext) => Promise<{ upserted: number; deleted: number }>,
  ): Promise<RunResult> {
    const runId = randomUUID()
    db.insert(s.syncRuns).values({ id: runId, connectionId, kind, status: 'running', startedAt: nowIso() }).run()
    const progress = (upserted: number) =>
      db.update(s.syncRuns).set({ transactionsUpserted: upserted }).where(eq(s.syncRuns.id, runId)).run()

    try {
      const { upserted, deleted } = await fn({ progress })
      const finishedAt = nowIso()
      db.update(s.syncRuns)
        .set({ status: 'ok', finishedAt, transactionsUpserted: upserted, transactionsDeleted: deleted })
        .where(eq(s.syncRuns.id, runId))
        .run()
      db.update(s.upConnections)
        .set({ status: 'ok', lastError: null, lastSyncedAt: finishedAt })
        .where(eq(s.upConnections.id, connectionId))
        .run()
      try {
        deps.afterRun?.(connectionId)
      } catch (error) {
        logger.error('After-sync hook failed', { connectionId, kind, error: error instanceof Error ? error.message : String(error) })
      }
      return { runId, status: 'ok', upserted, deleted }
    } catch (err) {
      const unauthorized = err instanceof UpUnauthorizedError
      const message = unauthorized ? 'Up rejected the token' : err instanceof Error ? err.message : String(err)
      logger.error('Sync run failed', { connectionId, kind, error: message })
      db.update(s.syncRuns)
        .set({ status: 'failed', finishedAt: nowIso(), error: message })
        .where(eq(s.syncRuns.id, runId))
        .run()
      db.update(s.upConnections)
        .set({ status: unauthorized ? 'unauthorized' : 'error', lastError: message })
        .where(eq(s.upConnections.id, connectionId))
        .run()
      return { runId, status: 'failed', upserted: 0, deleted: 0, error: message }
    }
  }

  let catalogueRefreshedAt: number | null = null

  async function refreshCatalogue(client: UpClient): Promise<void> {
    upsertCategories(db, await client.listCategories())
    replaceTags(db, await client.listTags())
    catalogueRefreshedAt = deps.now().getTime()
  }

  async function refreshCatalogueIfStale(client: UpClient): Promise<void> {
    if (catalogueRefreshedAt === null || deps.now().getTime() - catalogueRefreshedAt >= CATALOGUE_REFRESH_MS) {
      await refreshCatalogue(client)
    }
  }

  const daysBeforeNow = (days: number) => new Date(deps.now().getTime() - days * DAY_MS).toISOString()

  async function refreshAccounts(conn: ConnectionRow, client: UpClient): Promise<void> {
    upsertAccounts(db, conn, await client.listAccounts(), nowIso())
  }

  /** Upserts a page; if it references accounts we haven't stored, refresh accounts and retry those. */
  async function upsertPage(conn: ConnectionRow, client: UpClient, items: UpTransaction[]): Promise<number> {
    const syncedAt = nowIso()
    const first = upsertTransactions(db, items, syncedAt)
    if (!first.missingAccountIds.length) return first.upserted
    await refreshAccounts(conn, client)
    const missing = new Set(first.missingAccountIds)
    const retry = upsertTransactions(
      db,
      items.filter((t) => missing.has(t.relationships.account.data.id)),
      syncedAt,
    )
    if (retry.missingAccountIds.length) {
      logger.warn('Skipping transactions for accounts Up did not list', { accountIds: retry.missingAccountIds })
    }
    return first.upserted + retry.upserted
  }

  /**
   * Latest of each visible account's oldest stored transaction: a safe resume point (overlap is
   * harmless). If any visible account has nothing stored yet, e.g. a partner's account next to a
   * joint account the other token already imported, there is no safe point and we start over.
   */
  function resumePoint(connectionId: string): string | undefined {
    const accountIds = accountIdsForConnection(db, connectionId)
    if (!accountIds.length) return undefined
    const oldestPerAccount = db
      .select({ oldest: min(s.transactions.createdAt) })
      .from(s.transactions)
      .where(inArray(s.transactions.accountId, accountIds))
      .groupBy(s.transactions.accountId)
      .all()
      .map((r) => r.oldest)
      .filter((v): v is string => v !== null)
    if (oldestPerAccount.length < accountIds.length) return undefined
    return oldestPerAccount.reduce((a, b) => (a > b ? a : b))
  }

  return {
    clientForConnection,

    async connect(userId, token) {
      const client = clientFor(token)
      await client.ping()
      const tokenCiphertext = deps.secrets.encrypt(token)
      const existing = getConnectionByUser(db, userId)
      if (existing) {
        db.update(s.upConnections)
          .set({ tokenCiphertext, status: 'ok', lastError: null })
          .where(eq(s.upConnections.id, existing.id))
          .run()
      } else {
        db.insert(s.upConnections)
          .values({ id: randomUUID(), userId, tokenCiphertext, status: 'ok', createdAt: nowIso() })
          .run()
      }
      const conn = getConnectionByUser(db, userId)!
      await withRun(conn.id, 'connect', async () => {
        await refreshCatalogue(client)
        await refreshAccounts(conn, client)
        return { upserted: 0, deleted: 0 }
      })
      return getConnectionByUser(db, userId)!
    },

    disconnect(userId) {
      db.delete(s.upConnections).where(eq(s.upConnections.userId, userId)).run()
    },

    async backfill(connectionId) {
      const conn = requireConnection(connectionId)
      return withRun(conn.id, 'backfill', async (run) => {
        const startedAt = nowIso()
        const client = clientForConnection(conn)
        const until = conn.backfillCompletedAt ? undefined : resumePoint(conn.id)
        let upserted = 0
        for await (const page of client.transactionPages({ until })) {
          upserted += await upsertPage(conn, client, page.items)
          run.progress(upserted)
        }
        db.update(s.upConnections)
          .set({ backfillCompletedAt: nowIso(), syncedThrough: startedAt })
          .where(eq(s.upConnections.id, conn.id))
          .run()
        return { upserted, deleted: 0 }
      })
    },

    async incremental(connectionId) {
      const conn = requireConnection(connectionId)
      return withRun(conn.id, 'incremental', async (run) => {
        const startedAt = nowIso()
        const client = clientForConnection(conn)
        await refreshCatalogueIfStale(client)
        await refreshAccounts(conn, client)

        // Normally the last 3 days; after time offline (PC off, token rejected) reach back to
        // a day before the last complete sync so nothing in between is missed.
        const window = daysBeforeNow(INCREMENTAL_WINDOW_DAYS)
        const resumeFrom = conn.syncedThrough
          ? new Date(Date.parse(conn.syncedThrough) - DAY_MS).toISOString()
          : window
        const since = resumeFrom < window ? resumeFrom : window
        const seen = new Set<string>()
        let upserted = 0
        for await (const page of client.transactionPages({ since })) {
          for (const t of page.items) seen.add(t.id)
          for (const id of page.skippedIds) seen.add(id)
          upserted += await upsertPage(conn, client, page.items)
          run.progress(upserted)
        }

        // Holds we still have that the walk didn't return (older ones, or ones Up dropped, like a
        // cancelled fuel pre-auth) may have settled or disappeared: ask Up about each by id.
        const accountIds = accountIdsForConnection(db, conn.id)
        const staleHolds = accountIds.length
          ? db
              .select({ id: s.transactions.id })
              .from(s.transactions)
              .where(
                and(
                  inArray(s.transactions.accountId, accountIds),
                  eq(s.transactions.status, 'HELD'),
                  isNull(s.transactions.deletedAt),
                ),
              )
              .all()
              .filter((r) => !seen.has(r.id))
          : []
        let deleted = 0
        for (const { id } of staleHolds) {
          let fresh
          try {
            fresh = await client.getTransaction(id)
          } catch (err) {
            if (err instanceof UpParseError) continue // still exists in Up; leave our copy alone
            throw err
          }
          if (fresh) {
            upserted += await upsertPage(conn, client, [fresh])
          } else {
            db.update(s.transactions).set({ deletedAt: nowIso() }).where(eq(s.transactions.id, id)).run()
            deleted++
          }
        }
        db.update(s.upConnections).set({ syncedThrough: startedAt }).where(eq(s.upConnections.id, conn.id)).run()
        return { upserted, deleted }
      })
    },

    async reconcile(connectionId) {
      const conn = requireConnection(connectionId)
      return withRun(conn.id, 'reconcile', async (run) => {
        const client = clientForConnection(conn)
        const since = daysBeforeNow(RECONCILE_WINDOW_DAYS)
        const seen = new Set<string>()
        let upserted = 0
        // A failed page throws out of this loop, so a partial walk never reaches the deletion step.
        for await (const page of client.transactionPages({ since })) {
          for (const t of page.items) seen.add(t.id)
          // Unreadable records still exist in Up: never let them look deleted.
          for (const id of page.skippedIds) seen.add(id)
          upserted += await upsertPage(conn, client, page.items)
          run.progress(upserted)
        }

        const accountIds = accountIdsForConnection(db, conn.id)
        const local = accountIds.length
          ? db
              .select({ id: s.transactions.id })
              .from(s.transactions)
              .where(
                and(
                  inArray(s.transactions.accountId, accountIds),
                  gte(s.transactions.createdAt, since),
                  isNull(s.transactions.deletedAt),
                ),
              )
              .all()
          : []
        const missing = local.map((r) => r.id).filter((id) => !seen.has(id))
        const deletedAt = nowIso()
        db.transaction((tx) => {
          for (const id of missing) tx.update(s.transactions).set({ deletedAt }).where(eq(s.transactions.id, id)).run()
          tx.update(s.upConnections).set({ lastReconciledAt: deletedAt }).where(eq(s.upConnections.id, conn.id)).run()
          tx.delete(s.syncRuns).where(lt(s.syncRuns.startedAt, daysBeforeNow(SYNC_RUN_RETENTION_DAYS))).run()
        })
        return { upserted, deleted: missing.length }
      })
    },
  }
}
