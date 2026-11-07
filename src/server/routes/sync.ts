import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { getSyncStatus } from '../sync/status'

export function syncRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/status', (c) => c.json(getSyncStatus(deps.db, c.get('user').id), 200))
    .post('/run', async (c) => {
      await deps.scheduler.runNow()
      return c.json(getSyncStatus(deps.db, c.get('user').id), 200)
    })
}
