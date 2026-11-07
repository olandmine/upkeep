import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../app'
import type { DebtEntryInputDto } from '../../shared/types'
import { requireUser } from '../auth/middleware'
import { addDays, todayLocal } from '../budgets/dates'
import {
  addBalance,
  createDebt,
  debtsInScope,
  deleteDebt,
  requireVisibleDebt,
  removeBalance,
  toDebtDetailDto,
  toDebtDto,
  updateDebt,
} from '../debts/debts'
import {
  addEntry,
  addRate,
  clearInterestEdit,
  deleteEntry,
  removeRate,
  setInterestEdit,
  updateEntry,
} from '../debts/entries'
import { createHelpDebt, importHelpStatement, previewHelpStatement } from '../debts/help-import'
import { getPayoffPlan, putPayoffSettings } from '../debts/payoff-plan'
import {
  excludeRepayment,
  markRepayment,
  removeRepaymentRule,
  undoRepaymentExclusion,
} from '../debts/repayments'
import { ScopeSchema } from './accounts'
import { budgetJson, budgetNoContent } from './budgets'
import { validate } from './validate'

const RATE = 'Rate must be between 0% and 100%.'
const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates look like 2026-10-30')
const Cents = z.number().int().min(0)
const FeeBody = z.object({
  amountCents: z.number().int().min(1, 'Fee must be more than $0.'),
  frequency: z.enum(['weekly', 'fortnightly', 'monthly', 'yearly']),
  from: LocalDateSchema.refine((d) => addDays(d, 0) === d, 'Pick a real date.'),
})

/** Checked further by validateInterest: the day or date its charging needs. */
const InterestBody = z.object({
  calc: z.enum(['daily', 'on_charge']),
  charge: z.enum(['daily', 'monthly', 'yearly']),
  chargeDay: z.number().int().nullable(),
  chargeDate: z.string().nullable(),
})
const DebtFields = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  repaymentCents: Cents,
  repaymentFrequency: z.enum(['weekly', 'fortnightly', 'monthly']),
  interest: InterestBody.optional(),
  fee: FeeBody.nullable().optional(),
})
const DebtBody = DebtFields.extend({
  kind: z.enum(['loan', 'credit_card', 'bnpl', 'ato', 'hecs']),
  ownerUserId: z.string().min(1).nullable(),
  rateBp: z.number().int().min(0, RATE).max(10_000, RATE),
  balanceCents: Cents,
  asOf: LocalDateSchema,
})
const BalanceBody = z.object({ balanceCents: Cents, asOf: LocalDateSchema })
const RateBody = z.object({
  fromDate: LocalDateSchema,
  rateBp: z.number().int().min(0, RATE).max(10_000, RATE),
})
const EntryBody = z.object({
  kind: z.enum(['added', 'payment']),
  date: LocalDateSchema,
  amountCents: z.number().int().min(1, 'Amount must be more than $0.'),
  note: z.string().trim().max(100, 'Keep the note under 100 characters.').nullish(),
})
const InterestEditBody = z.object({ amountCents: z.number().int().min(0, "Interest can't be negative.") })
const ChargeDateParam = z.object({ chargeDate: LocalDateSchema })
const TransactionBody = z.object({ transactionId: z.string().min(1) })
const MarkBody = TransactionBody.extend({ matchFuture: z.boolean() })
const Csv = z
  .string()
  .min(1, "That isn't an ATO HELP statement. Download the CSV from your ATO HELP account.")
  .max(500_000, 'That file is too big for an ATO HELP statement.')
const ImportBody = z.object({ csv: Csv, dryRun: z.boolean() })
const StatementDebtBody = DebtFields.omit({ interest: true, fee: true }).extend({
  ownerUserId: z.string().min(1).nullable(),
  rateBp: z.number().int().min(0, RATE).max(10_000, RATE),
  csv: Csv,
})

const entryInput = (body: z.infer<typeof EntryBody>): DebtEntryInputDto => ({ ...body, note: body.note ?? null })

