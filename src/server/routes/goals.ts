import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { todayLocal } from '../budgets/dates'
import { getGoalDetail } from '../goals/detail'
import { deleteGoal, listGoalDebts, listGoals, putGoal } from '../goals/goals'
import { archiveGoal, deleteArchived, markSeen, setNewTarget } from '../goals/reached'
import { ScopeSchema } from './accounts'
import { budgetJson, budgetNoContent } from './budgets'
import { validate } from './validate'

/** Checked further by putGoal for each kind: `save` and `buffer` need a target, `debt` a debt. */
const GoalBody = z.object({
  kind: z.enum(['save', 'buffer', 'debt']).default('save'),
  name: z.string().trim().min(1, 'Name is required').max(60),
  targetCents: z.number().int().optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates look like 2026-10-30')
    .nullable()
    .optional(),
  // An empty id reads as no choice, so it gets "Choose a debt." rather than a schema error.
  debtId: z.string().optional(),
})

const NewTargetBody = z.object({ targetCents: z.number().int() })

const GoalPageQuery = z.object({ range: z.enum(['3m', '6m', '1y', 'all']).default('6m') })

export function goalsRoutes(deps: AppDeps) {
  const today = () => todayLocal(deps.now(), deps.tz)
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', validate('query', z.object({ scope: ScopeSchema.default('everyone') })), (c) =>
      budgetJson(c, () => listGoals(deps.db, c.req.valid('query').scope, c.get('user').id, today(), deps.tz)),
    )
    // Before `/:accountId`, which would otherwise take "archived" as an account.
    .delete('/archived/:id', (c) => budgetNoContent(c, () => deleteArchived(deps.db, c.req.param('id'), c.get('user').id)))
    .put('/:accountId', validate('json', GoalBody), (c) =>
      budgetNoContent(c, () =>
        putGoal(
          deps.db,
          c.req.param('accountId'),
          c.req.valid('json'),
          c.get('user').id,
          deps.now(),
          today(),
          deps.tz,
        ),
      ),
    )
    .post('/:accountId/seen', (c) =>
      budgetNoContent(c, () => markSeen(deps.db, c.req.param('accountId'), c.get('user').id)),
    )
    .post('/:accountId/new-target', validate('json', NewTargetBody), (c) =>
      budgetNoContent(c, () =>
        setNewTarget(
          deps.db,
          c.req.param('accountId'),
          c.req.valid('json').targetCents,
          c.get('user').id,
          deps.now(),
          today(),
          deps.tz,
        ),
      ),
    )
    .post('/:accountId/archive', (c) =>
      budgetNoContent(c, () =>
        archiveGoal(deps.db, c.req.param('accountId'), c.get('user').id, deps.now(), today(), deps.tz),
      ),
    )
    .get('/:accountId/debts', (c) =>
      budgetJson(c, () => listGoalDebts(deps.db, c.req.param('accountId'), c.get('user').id, today(), deps.tz)),
    )
    .get('/:accountId', validate('query', GoalPageQuery), (c) =>
      budgetJson(c, () =>
        getGoalDetail(
          deps.db,
          c.req.param('accountId'),
          c.req.valid('query').range,
          c.get('user').id,
          today(),
          deps.tz,
        ),
      ),
    )
    .delete('/:accountId', (c) =>
      budgetNoContent(c, () => deleteGoal(deps.db, c.req.param('accountId'), c.get('user').id)),
    )
}
