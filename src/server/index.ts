import { existsSync } from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app'
import { loadConfig } from './config'
import { createSecretBox, loadOrCreateKey } from './crypto'
import { migrateDb, openDb } from './db/client'
import { createLogger } from './logger'
import { ensureBudgets } from './budgets/budgets'
import { rederiveAll } from './budgets/pay-schedule'
import { createSyncEngine } from './sync/engine'
import { createScheduler } from './sync/scheduler'

const logger = createLogger()
const config = loadConfig()
const now = () => new Date()

const key = loadOrCreateKey(config)
const { db, sqlite } = openDb(path.join(config.dataDir, 'upkeep.db'))
migrateDb(db, config.migrationsDir)

const engine = createSyncEngine({
  db,
  secrets: createSecretBox(key),
  upApiBaseUrl: config.upApiBaseUrl,
  now,
  logger,
  afterRun: () => rederiveAll(db, now(), config.tz),
})
ensureBudgets(db, now())
rederiveAll(db, now(), config.tz)

const scheduler = createScheduler({
  db,
  engine,
  now,
  tz: config.tz,
  intervalMinutes: config.syncIntervalMinutes,
  reconcileHour: config.reconcileHour,
  daily: () => rederiveAll(db, now(), config.tz),
  logger,
})
const app = createApp({ db, now, tz: config.tz, logger, engine, scheduler })

// Built SPA: static files, then index.html for client-side routes. /api/* never falls through to it.
// In dev, Vite serves the web app and proxies /api here, so dist/web may not exist.
if (existsSync(config.webDistDir)) {
  const webRoot = path.relative(process.cwd(), config.webDistDir) || '.'
  const isApi = (p: string) => p === '/api' || p.startsWith('/api/')
  const staticFiles = serveStatic({ root: webRoot })
  const spaFallback = serveStatic({ root: webRoot, path: 'index.html' })
  app.use('*', (c, next) => (isApi(c.req.path) ? next() : staticFiles(c, next)))
  app.get('*', (c, next) => (isApi(c.req.path) ? next() : spaFallback(c, next)))
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info('listening', { port: info.port, tz: config.tz, dataDir: config.dataDir })
})
scheduler.start()

function shutdown(signal: string) {
  logger.info('shutting down', { signal })
  scheduler.stop()
  server.close(() => {
    sqlite.close()
    process.exit(0)
  })
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
