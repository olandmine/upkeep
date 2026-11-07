import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import { createTestApp, type TestApp } from '../helpers/app'

const OWNER_TOKEN = 'up:yeah:owner'
const PARTNER_TOKEN = 'up:yeah:partner'
let t: TestApp
let owner: string
let partner: string

const created = '2026-10-20T00:00:00Z'

beforeEach(async () => {
  t = createTestApp()
  owner = await t.setupOwner()
  partner = await t.addPartner(owner)
  t.fake.addAccount(t.buildAccount({ id: 'acc-me' }))
  t.fake.addAccount(t.buildAccount({ id: 'acc-j', ownershipType: 'JOINT' }))
  t.fake.addCustomer(OWNER_TOKEN, ['acc-me', 'acc-j'])
  t.fake.addCustomer(PARTNER_TOKEN, ['acc-j'])
  t.fake.addTransaction(t.buildTransaction({ id: 't1', accountId: 'acc-me', amountCents: -1000, createdAt: created }))
  t.fake.addTransaction(t.buildTransaction({ id: 'nc', accountId: 'acc-me', amountCents: -1000, createdAt: created, isCategorizable: false }))
  t.fake.addTransaction(t.buildTransaction({ id: 'tj', accountId: 'acc-j', amountCents: -1000, createdAt: created }))
  t.fake.addTransaction(
    t.buildTransaction({ id: 'tagged', accountId: 'acc-me', amountCents: -1000, createdAt: created, tags: ['a', 'b', 'c', 'd', 'e'] }),
  )
  for (const [cookie, token] of [[owner, OWNER_TOKEN], [partner, PARTNER_TOKEN]]) {
    await t.json('/api/settings/up-token', { method: 'PUT', body: { token }, cookie })
  }
  for (const conn of t.db.select().from(s.upConnections).all()) await t.engine.backfill(conn.id)
})

const patchCategory = (id: string, categoryId: string | null, cookie = owner) =>
  t.json(`/api/transactions/${id}/category`, { method: 'PATCH', body: { categoryId }, cookie })
const tags = (method: 'POST' | 'DELETE', id: string, labels: string[], cookie = owner) =>
  t.json(`/api/transactions/${id}/tags`, { method, body: { labels }, cookie })
const local = (id: string) => t.db.select().from(s.transactions).where(eq(s.transactions.id, id)).get()!

test('recategorise writes to Up then local', async () => {
  const res = await patchCategory('t1', 'groceries')
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ id: 't1', categoryId: 'groceries', parentCategoryId: 'home' })
  expect(t.fake.categoryOf('t1')).toBe('groceries')
  expect(local('t1')).toMatchObject({ categoryId: 'groceries', parentCategoryId: 'home' })

  const cleared = await patchCategory('t1', null)
  expect(await cleared.json()).toMatchObject({ categoryId: null, parentCategoryId: null })
  expect(t.fake.categoryOf('t1')).toBeNull()
})

test('Up failure leaves local data unchanged', async () => {
  t.fake.failNext(/relationships\/category/, 422)
  const res = await patchCategory('t1', 'groceries')
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: "Couldn't update Up", detail: 'Injected failure' })
  expect(local('t1').categoryId).toBeNull()
})

test('unknown category is rejected before calling Up', async () => {
  const before = t.fake.requests.length
  const res = await patchCategory('t1', 'not-a-category')
  expect(res.status).toBe(400)
  expect(t.fake.requests.length).toBe(before)
})

test('not categorisable → 409 with copy', async () => {
  const res = await patchCategory('nc', 'groceries')
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: "Up doesn't allow this transaction to be categorised." })
})

test('no visible connection → 409 with copy', async () => {
  t.db.update(s.upConnections).set({ status: 'unauthorized' }).run()
  const res = await patchCategory('t1', 'groceries')
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'No connected Up token can edit this account' })
})

test("uses the acting user's connection when it can see the account", async () => {
  await patchCategory('tj', 'groceries', partner)
  expect(t.fake.requests.at(-1)).toMatchObject({ method: 'PATCH', token: PARTNER_TOKEN })
  await patchCategory('tj', 'fuel', owner)
  expect(t.fake.requests.at(-1)).toMatchObject({ method: 'PATCH', token: OWNER_TOKEN })
})

test('a rejected token during write-back marks the connection', async () => {
  t.fake.revokeToken(OWNER_TOKEN)
  const res = await patchCategory('t1', 'groceries')
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: "Couldn't update Up", detail: 'Up rejected the token' })
  expect(t.db.select().from(s.upConnections).all().find((c) => c.status === 'unauthorized')).toBeDefined()
})

test('tags: add, remove, limit 6', async () => {
  const added = await tags('POST', 't1', ['bali', 'trip', 'bali'])
  expect(added.status).toBe(200)
  expect((await added.json()).tags).toEqual(['bali', 'trip'])
  expect(t.fake.tagsOf('t1')).toEqual(['bali', 'trip'])
  expect(t.db.select().from(s.tags).all().map((r) => r.label)).toEqual(expect.arrayContaining(['bali', 'trip']))

  const removed = await tags('DELETE', 't1', ['trip'])
  expect((await removed.json()).tags).toEqual(['bali'])
  expect(t.fake.tagsOf('t1')).toEqual(['bali'])

  const before = t.fake.requests.length
  const tooMany = await tags('POST', 'tagged', ['x', 'y'])
  expect(tooMany.status).toBe(400)
  expect(await tooMany.json()).toEqual({ error: 'Up allows up to 6 tags per transaction.' })
  expect(t.fake.requests.length).toBe(before)
  expect((await (await tags('POST', 'tagged', ['x'])).json()).tags).toHaveLength(6)
})

test('unknown transaction → 404', async () => {
  expect((await patchCategory('nope', 'groceries')).status).toBe(404)
  expect((await tags('POST', 'nope', ['x'])).status).toBe(404)
})

test('a transient sync error does not block write-back', async () => {
  t.db.update(s.upConnections).set({ status: 'error', lastError: 'Up API error 503' }).run()
  const res = await patchCategory('t1', 'groceries')
  expect(res.status).toBe(200)
  expect(t.fake.categoryOf('t1')).toBe('groceries')
})
