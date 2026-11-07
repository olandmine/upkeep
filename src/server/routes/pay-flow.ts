import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { todayLocal } from '../budgets/dates'
import { getPayFlow } from '../payflow/gather'
import { deleteLayout, getLayout, putLayout } from '../payflow/layouts'
import { ScopeSchema } from './accounts'
import { budgetJson, budgetNoContent } from './budgets'
import { validate } from './validate'

export const LayoutKeySchema = z
  .string()
  .regex(/^(everyone|me|partner|joint):(actual|planned):(budget|accounts)$/)

const PayFlowQuery = z.object({
  scope: ScopeSchema.default('everyone'),
  mode: z.enum(['actual', 'planned']).default('actual'),
  group: z.enum(['budget', 'accounts']).default('accounts'),
  range: z.enum(['pay', 'month', 'year', 'fy']).default('pay'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const Coord = z.number().finite().min(-100_000).max(100_000)
const LayoutBody = z.object({
  positions: z
    .record(z.string().max(80), z.object({ x: Coord, y: Coord }))
    .refine((p) => Object.keys(p).length <= 300, 'Too many boxes'),
})

export function flowLayoutRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/:key', (c) => {
      const key = LayoutKeySchema.safeParse(c.req.param('key'))
      if (!key.success) return c.json({ error: 'Unknown layout' }, 400)
      return budgetJson(c, () => ({ positions: getLayout(deps.db, c.get('user').id, key.data) }))
    })
    .put('/:key', validate('json', LayoutBody), (c) => {
      const key = LayoutKeySchema.safeParse(c.req.param('key'))
      if (!key.success) return c.json({ error: 'Unknown layout' }, 400)
      return budgetNoContent(c, () =>
        putLayout(deps.db, c.get('user').id, key.data, c.req.valid('json').positions, deps.now()),
      )
    })
    .delete('/:key', (c) => {
      const key = LayoutKeySchema.safeParse(c.req.param('key'))
      if (!key.success) return c.json({ error: 'Unknown layout' }, 400)
      return budgetNoContent(c, () => deleteLayout(deps.db, c.get('user').id, key.data))
    })
}

export function payFlowRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', validate('query', PayFlowQuery), (c) =>
      budgetJson(c, () => {
        const q = c.req.valid('query')
        return getPayFlow(deps.db, {
          ...q,
          date: q.date ?? todayLocal(deps.now(), deps.tz),
          viewerId: c.get('user').id,
          now: deps.now(),
          tz: deps.tz,
        })
      }),
    )
}
