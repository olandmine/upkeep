import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { UNCATEGORISED } from '../../shared/categories'
import { pairTransfers, TRANSFER_PAIR_WINDOW_MS, type TransferLeg } from '../../shared/transfers'
import type { TransactionDto, TransactionPage, TxFilters } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { canSeeAccount } from '../sharing/policy'
import { scopeAccountIds } from './scope'

const DEFAULT_LIMIT = 50

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

const encodeCursor = (createdAt: string, id: string) => Buffer.from(JSON.stringify([createdAt, id])).toString('base64url')

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    return Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' ? [v[0], v[1]] : null
  } catch {
    return null
  }
}

const t = s.transactions

/** Builds the WHERE clause; returns null when the viewer can see no accounts in scope (nothing can match). */
function conditions(db: Db, f: TxFilters & { userId: string }): SQL[] | null {
  const where: SQL[] = [isNull(t.deletedAt)]
  const ids = scopeAccountIds(db, f.scope ?? 'everyone', f.userId, 'transactions')
  if (!ids.length) return null
  where.push(inArray(t.accountId, ids))
  if (f.accountId) where.push(eq(t.accountId, f.accountId))
  if (f.q) {
    const pattern = `%${escapeLike(f.q)}%`
    where.push(
      sql`(${t.description} LIKE ${pattern} ESCAPE '\\' OR ${t.rawText} LIKE ${pattern} ESCAPE '\\' OR ${t.message} LIKE ${pattern} ESCAPE '\\')`,
    )
  }
  if (f.categoryId === UNCATEGORISED) {
    where.push(isNull(t.categoryId), eq(t.isTransfer, false), eq(t.isCategorizable, true), lt(t.amountCents, 0))
  } else if (f.categoryId) {
    where.push(or(eq(t.categoryId, f.categoryId), eq(t.parentCategoryId, f.categoryId))!)
  }
  if (f.categoryIds?.length) where.push(or(inArray(t.categoryId, f.categoryIds), inArray(t.parentCategoryId, f.categoryIds))!)
  if (f.tag) {
    where.push(
      inArray(
        t.id,
        db.select({ id: s.transactionTags.transactionId }).from(s.transactionTags).where(eq(s.transactionTags.label, f.tag)),
      ),
    )
  }
  if (f.status) where.push(eq(t.status, f.status))
  if (f.from) where.push(gte(t.createdAt, f.from))
  if (f.to) where.push(lt(t.createdAt, f.to))
  if (f.minCents !== undefined) where.push(sql`abs(${t.amountCents}) >= ${f.minCents}`)
  if (f.maxCents !== undefined) where.push(sql`abs(${t.amountCents}) <= ${f.maxCents}`)
  if (f.includeTransfers === false) where.push(eq(t.isTransfer, false))
  return where
}

function tagsFor(db: Db, ids: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!ids.length) return map
  const rows = db
    .select()
    .from(s.transactionTags)
    .where(inArray(s.transactionTags.transactionId, ids))
    .orderBy(s.transactionTags.label)
    .all()
  for (const r of rows) map.set(r.transactionId, [...(map.get(r.transactionId) ?? []), r.label])
  return map
}

function selectWithAccount(db: Db) {
  return db
    .select({ tx: t, accountName: s.accounts.displayName })
    .from(t)
    .innerJoin(s.accounts, eq(s.accounts.id, t.accountId))
}

function toDto(row: { tx: typeof t.$inferSelect; accountName: string }, tags: string[]): TransactionDto {
  const { rawJson: _raw, syncedAt: _synced, ...rest } = row.tx
  return { ...rest, accountName: row.accountName, tags }
}

export function listTransactions(
  db: Db,
  f: TxFilters & { userId: string; cursor?: string; limit?: number },
): TransactionPage {
  const where = conditions(db, f)
  if (!where) return { items: [], nextCursor: null }
  const olderThan = (createdAt: string, id: string) =>
    or(lt(t.createdAt, createdAt), and(eq(t.createdAt, createdAt), lt(t.id, id)))!
  const after = f.cursor ? decodeCursor(f.cursor) : null
  if (after) where.push(olderThan(after[0], after[1]))
  const select = (...more: SQL[]) =>
    selectWithAccount(db)
      .where(and(...where, ...more))
      .orderBy(desc(t.createdAt), desc(t.id))

  const limit = f.limit ?? DEFAULT_LIMIT
  const rows = select()
    .limit(limit + 1)
    .all()
  let page = rows
  let nextCursor: string | null = null
  if (rows.length > limit) {
    // Runs on past the limit rather than leave a transfer's other side for the next page.
    const last = rows[limit - 1].tx
    const windowStart = new Date(Date.parse(last.createdAt) - TRANSFER_PAIR_WINDOW_MS).toISOString()
    const nearby = select(olderThan(last.createdAt, last.id), gte(t.createdAt, windowStart)).all()
    const candidates = [...rows.slice(0, limit), ...nearby]
    page = candidates.slice(0, pageEnd(candidates.map((r) => r.tx), limit))
    const end = page.at(-1)!.tx
    const hasMore = page.length < candidates.length || select(olderThan(end.createdAt, end.id)).limit(1).all().length > 0
    nextCursor = hasMore ? encodeCursor(end.createdAt, end.id) : null
  }
  const tags = tagsFor(db, page.map((r) => r.tx.id))
  return { items: page.map((r) => toDto(r, tags.get(r.tx.id) ?? [])), nextCursor }
}

/** The first row count from `limit` up that cuts no transfer in two. */
function pageEnd(rows: TransferLeg[], limit: number): number {
  const position = new Map(rows.map((r, i) => [r.id, i]))
  const spans = pairTransfers(rows).map(([from, to]) => {
    const [a, b] = [position.get(from.id)!, position.get(to.id)!]
    return [Math.min(a, b), Math.max(a, b)] as const
  })
  let end = limit
  for (let moved = true; moved; ) {
    moved = false
    for (const [first, second] of spans) {
      if (first < end && second >= end) {
        end = second + 1
        moved = true
      }
    }
  }
  return end
}

export function getTransaction(db: Db, id: string): TransactionDto | null {
  const row = selectWithAccount(db).where(eq(t.id, id)).get()
  return row ? toDto(row, tagsFor(db, [id]).get(id) ?? []) : null
}

/** `getTransaction`, or null when the viewer may not see the transaction's account. Use it for anything a request reaches. */
export function getVisibleTransaction(db: Db, id: string, viewerId: string): TransactionDto | null {
  const row = db
    .select({ ownership: s.accounts.ownership, ownerUserId: s.accounts.ownerUserId })
    .from(t)
    .innerJoin(s.accounts, eq(s.accounts.id, t.accountId))
    .where(eq(t.id, id))
    .get()
  return row && canSeeAccount(db, viewerId, row, 'transactions') ? getTransaction(db, id) : null
}
