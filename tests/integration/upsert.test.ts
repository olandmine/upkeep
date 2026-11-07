import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import type { Db } from '../../src/server/db/client'
import * as s from '../../src/server/db/schema'
import { replaceTags, upsertAccounts, upsertCategories, upsertTransactions } from '../../src/server/sync/upsert'
import type { UpCategory } from '../../src/server/up/schemas'
import categories from '../fixtures/up/categories.json'
import { buildAccount, buildTransaction } from '../fake-up/builders'
import { createTestDb } from '../helpers/db'

let db: Db
const now = '2026-10-29T00:00:00.000Z'
const conn = { id: 'c1', userId: 'u1' }

beforeEach(() => {
  db = createTestDb()
  db.insert(s.users).values({ id: 'u1', username: 'owner', displayName: 'Owner', passwordHash: 'x', createdAt: now }).run()
  db.insert(s.upConnections).values({ id: 'c1', userId: 'u1', tokenCiphertext: 'v1:x', status: 'ok', createdAt: now }).run()
})

const tx = (id: string, extra: Partial<Parameters<typeof buildTransaction>[0]> = {}) =>
  buildTransaction({ id, accountId: 'acc-1', amountCents: -100, createdAt: '2026-10-28T00:00:00Z', ...extra })

test('sets owner for INDIVIDUAL, null for JOINT, keeps colour stable on update', () => {
  upsertAccounts(db, conn, [
    buildAccount({ id: 'acc-1', balanceCents: 1000 }),
    buildAccount({ id: 'acc-j', ownershipType: 'JOINT', balanceCents: 2000 }),
  ], now)
  const before = db.select().from(s.accounts).all()
  expect(before.map((a) => [a.id, a.ownerUserId, a.colorIndex])).toEqual([
    ['acc-1', 'u1', 0],
    ['acc-j', null, 1],
  ])
  upsertAccounts(db, conn, [buildAccount({ id: 'acc-j', ownershipType: 'JOINT', displayName: 'Bills', balanceCents: 2500 })], now)
  const joint = db.select().from(s.accounts).where(eq(s.accounts.id, 'acc-j')).get()
  expect(joint).toMatchObject({ displayName: 'Bills', balanceCents: 2500, colorIndex: 1 })
  expect(db.select().from(s.accountConnections).all()).toHaveLength(2)
})

test('upsert is idempotent and replaces tags', () => {
  upsertAccounts(db, conn, [buildAccount({ id: 'acc-1' })], now)
  expect(upsertTransactions(db, [tx('t1', { tags: ['a', 'b'] })], now)).toEqual({ upserted: 1, missingAccountIds: [] })
  upsertTransactions(db, [tx('t1', { tags: ['b'], amountCents: -250 })], now)
  expect(db.select().from(s.transactions).all()).toHaveLength(1)
  expect(db.select().from(s.transactions).get()?.amountCents).toBe(-250)
  expect(db.select().from(s.transactionTags).all().map((t) => t.label)).toEqual(['b'])
  expect(db.select().from(s.tags).all().map((t) => t.label).sort()).toEqual(['a', 'b'])
})

test('re-appearing transaction clears deletedAt', () => {
  upsertAccounts(db, conn, [buildAccount({ id: 'acc-1' })], now)
  upsertTransactions(db, [tx('t1')], now)
  db.update(s.transactions).set({ deletedAt: now }).run()
  upsertTransactions(db, [tx('t1')], now)
  expect(db.select().from(s.transactions).get()?.deletedAt).toBeNull()
})

test('returns missing account ids instead of failing', () => {
  upsertAccounts(db, conn, [buildAccount({ id: 'acc-1' })], now)
  const result = upsertTransactions(db, [tx('t1'), tx('t2', { accountId: 'acc-new' })], now)
  expect(result).toEqual({ upserted: 1, missingAccountIds: ['acc-new'] })
  expect(db.select().from(s.transactions).all().map((t) => t.id)).toEqual(['t1'])
})

test('marks transfers to stored accounts', () => {
  upsertAccounts(db, conn, [buildAccount({ id: 'acc-1' }), buildAccount({ id: 'acc-saver', accountType: 'SAVER' })], now)
  upsertTransactions(db, [tx('t1', { transferAccountId: 'acc-saver' })], now)
  expect(db.select().from(s.transactions).get()?.isTransfer).toBe(true)
})

test('upserts categories and the tag catalogue', () => {
  upsertCategories(db, categories as unknown as UpCategory[])
  const groceries = db.select().from(s.categories).where(eq(s.categories.id, 'groceries')).get()
  expect(groceries).toEqual({ id: 'groceries', name: 'Groceries', parentId: 'home' })
  replaceTags(db, ['x', 'y'])
  replaceTags(db, ['y'])
  expect(db.select().from(s.tags).all().map((t) => t.label)).toEqual(['y'])
})
