import { beforeEach, expect, test } from 'vitest'
import type { Db } from '../../src/server/db/client'
import { listTransactions } from '../../src/server/queries/transactions'
import { createTestDb } from '../helpers/db'
import { seedAccount, seedTx, seedUser } from '../helpers/budget-seed'

let db: Db
const T0 = '2026-11-04T01:00:00.000Z'
const before = (seconds: number) => new Date(Date.parse(T0) - seconds * 1000).toISOString()

beforeEach(() => {
  db = createTestDb()
  seedUser(db, 'u1')
  seedAccount(db, { id: 'spending', owner: 'u1' })
  seedAccount(db, { id: 'saver', owner: 'u1', type: 'SAVER' })
})

const purchase = (id: string, seconds: number) =>
  seedTx(db, { id, accountId: 'spending', amountCents: -1000, createdAt: before(seconds) })
const transferOut = (id: string, seconds: number) =>
  seedTx(db, { id, accountId: 'spending', amountCents: -5000, createdAt: before(seconds), transferAccountId: 'saver' })
const transferIn = (id: string, seconds: number) =>
  seedTx(db, { id, accountId: 'saver', amountCents: 5000, createdAt: before(seconds), transferAccountId: 'spending' })

const list = (limit: number, over: { accountId?: string; cursor?: string } = {}) =>
  listTransactions(db, { userId: 'u1', limit, ...over })
const ids = (page: ReturnType<typeof list>) => page.items.map((t) => t.id)

test('a page runs on rather than splitting a transfer', () => {
  purchase('p1', 0)
  transferOut('out', 10)
  transferIn('in', 11)
  purchase('p2', 500)

  const first = list(2)
  expect(ids(first)).toEqual(['p1', 'out', 'in'])
  expect(first.nextCursor).not.toBeNull()
  expect(ids(list(2, { cursor: first.nextCursor! }))).toEqual(['p2'])
})

test('rows between the two sides come along, in order', () => {
  purchase('p1', 0)
  transferOut('out', 10)
  purchase('between', 12)
  transferIn('in', 14)

  expect(ids(list(2))).toEqual(['p1', 'out', 'between', 'in'])
})

test('reports no more pages when the extended page reaches the end', () => {
  purchase('p1', 0)
  transferOut('out', 10)
  transferIn('in', 11)

  expect(list(2).nextCursor).toBeNull()
})

test('reports more pages when older rows sit outside the 60 seconds it looked through', () => {
  transferOut('out', 0)
  transferIn('in', 1)
  purchase('old', 5000)

  const first = list(1)
  expect(ids(first)).toEqual(['out', 'in'])
  expect(ids(list(1, { cursor: first.nextCursor! }))).toEqual(['old'])
})

test('walking every page returns each row once, in order, with no transfer split', () => {
  const expected: string[] = []
  for (let i = 0; i < 12; i++) {
    transferOut(`out-${i}`, i * 100)
    transferIn(`in-${i}`, i * 100 + 1)
    purchase(`p-${i}`, i * 100 + 50)
    expected.push(`out-${i}`, `in-${i}`, `p-${i}`)
  }

  const seen: string[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 40; guard++) {
    const page = list(2, cursor ? { cursor } : {})
    const pageIds = ids(page)
    for (const id of pageIds.filter((x) => x.startsWith('out-'))) expect(pageIds).toContain(id.replace('out', 'in'))
    seen.push(...pageIds)
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  expect(seen).toEqual(expected)
})

test('a page stays at its limit when the other side is filtered out', () => {
  transferOut('out-1', 0)
  transferIn('in-1', 1)
  transferOut('out-2', 2)
  transferIn('in-2', 3)

  const page = list(1, { accountId: 'spending' })
  expect(ids(page)).toEqual(['out-1'])
  expect(ids(list(1, { accountId: 'spending', cursor: page.nextCursor! }))).toEqual(['out-2'])
})

test('a page stays at its limit when the next row is not the other side', () => {
  purchase('p1', 0)
  purchase('p2', 1)
  purchase('p3', 2)
  expect(ids(list(2))).toEqual(['p1', 'p2'])
})

test('a page stays at its limit for sides over 60 seconds apart, and for a Round Up with no other side', () => {
  transferOut('out', 0)
  transferIn('in', 61)
  expect(ids(list(1))).toEqual(['out'])

  seedTx(db, { id: 'round-up', accountId: 'saver', amountCents: 40, createdAt: new Date(Date.parse(T0) + 5000).toISOString(), transferAccountId: 'spending', transactionType: 'Round Up' })
  expect(ids(list(1))).toEqual(['round-up'])
})
