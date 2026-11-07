import { eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import * as s from '../db/schema'
import { transactionBudgetLine } from '../budgets/status'
import { transactionRepayment } from '../debts/repayments'
import { getTransaction, getVisibleTransaction, listTransactions } from '../queries/transactions'
import { pickConnectionForAccount } from '../sync/connections'
import type { UpClient } from '../up/client'
import { UpApiError, UpUnauthorizedError } from '../up/errors'
import { ScopeSchema } from './accounts'
import { validate } from './validate'

const MAX_TAGS = 6
const Cents = z.coerce.number().int().min(0)

const ListQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  accountId: z.string().optional(),
  scope: ScopeSchema.optional(),
  categoryId: z.string().optional(),
  categoryIds: z
    .string()
    .transform((v) => v.split(',').map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string()).min(1, 'categoryIds needs at least one category'))
    .optional(),
  tag: z.string().optional(),
  status: z.enum(['HELD', 'SETTLED']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  minCents: Cents.optional(),
  maxCents: Cents.optional(),
  includeTransfers: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: z.string().optional(),
})

const CategoryBody = z.object({ categoryId: z.string().min(1).nullable() })
const TagsBody = z.object({ labels: z.array(z.string().trim().min(1).max(50)).min(1).max(MAX_TAGS) })

export function transactionsRoutes(deps: AppDeps) {
  /** Up first, then local. Returns an error response, or null on success. */
  async function writeToUp(c: Context<AppEnv>, accountId: string, write: (client: UpClient) => Promise<void>) {
    const conn = pickConnectionForAccount(deps.db, accountId, c.get('user').id)
    if (!conn) return c.json({ error: 'No connected Up token can edit this account' }, 409)
    try {
      await write(deps.engine.clientForConnection(conn))
      return null
    } catch (err) {
      if (err instanceof UpUnauthorizedError) {
        deps.db.update(s.upConnections)
          .set({ status: 'unauthorized', lastError: 'Up rejected the token' })
          .where(eq(s.upConnections.id, conn.id))
          .run()
        return c.json({ error: "Couldn't update Up", detail: 'Up rejected the token' }, 502)
      }
      if (err instanceof UpApiError) return c.json({ error: "Couldn't update Up", detail: err.detail }, 502)
      throw err
    }
  }

  function replaceLocalTags(txId: string, labels: string[]) {
    deps.db.transaction((tx) => {
      tx.delete(s.transactionTags).where(eq(s.transactionTags.transactionId, txId)).run()
      for (const label of labels) {
        tx.insert(s.transactionTags).values({ transactionId: txId, label }).run()
        tx.insert(s.tags).values({ label }).onConflictDoNothing().run()
      }
    })
  }

  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', validate('query', ListQuery), (c) =>
      c.json(listTransactions(deps.db, { ...c.req.valid('query'), userId: c.get('user').id }), 200),
    )
    .get('/:id', (c) => {
      const tx = getVisibleTransaction(deps.db, c.req.param('id'), c.get('user').id)
      return tx ? c.json(tx, 200) : c.json({ error: 'Transaction not found' }, 404)
    })
    .get('/:id/budget-line', (c) => {
      const transactionId = c.req.param('id')
      if (!getVisibleTransaction(deps.db, transactionId, c.get('user').id)) return c.json({ error: 'Transaction not found' }, 404)
      return c.json(transactionBudgetLine(deps.db, { transactionId, viewerId: c.get('user').id, tz: deps.tz }), 200)
    })
    .get('/:id/repayment', (c) => {
      const transactionId = c.req.param('id')
      if (!getVisibleTransaction(deps.db, transactionId, c.get('user').id)) return c.json({ error: 'Transaction not found' }, 404)
      return c.json(transactionRepayment(deps.db, transactionId, c.get('user').id, deps.tz), 200)
    })
    .patch('/:id/category', validate('json', CategoryBody), async (c) => {
      const tx = getVisibleTransaction(deps.db, c.req.param('id'), c.get('user').id)
      if (!tx) return c.json({ error: 'Transaction not found' }, 404)
      if (!tx.isCategorizable) return c.json({ error: "Up doesn't allow this transaction to be categorised." }, 409)
      const { categoryId } = c.req.valid('json')
      const category = categoryId
        ? deps.db.select().from(s.categories).where(eq(s.categories.id, categoryId)).get()
        : null
      if (categoryId && (!category || category.parentId === null)) return c.json({ error: 'Unknown category' }, 400)

      const failed = await writeToUp(c, tx.accountId, (client) => client.setCategory(tx.id, categoryId))
      if (failed) return failed
      deps.db.update(s.transactions)
        .set({ categoryId, parentCategoryId: category?.parentId ?? null })
        .where(eq(s.transactions.id, tx.id))
        .run()
      return c.json(getTransaction(deps.db, tx.id)!, 200)
    })
    .post('/:id/tags', validate('json', TagsBody), async (c) => {
      const tx = getVisibleTransaction(deps.db, c.req.param('id'), c.get('user').id)
      if (!tx) return c.json({ error: 'Transaction not found' }, 404)
      const labels = [...new Set(c.req.valid('json').labels)]
      const next = [...new Set([...tx.tags, ...labels])]
      if (next.length > MAX_TAGS) return c.json({ error: 'Up allows up to 6 tags per transaction.' }, 400)
      const failed = await writeToUp(c, tx.accountId, (client) => client.addTags(tx.id, labels))
      if (failed) return failed
      replaceLocalTags(tx.id, next)
      return c.json(getTransaction(deps.db, tx.id)!, 200)
    })
    .delete('/:id/tags', validate('json', TagsBody), async (c) => {
      const tx = getVisibleTransaction(deps.db, c.req.param('id'), c.get('user').id)
      if (!tx) return c.json({ error: 'Transaction not found' }, 404)
      const labels = new Set(c.req.valid('json').labels)
      const failed = await writeToUp(c, tx.accountId, (client) => client.removeTags(tx.id, [...labels]))
      if (failed) return failed
      replaceLocalTags(
        tx.id,
        tx.tags.filter((t) => !labels.has(t)),
      )
      return c.json(getTransaction(deps.db, tx.id)!, 200)
    })
}
