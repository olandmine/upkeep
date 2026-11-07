import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import { upsertAccounts, upsertCategories, upsertTransactions } from '../../src/server/sync/upsert'
import type { UpCategory } from '../../src/server/up/schemas'
import categories from '../fixtures/up/categories.json'
import { createTestApp, type TestApp } from '../helpers/app'

let t: TestApp
let owner: string
let partner: string
let ownerId: string
let partnerId: string
const NOW = '2026-10-29T00:00:00.000Z'

type TxInput = Parameters<TestApp['buildTransaction']>[0]
const tx = (p: Partial<TxInput> & { id: string }) =>
  t.buildTransaction({ accountId: 'acc-me', amountCents: -1000, createdAt: '2026-10-20T00:00:00Z', ...p })
const seed = (...txs: ReturnType<typeof tx>[]) => upsertTransactions(t.db, txs, NOW)

async function get(path: string, cookie = owner) {
  const res = await t.json(path, { cookie })
  expect(res.status).toBe(200)
  return res.json()
}

beforeEach(async () => {
  t = createTestApp()
  owner = await t.setupOwner()
  partner = await t.addPartner(owner)
  ownerId = (await get('/api/me')).id
  partnerId = (await get('/api/me', partner)).id
  for (const [id, userId] of [['c-owner', ownerId], ['c-partner', partnerId]]) {
    t.db.insert(s.upConnections).values({ id, userId, tokenCiphertext: 'v1:x', status: 'ok', createdAt: NOW }).run()
  }
  upsertAccounts(t.db, { id: 'c-owner', userId: ownerId }, [
    t.buildAccount({ id: 'acc-me', displayName: 'Spending', balanceCents: 1000 }),
    t.buildAccount({ id: 'acc-j', displayName: '2Up', ownershipType: 'JOINT', balanceCents: 3000 }),
  ])
  upsertAccounts(t.db, { id: 'c-partner', userId: partnerId }, [
    t.buildAccount({ id: 'acc-p', displayName: 'Partner Spending', balanceCents: 2000 }),
    t.buildAccount({ id: 'acc-j', displayName: '2Up', ownershipType: 'JOINT', balanceCents: 3000 }),
  ])
  upsertCategories(t.db, categories as unknown as UpCategory[])
})

const ids = (page: { items: { id: string }[] }) => page.items.map((i) => i.id)

test('scopes accounts by ownership', async () => {
  const names = async (scope: string, cookie = owner) =>
    (await get(`/api/accounts?scope=${scope}`, cookie)).map((a: { id: string }) => a.id).sort()
  expect(await names('everyone')).toEqual(['acc-j', 'acc-me', 'acc-p'])
  expect(await names('me')).toEqual(['acc-me'])
  expect(await names('partner')).toEqual(['acc-p'])
  expect(await names('joint')).toEqual(['acc-j'])
  expect(await names('me', partner)).toEqual(['acc-p'])
  const me = (await get('/api/accounts?scope=me'))[0]
  expect(me).toMatchObject({ displayName: 'Spending', ownership: 'INDIVIDUAL', ownerUserId: ownerId, ownerName: 'Owner', balanceCents: 1000, currency: 'AUD' })
  expect(await get('/api/accounts/acc-j')).toMatchObject({ ownership: 'JOINT', ownerUserId: null, ownerName: null })
  expect((await t.json('/api/accounts/nope', { cookie: owner })).status).toBe(404)
})

test('scopes transactions by ownership', async () => {
  seed(tx({ id: 'mine' }), tx({ id: 'theirs', accountId: 'acc-p' }), tx({ id: 'ours', accountId: 'acc-j' }))
  expect(ids(await get('/api/transactions?scope=me'))).toEqual(['mine'])
  expect(ids(await get('/api/transactions?scope=partner'))).toEqual(['theirs'])
  expect(ids(await get('/api/transactions?scope=joint'))).toEqual(['ours'])
  expect(ids(await get('/api/transactions')).sort()).toEqual(['mine', 'ours', 'theirs'])
})

test('partner scope is empty with one user', async () => {
  const solo = createTestApp()
  const cookie = await solo.setupOwner()
  expect(await (await solo.json('/api/accounts?scope=partner', { cookie })).json()).toEqual([])
  expect(await (await solo.json('/api/transactions?scope=partner', { cookie })).json()).toEqual({ items: [], nextCursor: null })
})

