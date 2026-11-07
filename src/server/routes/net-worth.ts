import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { todayLocal } from '../budgets/dates'
import { getNetWorth } from '../networth/networth'
import { ScopeSchema } from './accounts'
import { validate } from './validate'

const Query = z.object({
  scope: ScopeSchema.default('everyone'),
  range: z.enum(['6m', '1y', 'all']).default('6m'),
})

export function netWorthRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().use(requireUser(deps)).get('/', validate('query', Query), (c) => {
    const { scope, range } = c.req.valid('query')
    return c.json(
      getNetWorth(deps.db, scope, c.get('user').id, range, todayLocal(deps.now(), deps.tz), deps.tz),
      200,
    )
  })
}
