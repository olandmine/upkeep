import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { gatherFacts, gettingStarted } from '../onboarding/getting-started'

export function gettingStartedRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', (c) => c.json(gettingStarted(gatherFacts(deps.db, c.get('user'))), 200))
}
