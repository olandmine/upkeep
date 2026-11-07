import { eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { BudgetDto, PayChangesInput } from '../../shared/types'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import {
  budgetPayEvents,
  canEditBudget,
  ensureBudgets,
  getBudget,
  listBudgetRows,
  setJointAnchor,
} from '../budgets/budgets'
import { todayLocal } from '../budgets/dates'
import { BudgetError } from '../budgets/errors'
import { activeLines, archiveLine, createLine, updateLine } from '../budgets/lines'
import { applyPayChanges } from '../budgets/pay-changes'
import { budgetSetup } from '../budgets/setup'
import { getSpendingHistory } from '../budgets/spending-history'
import { getStandardPay } from '../budgets/standard-pay'
import { getBudgetPeriod } from '../budgets/status'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { BudgetRow, UserRow } from '../db/schema'
import { canSee, requireVisibleUser } from '../sharing/policy'
import { validate } from './validate'

/** Runs a budget operation, answering a BudgetError with `{ error }` and its status. */
export function budgetJson<T extends object | null>(
  c: Context<AppEnv>,
  fn: () => T,
  status: ContentfulStatusCode = 200,
) {
  try {
    return c.json(fn(), status)
  } catch (err) {
    if (err instanceof BudgetError) return c.json({ error: err.message }, err.status)
    throw err
  }
}

export function budgetNoContent(c: Context<AppEnv>, fn: () => void) {
  try {
    fn()
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof BudgetError) return c.json({ error: err.message }, err.status)
    throw err
  }
}

const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates look like 2026-10-30')

const LineFields = z.object({
  kind: z.enum(['spending', 'fund']),
  name: z.string().trim().min(1).max(60),
  amountCents: z.number().int().min(0),
  categoryIds: z.array(z.string().min(1)).max(50),
  saverAccountId: z.string().min(1).nullable(),
})
const LineBody = LineFields.extend({ saverAccountId: LineFields.shape.saverAccountId.default(null) })
// No defaults on PATCH: an omitted field keeps its value.
const LinePatch = LineFields.partial()

const MAX_PAY_CHANGES = 100
const AmountCents = z.number().int().min(0)
const PayChangesBody = z.object({
  payDate: LocalDateSchema,
  applyTo: z.enum(['every-pay', 'this-pay']),
  savers: z.object({
    set: z
      .array(z.object({ saverAccountId: z.string().min(1), amountCents: AmountCents }))
      .max(MAX_PAY_CHANGES),
    remove: z.array(z.string().min(1)).max(MAX_PAY_CHANGES),
  }),
  limits: z.array(z.object({ lineId: z.string().min(1), amountCents: AmountCents })).max(MAX_PAY_CHANGES),
  lines: z.object({
    create: z.array(LineFields.extend({ budget: z.enum(['personal', 'joint']) })).max(MAX_PAY_CHANGES),
    update: z.array(LinePatch.extend({ lineId: z.string().min(1) })).max(MAX_PAY_CHANGES),
    archive: z.array(z.string().min(1)).max(MAX_PAY_CHANGES),
  }),
}) satisfies z.ZodType<PayChangesInput>

function toBudgetDto(db: Db, b: BudgetRow, viewer: UserRow): BudgetDto {
  const owner = b.ownerUserId
    ? db.select().from(s.users).where(eq(s.users.id, b.ownerUserId)).get()
    : undefined
  return {
    id: b.id,
    kind: b.kind,
    ownerUserId: b.ownerUserId,
    name:
      b.kind === 'joint' ? 'Joint' : b.ownerUserId === viewer.id ? 'Mine' : (owner?.displayName ?? 'Partner'),
    anchorUserId: b.anchorUserId,
    hasPeriods: budgetPayEvents(db, b).length > 0,
    canEdit: canEditBudget(db, b, viewer.id),
    setup: budgetSetup(db, b),
  }
}

const order = (b: BudgetRow, viewerId: string) =>
  b.kind === 'joint' ? 2 : b.ownerUserId === viewerId ? 0 : 1

