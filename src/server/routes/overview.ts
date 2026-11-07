import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { getOverview } from '../queries/overview'
import { currentMonth } from '../queries/time'
import { ScopeSchema } from './accounts'
import { validate } from './validate'

const Query = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM')
    .optional(),
  scope: ScopeSchema.default('everyone'),
})

export function overviewRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().use(requireUser(deps)).get('/', validate('query', Query), (c) => {
    const { month, scope } = c.req.valid('query')
    return c.json(
      getOverview(deps.db, {
        month: month ?? currentMonth(deps.now(), deps.tz),
        scope,
        userId: c.get('user').id,
        tz: deps.tz,
      }),
      200,
    )
  })
}