export function debtsRoutes(deps: AppDeps) {
  const today = () => todayLocal(deps.now(), deps.tz)
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', validate('query', z.object({ scope: ScopeSchema.default('everyone') })), (c) => {
      const viewer = c.get('user').id
      return c.json(
        debtsInScope(deps.db, c.req.valid('query').scope, viewer).map((d) =>
          toDebtDto(deps.db, d, viewer, today(), deps.tz),
        ),
        200,
      )
    })
    .post('/', validate('json', DebtBody), (c) =>
      budgetJson(
        c,
        () => {
          const viewer = c.get('user').id
          const debt = createDebt(deps.db, c.req.valid('json'), viewer, deps.now(), today())
          return toDebtDto(deps.db, debt, viewer, today(), deps.tz)
        },
        201,
      ),
    )
    .post('/statement/preview', validate('json', z.object({ csv: Csv })), (c) =>
      budgetJson(c, () => previewHelpStatement(c.req.valid('json').csv, today())),
    )
    .post('/statement', validate('json', StatementDebtBody), (c) =>
      budgetJson(
        c,
        () => {
          const viewer = c.get('user').id
          const debt = createHelpDebt(deps.db, c.req.valid('json'), viewer, deps.now(), today())
          return toDebtDto(deps.db, debt, viewer, today(), deps.tz)
        },
        201,
      ),
    )
    .get('/:id', (c) =>
      budgetJson(c, () =>
        toDebtDetailDto(deps.db, requireVisibleDebt(deps.db, c.req.param('id'), c.get('user').id), c.get('user').id, today(), deps.tz),
      ),
    )
    .patch('/:id', validate('json', DebtFields.partial()), (c) =>
      budgetJson(c, () => {
        const viewer = c.get('user').id
        const debt = updateDebt(deps.db, c.req.param('id'), c.req.valid('json'), viewer, deps.now())
        return toDebtDto(deps.db, debt, viewer, today(), deps.tz)
      }),
    )
    .delete('/:id', (c) => budgetNoContent(c, () => deleteDebt(deps.db, c.req.param('id'), c.get('user').id, today(), deps.tz)))
    .post('/:id/balances', validate('json', BalanceBody), (c) =>
      budgetNoContent(c, () =>
        addBalance(deps.db, c.req.param('id'), c.req.valid('json'), c.get('user').id, deps.now(), today()),
      ),
    )
    .delete('/:id/balances/:balanceId', (c) =>
      budgetNoContent(c, () =>
        removeBalance(deps.db, c.req.param('id'), c.req.param('balanceId'), c.get('user').id),
      ),
    )
    .post('/:id/rates', validate('json', RateBody), (c) =>
      budgetNoContent(c, () =>
        addRate(deps.db, c.req.param('id'), c.req.valid('json'), c.get('user').id, deps.now()),
      ),
    )
    .delete('/:id/rates/:rateId', (c) =>
      budgetNoContent(c, () => removeRate(deps.db, c.req.param('id'), c.req.param('rateId'), c.get('user').id)),
    )
    .post('/:id/entries', validate('json', EntryBody), (c) =>
      budgetNoContent(c, () =>
        addEntry(
          deps.db,
          c.req.param('id'),
          entryInput(c.req.valid('json')),
          c.get('user').id,
          deps.now(),
          today(),
        ),
      ),
    )
    .patch('/:id/entries/:entryId', validate('json', EntryBody), (c) =>
      budgetNoContent(c, () =>
        updateEntry(
          deps.db,
          c.req.param('id'),
          c.req.param('entryId'),
          entryInput(c.req.valid('json')),
          c.get('user').id,
          deps.now(),
          today(),
        ),
      ),
    )
    .delete('/:id/entries/:entryId', (c) =>
      budgetNoContent(c, () =>
        deleteEntry(deps.db, c.req.param('id'), c.req.param('entryId'), c.get('user').id),
      ),
    )
    .put('/:id/interest/:chargeDate', validate('param', ChargeDateParam), validate('json', InterestEditBody), (c) =>
      budgetNoContent(c, () =>
        setInterestEdit(
          deps.db,
          c.req.param('id'),
          c.req.valid('param').chargeDate,
          c.req.valid('json').amountCents,
          c.get('user').id,
          today(),
        ),
      ),
    )
    .delete('/:id/interest/:chargeDate', validate('param', ChargeDateParam), (c) =>
      budgetNoContent(c, () =>
        clearInterestEdit(deps.db, c.req.param('id'), c.req.valid('param').chargeDate, c.get('user').id),
      ),
    )
    .post('/:id/import', validate('json', ImportBody), (c) =>
      budgetJson(c, () => {
        const { csv, dryRun } = c.req.valid('json')
        return importHelpStatement(deps.db, c.req.param('id'), csv, dryRun, c.get('user').id, deps.now(), today())
      }),
    )
    .post('/:id/repayments', validate('json', MarkBody), (c) =>
      budgetNoContent(c, () => {
        const { transactionId, matchFuture } = c.req.valid('json')
        markRepayment(deps.db, c.req.param('id'), transactionId, matchFuture, c.get('user').id)
      }),
    )
    .delete('/:id/repayment-rules/:ruleId', (c) =>
      budgetNoContent(c, () =>
        removeRepaymentRule(deps.db, c.req.param('id'), c.req.param('ruleId'), c.get('user').id),
      ),
    )
    .post('/:id/exclusions', validate('json', TransactionBody), (c) =>
      budgetNoContent(c, () =>
        excludeRepayment(deps.db, c.req.param('id'), c.req.valid('json').transactionId, c.get('user').id),
      ),
    )
    .delete('/:id/exclusions/:transactionId', (c) =>
      budgetNoContent(c, () =>
        undoRepaymentExclusion(deps.db, c.req.param('id'), c.req.param('transactionId'), c.get('user').id),
      ),
    )
}

const ScopeQuery = z.object({ scope: ScopeSchema.default('everyone') })
const PayoffBody = z.object({ extraCents: Cents, includeHecs: z.boolean() })

/** Mounted at /api/payoff-plan: one plan per scope. */
export function payoffRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', validate('query', ScopeQuery), (c) =>
      budgetJson(c, () =>
        getPayoffPlan(
          deps.db,
          c.req.valid('query').scope,
          c.get('user').id,
          todayLocal(deps.now(), deps.tz),
          deps.tz,
        ),
      ),
    )
    .put('/', validate('query', ScopeQuery), validate('json', PayoffBody), (c) =>
      budgetNoContent(c, () =>
        putPayoffSettings(deps.db, c.req.valid('query').scope, c.get('user').id, c.req.valid('json')),
      ),
    )
}
