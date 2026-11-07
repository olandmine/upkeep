import { Hono } from 'hono'
import { csrfGuard } from './auth/middleware'
import { LoginLimiter } from './auth/rate-limit'
import type { Db } from './db/client'
import type { UserRow } from './db/schema'
import type { Logger } from './logger'
import { accountsRoutes } from './routes/accounts'
import { authRoutes } from './routes/auth'
import { budgetLinesRoutes, budgetsRoutes } from './routes/budgets'
import { catalogRoutes } from './routes/catalog'
import { debtsRoutes, payoffRoutes } from './routes/debts'
import { gettingStartedRoutes } from './routes/getting-started'
import { goalsRoutes } from './routes/goals'
import { meRoutes } from './routes/me'
import { netWorthRoutes } from './routes/net-worth'
import { overviewRoutes } from './routes/overview'
import { payRoutes } from './routes/pay'
import { flowLayoutRoutes, payFlowRoutes } from './routes/pay-flow'
import { plansRoutes } from './routes/plans'
import { settingsRoutes } from './routes/settings'
import { setupRoutes } from './routes/setup'
import { syncRoutes } from './routes/sync'
import { transactionsRoutes } from './routes/transactions'
import { usersRoutes } from './routes/users'
import type { SyncEngine } from './sync/engine'

export interface SchedulerLike {
  trigger(connectionId: string, kind: 'backfill' | 'incremental'): void
  runNow(): Promise<void>
}

export interface AppDeps {
  db: Db
  now: () => Date
  /** IANA timezone for day and month boundaries. */
  tz: string
  logger: Logger
  engine: SyncEngine
  scheduler: SchedulerLike
  limiter: LoginLimiter
}

export type AppEnv = { Variables: { user: UserRow } }

export function createApp(input: Omit<AppDeps, 'limiter'> & { limiter?: LoginLimiter }) {
  const deps: AppDeps = { ...input, limiter: input.limiter ?? new LoginLimiter() }
  const app = new Hono<AppEnv>()
    .use('/api/*', csrfGuard)
    .route('/api/setup', setupRoutes(deps))
    .route('/api/auth', authRoutes(deps))
    .route('/api/users', usersRoutes(deps))
    .route('/api/me', meRoutes(deps))
    .route('/api/settings', settingsRoutes(deps))
    .route('/api/sync', syncRoutes(deps))
    .route('/api/accounts', accountsRoutes(deps))
    .route('/api/transactions', transactionsRoutes(deps))
    .route('/api/overview', overviewRoutes(deps))
    .route('/api/budgets', budgetsRoutes(deps))
    .route('/api/budget-lines', budgetLinesRoutes(deps))
    .route('/api/debts', debtsRoutes(deps))
    .route('/api/payoff-plan', payoffRoutes(deps))
    .route('/api/goals', goalsRoutes(deps))
    .route('/api/getting-started', gettingStartedRoutes(deps))
    .route('/api/net-worth', netWorthRoutes(deps))
    .route('/api/flow-layouts', flowLayoutRoutes(deps))
    .route('/api/pay-flow', payFlowRoutes(deps))
    .route('/api', catalogRoutes(deps))
    .route('/api', payRoutes(deps))
    .route('/api', plansRoutes(deps))

  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  app.onError((err, c) => {
    deps.logger.error('Unhandled error', { path: c.req.path, error: err })
    return c.json({ error: 'Something went wrong' }, 500)
  })
  return app
}

export type AppType = ReturnType<typeof createApp>
