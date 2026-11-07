import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import {
  getPayPlan,
  getTemplate,
  proposeFromLastPay,
  putPayPlan,
  putTemplate,
  saveAsTemplate,
} from '../budgets/plans'
import { requireVisibleUser } from '../sharing/policy'
import { budgetJson } from './budgets'
import { validate } from './validate'

const Item = z.object({
  targetKind: z.enum(['line', 'saver', 'buffer']),
  lineId: z.string().min(1).nullable(),
  saverAccountId: z.string().min(1).nullable(),
  amountCents: z.number().int(),
})
const Items = z.array(Item).max(50)

/** Mounted at /api, so auth is per route. Writes act on the caller's own plan and template. */
export function plansRoutes(deps: AppDeps) {
  const auth = requireUser(deps)
  return new Hono<AppEnv>()
    .get('/plans/:userId/:payDate', auth, (c) =>
      budgetJson(c, () => {
        requireVisibleUser(deps.db, c.get('user').id, c.req.param('userId'))
        return getPayPlan(deps.db, c.req.param('userId'), c.req.param('payDate'), deps.now(), deps.tz)
      }),
    )
    .put('/plans/:payDate', auth, validate('json', z.object({ items: Items })), (c) =>
      budgetJson(c, () =>
        putPayPlan(
          deps.db,
          c.get('user').id,
          c.req.param('payDate'),
          c.req.valid('json').items,
          deps.now(),
          deps.tz,
        ),
      ),
    )
    .post('/plans/:payDate/save-as-template', auth, (c) =>
      budgetJson(c, () =>
        saveAsTemplate(deps.db, c.get('user').id, c.req.param('payDate'), deps.now(), deps.tz),
      ),
    )
    .get('/plan-template', auth, (c) => c.json(getTemplate(deps.db, c.get('user').id), 200))
    .put(
      '/plan-template',
      auth,
      validate('json', z.object({ expectedIncomeCents: z.number().int(), items: Items })),
      (c) =>
        budgetJson(c, () => putTemplate(deps.db, c.get('user').id, c.req.valid('json'), deps.now(), deps.tz)),
    )
    .post('/plan-template/from-last-pay', auth, (c) =>
      c.json(proposeFromLastPay(deps.db, c.get('user').id, deps.tz), 200),
    )
}