export function budgetsRoutes(deps: AppDeps) {
  const today = () => todayLocal(deps.now(), deps.tz)
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', (c) => {
      ensureBudgets(deps.db, deps.now())
      const viewer = c.get('user')
      const rows = listBudgetRows(deps.db)
        .filter((b) => canSee(deps.db, viewer.id, b.ownerUserId, 'finances'))
        .sort((a, b) => order(a, viewer.id) - order(b, viewer.id))
      return c.json(
        rows.map((b) => toBudgetDto(deps.db, b, viewer)),
        200,
      )
    })
    .put('/pay-changes', validate('json', PayChangesBody), (c) =>
      budgetNoContent(c, () =>
        applyPayChanges(deps.db, c.get('user').id, c.req.valid('json'), deps.now(), deps.tz),
      ),
    )
    .get('/standard-pay/:userId', (c) =>
      budgetJson(c, () => {
        const userId = c.req.param('userId')
        requireVisibleUser(deps.db, c.get('user').id, userId)
        return getStandardPay(deps.db, userId, deps.now(), deps.tz)
      }),
    )
    .patch('/:id', validate('json', z.object({ anchorUserId: z.string().min(1) })), (c) =>
      budgetJson(c, () => {
        const id = c.req.param('id')
        setJointAnchor(deps.db, id, c.req.valid('json').anchorUserId, today())
        return toBudgetDto(deps.db, getBudget(deps.db, id), c.get('user'))
      }),
    )
    .get('/:id/period', validate('query', z.object({ date: LocalDateSchema.optional() })), (c) =>
      budgetJson(c, () => {
        if (!canSee(deps.db, c.get('user').id, getBudget(deps.db, c.req.param('id')).ownerUserId, 'finances')) {
          throw new BudgetError(404, 'Budget not found')
        }
        const period = getBudgetPeriod(deps.db, {
          budgetId: c.req.param('id'),
          date: c.req.valid('query').date ?? today(),
          now: deps.now(),
          tz: deps.tz,
        })
        if (!period) throw new BudgetError(404, 'No pay periods yet')
        return period
      }),
    )
    .get('/:id/spending-history', (c) =>
      budgetJson(c, () => {
        const budget = getBudget(deps.db, c.req.param('id'))
        // For the person planning this budget, so a partner's is never asked for, whatever their sharing level.
        if (budget.kind === 'personal' && budget.ownerUserId !== c.get('user').id) {
          throw new BudgetError(404, 'Budget not found')
        }
        return getSpendingHistory(deps.db, budget, today(), deps.tz)
      }),
    )
    .post('/:id/lines', validate('json', LineBody), (c) =>
      budgetJson(
        c,
        () => {
          const line = createLine(
            deps.db,
            c.req.param('id'),
            c.get('user').id,
            c.req.valid('json'),
            deps.now(),
            deps.tz,
          )
          return activeLines(deps.db, line.budgetId).find((l) => l.id === line.id)!
        },
        201,
      ),
    )
}

export function budgetLinesRoutes(deps: AppDeps) {
  const withCategories = (lineId: string) => {
    const line = deps.db.select().from(s.budgetLines).where(eq(s.budgetLines.id, lineId)).get()!
    const categoryIds = deps.db
      .select({ id: s.budgetLineCategories.categoryId })
      .from(s.budgetLineCategories)
      .where(eq(s.budgetLineCategories.lineId, lineId))
      .all()
      .map((r) => r.id)
      .sort()
    return { ...line, categoryIds }
  }
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .patch('/:id', validate('json', LinePatch), (c) =>
      budgetJson(c, () => {
        const id = c.req.param('id')
        updateLine(deps.db, id, c.get('user').id, c.req.valid('json'), deps.now(), deps.tz)
        return withCategories(id)
      }),
    )
    .post('/:id/archive', (c) =>
      budgetJson(c, () => {
        const id = c.req.param('id')
        archiveLine(deps.db, id, c.get('user').id, deps.now(), deps.tz)
        return withCategories(id)
      }),
    )
}