test('keyset pagination has no gaps or duplicates', async () => {
  const many = Array.from({ length: 120 }, (_, i) =>
    tx({ id: `t${String(i).padStart(3, '0')}`, createdAt: i < 10 ? '2026-10-01T00:00:00Z' : new Date(Date.parse('2026-01-01T00:00:00Z') + i * 3_600_000).toISOString() }),
  )
  seed(...many)
  const seen: string[] = []
  const sizes: number[] = []
  let cursor: string | null = null
  do {
    const page: { items: { id: string }[]; nextCursor: string | null } = await get(
      `/api/transactions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    )
    sizes.push(page.items.length)
    seen.push(...ids(page))
    cursor = page.nextCursor
  } while (cursor)
  expect(sizes).toEqual([50, 50, 20])
  expect(new Set(seen).size).toBe(120)
})

test('search treats % and _ literally', async () => {
  seed(
    tx({ id: 'pct', description: '100% Juice' }),
    tx({ id: 'zero', description: '1000 Juice' }),
    tx({ id: 'abc', description: 'abc store' }),
    tx({ id: 'raw', description: 'Shop', rawText: 'SQ *COFFEE' }),
    tx({ id: 'msg', description: 'Transfer', message: 'rent for nov' }),
  )
  expect(ids(await get(`/api/transactions?q=${encodeURIComponent('100%')}`))).toEqual(['pct'])
  expect(ids(await get('/api/transactions?q=a_c'))).toEqual([])
  expect(ids(await get('/api/transactions?q=coffee'))).toEqual(['raw'])
  expect(ids(await get('/api/transactions?q=RENT'))).toEqual(['msg'])
})

test('category filter matches child or parent', async () => {
  seed(
    tx({ id: 'g', categoryId: 'groceries', parentCategoryId: 'home' }),
    tx({ id: 'f', categoryId: 'fuel', parentCategoryId: 'transport' }),
  )
  expect(ids(await get('/api/transactions?categoryId=home'))).toEqual(['g'])
  expect(ids(await get('/api/transactions?categoryId=fuel'))).toEqual(['f'])
})

test('categoryIds filter matches any of several categories or parents', async () => {
  seed(
    tx({ id: 'g', categoryId: 'groceries', parentCategoryId: 'home' }),
    tx({ id: 'f', categoryId: 'fuel', parentCategoryId: 'transport' }),
    tx({ id: 'r', categoryId: 'takeaway', parentCategoryId: 'good-life' }),
    tx({ id: 'u', categoryId: 'utilities', parentCategoryId: 'home' }),
  )
  expect(ids(await get('/api/transactions?categoryIds=groceries,fuel')).sort()).toEqual(['f', 'g'])
  expect(ids(await get('/api/transactions?categoryIds=home')).sort()).toEqual(['g', 'u'])
  expect((await t.json('/api/transactions?categoryIds=,', { cookie: owner })).status).toBe(400)
})

test('excludes deleted and optionally transfers; filters by tag, status, account and date', async () => {
  seed(
    tx({ id: 'normal', tags: ['bali'], createdAt: '2026-10-10T00:00:00Z' }),
    tx({ id: 'held', status: 'HELD', createdAt: '2026-10-11T00:00:00Z' }),
    tx({ id: 'xfer', transferAccountId: 'acc-j', createdAt: '2026-10-12T00:00:00Z' }),
    tx({ id: 'gone', createdAt: '2026-10-13T00:00:00Z' }),
    tx({ id: 'joint', accountId: 'acc-j', createdAt: '2026-10-14T00:00:00Z' }),
  )
  t.db.update(s.transactions).set({ deletedAt: NOW }).where(eq(s.transactions.id, 'gone')).run()
  expect(ids(await get('/api/transactions'))).toEqual(['joint', 'xfer', 'held', 'normal'])
  expect(ids(await get('/api/transactions?includeTransfers=false'))).toEqual(['joint', 'held', 'normal'])
  expect(ids(await get('/api/transactions?tag=bali'))).toEqual(['normal'])
  expect(ids(await get('/api/transactions?status=HELD'))).toEqual(['held'])
  expect(ids(await get('/api/transactions?accountId=acc-j'))).toEqual(['joint'])
  expect(ids(await get('/api/transactions?from=2026-10-11T00:00:00.000Z&to=2026-10-13T00:00:00.000Z'))).toEqual(['xfer', 'held'])
})

test('filters amount by absolute value', async () => {
  seed(
    tx({ id: 'out', amountCents: -2500 }),
    tx({ id: 'in', amountCents: 3000 }),
    tx({ id: 'small', amountCents: -500 }),
    tx({ id: 'big', amountCents: -9000 }),
  )
  expect(ids(await get('/api/transactions?minCents=1000&maxCents=5000')).sort()).toEqual(['in', 'out'])
})

test('transaction detail includes tags and account name', async () => {
  seed(tx({ id: 't1', tags: ['a', 'b'], description: 'Woolworths', performingCustomer: 'Owner' }))
  const dto = await get('/api/transactions/t1')
  expect(dto).toMatchObject({ id: 't1', accountName: 'Spending', description: 'Woolworths', tags: ['a', 'b'], amountCents: -1000, isTransfer: false })
  expect(dto).not.toHaveProperty('rawJson')
  expect((await t.json('/api/transactions/nope', { cookie: owner })).status).toBe(404)
})

test('categories carry colours and tags are listed', async () => {
  seed(tx({ id: 't1', tags: ['bali'] }))
  const cats = await get('/api/categories')
  expect(cats.find((c: { id: string }) => c.id === 'groceries')).toEqual({ id: 'groceries', name: 'Groceries', parentId: 'home', colorToken: 'cat-blue' })
  expect(cats.find((c: { id: string }) => c.id === 'good-life')).toMatchObject({ parentId: null, colorToken: 'cat-orange' })
  expect(await get('/api/tags')).toEqual(['bali'])
})

test('rejects invalid query params', async () => {
  expect((await t.json('/api/transactions?scope=everybody', { cookie: owner })).status).toBe(400)
  expect((await t.json('/api/transactions?minCents=abc', { cookie: owner })).status).toBe(400)
})

test('requires login', async () => {
  expect((await t.json('/api/transactions')).status).toBe(401)
  expect((await t.json('/api/accounts')).status).toBe(401)
  expect((await t.json('/api/categories')).status).toBe(401)
})
