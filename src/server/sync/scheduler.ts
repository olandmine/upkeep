import { eq } from 'drizzle-orm'
import type { SchedulerLike } from '../app'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { ConnectionRow } from '../db/schema'
import type { Logger } from '../logger'
import { listConnections } from './connections'
import type { RunResult, SyncEngine } from './engine'

type JobKind = 'backfill' | 'incremental' | 'reconcile'

export interface Scheduler extends SchedulerLike {
  start(): void
  stop(): void
  tick(): Promise<void>
  startup(): Promise<void>
}

export interface SchedulerDeps {
  db: Db
  engine: SyncEngine
  now: () => Date
  tz: string
  intervalMinutes: number
  reconcileHour: number
  logger: Logger
  /** Runs on the first tick of each local day (pay events re-derive here, so placeholders appear even while sync fails). */
  daily?: () => void
}

const HOUR_MS = 3_600_000
const RECONCILE_MIN_GAP_MS = 20 * HOUR_MS
const RECONCILE_CATCH_UP_MS = 24 * HOUR_MS

// 'error' connections keep retrying on schedule; only a rejected token pauses a connection.
const usable = (c: ConnectionRow) => c.status !== 'unauthorized'

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const running = new Map<string, Promise<RunResult>>()
  let timer: ReturnType<typeof setInterval> | null = null

  /** Single-flight per connection: returns the in-flight run if there is one. */
  function run(connectionId: string, kind: JobKind): Promise<RunResult> {
    const inFlight = running.get(connectionId)
    if (inFlight) return inFlight
    const job = deps.engine[kind](connectionId).finally(() => running.delete(connectionId))
    running.set(connectionId, job)
    return job
  }

  const sinceMs = (iso: string | null) => (iso ? deps.now().getTime() - Date.parse(iso) : Infinity)

  let lastDaily: string | null = null
  const localDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: deps.tz }).format(deps.now())

  function localHour(): number {
    const hour = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hourCycle: 'h23', timeZone: deps.tz }).format(deps.now())
    return Number(hour)
  }

  async function tickConnection(conn: ConnectionRow): Promise<void> {
    if (running.has(conn.id)) return
    if (!conn.backfillCompletedAt) {
      await run(conn.id, 'backfill')
      return
    }
    await run(conn.id, 'incremental')
    if (localHour() === deps.reconcileHour && sinceMs(conn.lastReconciledAt) > RECONCILE_MIN_GAP_MS) {
      await run(conn.id, 'reconcile')
    }
  }

  const scheduler: Scheduler = {
    trigger(connectionId, kind) {
      if (running.has(connectionId)) return
      void run(connectionId, kind).catch((error) => deps.logger.error('Sync job crashed', { connectionId, kind, error }))
    },

    async runNow() {
      await Promise.all(
        listConnections(deps.db)
          .filter(usable)
          .map((c) => run(c.id, c.backfillCompletedAt ? 'incremental' : 'backfill')),
      )
    },

    async tick() {
      const today = localDay()
      if (deps.daily && today !== lastDaily) {
        lastDaily = today
        try {
          deps.daily()
        } catch (error) {
          deps.logger.error('Daily task failed', { error: error instanceof Error ? error.message : String(error) })
        }
      }
      await Promise.all(listConnections(deps.db).filter(usable).map(tickConnection))
    },

    async startup() {
      deps.db.update(s.syncRuns)
        .set({ status: 'failed', finishedAt: deps.now().toISOString(), error: 'Interrupted by restart' })
        .where(eq(s.syncRuns.status, 'running'))
        .run()
      await Promise.all(
        listConnections(deps.db)
          .filter(usable)
          .map(async (c) => {
            if (!c.backfillCompletedAt) await run(c.id, 'backfill')
            else if (sinceMs(c.lastReconciledAt) > RECONCILE_CATCH_UP_MS) await run(c.id, 'reconcile')
          }),
      )
    },

    start() {
      void scheduler.startup().catch((error) => deps.logger.error('Scheduler startup failed', { error }))
      timer = setInterval(() => {
        void scheduler.tick().catch((error) => deps.logger.error('Scheduler tick failed', { error }))
      }, deps.intervalMinutes * 60_000)
    },

    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
  return scheduler
}
