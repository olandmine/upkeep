import { eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { PayCandidateDto, PayEventDto, PayScheduleDto } from '../../shared/types'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import {
  createScheduleFromTransaction,
  deleteSchedule,
  excludePayEvent,
  getSchedule,
  listExclusions,
  listPayEvents,
  payCandidates,
  undoExclusion,
  updateSchedule,
} from '../budgets/pay-schedule'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { PayEventRow, PayScheduleRow } from '../db/schema'
import { canSee, requireVisibleUser } from '../sharing/policy'
import { getTransaction } from '../queries/transactions'
import { budgetJson, budgetNoContent } from './budgets'
import { validate } from './validate'

const ScheduleBody = z.union([
  z.object({ transactionId: z.string().min(1) }),
  z.object({ descriptionMatch: z.string().trim().min(1).max(200), minAmountCents: z.number().int().min(1) }),
])

function toScheduleDto(db: Db, row: PayScheduleRow): PayScheduleDto {
  const account = db.select().from(s.accounts).where(eq(s.accounts.id, row.accountId)).get()
  return {
    userId: row.userId,
    accountId: row.accountId,
    accountName: account?.displayName ?? null,
    accountMissing: !account,
    descriptionMatch: row.descriptionMatch,
    minAmountCents: row.minAmountCents,
    frequencyDays: row.frequencyDays,
  }
}

function toEventDtos(db: Db, rows: PayEventRow[], showTransactionIds: boolean): PayEventDto[] {
  const extras = rows.map((r) => JSON.parse(r.extraTxIdsJson) as string[])
  const ids = extras.flat()
  const amounts = new Map(
    ids.length
      ? db
          .select({ id: s.transactions.id, cents: s.transactions.amountCents })
          .from(s.transactions)
          .where(inArray(s.transactions.id, ids))
          .all()
          .map((r) => [r.id, r.cents])
      : [],
  )
  return rows.map((r, i) => ({
    payDate: r.payDate,
    source: r.source,
    transactionId: showTransactionIds ? r.transactionId : null,
    amountCents: r.amountCents,
    extraCents: extras[i].reduce((sum, id) => sum + (amounts.get(id) ?? 0), 0),
    payNotSeen: r.source === 'scheduled' && r.transactionId === null,
  }))
}

/** Mounted at /api, so auth is per route (a router-wide .use() would also guard /api/setup). */
export function payRoutes(deps: AppDeps) {
  const auth = requireUser(deps)
  return new Hono<AppEnv>()
    .get('/pay-candidates', auth, (c) => {
      const candidates: PayCandidateDto[] = payCandidates(deps.db, c.get('user').id, deps.now()).flatMap(
        (p) => {
          const transaction = getTransaction(deps.db, p.transactionId)
          return transaction ? [{ transaction, sameDescriptionCount: p.sameDescriptionCount }] : []
        },
      )
      return c.json(candidates, 200)
    })
    .get('/pay-schedule', auth, (c) => {
      const row = getSchedule(deps.db, c.get('user').id)
      return c.json(row ? toScheduleDto(deps.db, row) : null, 200)
    })
    .put('/pay-schedule', auth, validate('json', ScheduleBody), (c) =>
      budgetJson(c, () => {
        const body = c.req.valid('json')
        const userId = c.get('user').id
        const row =
          'transactionId' in body
            ? createScheduleFromTransaction(deps.db, userId, body.transactionId, deps.now(), deps.tz)
            : updateSchedule(deps.db, userId, body, deps.now(), deps.tz)
        return toScheduleDto(deps.db, row)
      }),
    )
    .delete('/pay-schedule', auth, (c) => budgetNoContent(c, () => deleteSchedule(deps.db, c.get('user').id)))
    .get('/pay-events', auth, validate('query', z.object({ userId: z.string().min(1).optional() })), (c) =>
      budgetJson(c, () => {
        const viewerId = c.get('user').id
        const userId = c.req.valid('query').userId ?? viewerId
        requireVisibleUser(deps.db, viewerId, userId)
        // Without `transactions` the event still shows, but not the deposit it came from.
        const showIds = canSee(deps.db, viewerId, userId, 'transactions')
        return toEventDtos(deps.db, listPayEvents(deps.db, userId), showIds)
      }),
    )
    .delete('/pay-events/:payDate', auth, (c) =>
      budgetNoContent(c, () =>
        excludePayEvent(deps.db, c.get('user').id, c.req.param('payDate'), deps.now(), deps.tz),
      ),
    )
    .get('/pay-exclusions', auth, (c) =>
      c.json(
        listExclusions(deps.db, c.get('user').id).flatMap((id) => getTransaction(deps.db, id) ?? []),
        200,
      ),
    )
    .delete('/pay-exclusions/:transactionId', auth, (c) =>
      budgetNoContent(c, () =>
        undoExclusion(deps.db, c.get('user').id, c.req.param('transactionId'), deps.now(), deps.tz),
      ),
    )
}
