import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import type { SharingLevel } from '../../src/shared/sharing'
import * as s from '../../src/server/db/schema'
import { listTransactions } from '../../src/server/queries/transactions'
import { createTestApp, OWNER, type TestApp } from '../helpers/app'
import { seedAccount, seedTx } from '../helpers/budget-seed'

// The viewer is the owner login; the "owner" of the hidden data is the partner login, whose level varies.
const OTHER_ID = 'other'
const NOT_FOUND = { error: 'Transaction not found' }
let t: TestApp
let cookie: string

const get = (path: string) => t.json(path, { cookie })
const send = (path: string, method: string, body?: unknown) => t.json(path, { method, body, cookie })
const setLevel = (level: SharingLevel | null) =>
  t.db.update(s.users).set({ sharingLevel: level }).where(eq(s.users.id, OTHER_ID)).run()
const ids = async (res: Response) => ((await res.json()) as { items: { id: string }[] }).items.map((i) => i.id).sort()

beforeEach(async () => {
  t = createTestApp({ now: new Date('2026-10-29T00:00:00Z') })
  cookie = await t.setupOwner()
  const viewerId = t.db.select().from(s.users).where(eq(s.users.username, OWNER.username)).get()!.id
  t.db.insert(s.users)
    .values({ id: OTHER_ID, username: 'partner', displayName: 'Partner', passwordHash: 'x', createdAt: '2026-01-01T00:00:00.000Z', sharingLevel: 'full' })
    .run()

  seedAccount(t.db, { id: 'o-spend', owner: OTHER_ID, name: 'Their Spending', balanceCents: 50_000 })
  seedAccount(t.db, { id: 'o-save', owner: OTHER_ID, type: 'SAVER', name: 'Their Saver', balanceCents: 20_000 })
  seedAccount(t.db, { id: 'joint', owner: null, ownership: 'JOINT', balanceCents: 7_000 })
  seedAccount(t.db, { id: 'orphan', owner: null, name: 'Nobody', balanceCents: 900 })
  seedAccount(t.db, { id: 'v-spend', owner: viewerId, balanceCents: 3_000 })

  seedTx(t.db, { id: 'o1', accountId: 'o-spend', amountCents: -1_000, createdAt: '2026-10-20T00:00:00Z', description: 'Zebra Cafe' })
  seedTx(t.db, { id: 'j1', accountId: 'joint', amountCents: -500, createdAt: '2026-10-21T00:00:00Z', description: 'Joint Shop' })
  // The viewer's own transfer into the owner's account: only the viewer's leg is theirs.
  seedTx(t.db, { id: 'v1', accountId: 'v-spend', amountCents: -300, createdAt: '2026-10-22T00:00:00Z', transferAccountId: 'o-spend' })
  seedTx(t.db, { id: 'v2', accountId: 'v-spend', amountCents: -200, createdAt: '2026-10-23T00:00:00Z' })
  t.db.insert(s.tags).values([{ label: 'secret' }, { label: 'shared' }]).run()
  t.db.insert(s.transactionTags).values([
    { transactionId: 'o1', label: 'secret' },
    { transactionId: 'j1', label: 'shared' },
  ]).run()
})

describe('transactions', () => {
  test('the owner transaction is listed only at full; joint is always there', async () => {
    expect(await ids(await get('/api/transactions'))).toEqual(['j1', 'o1', 'v1', 'v2'])
    for (const level of ['hide-transactions', 'balances', 'none', null] as const) {
      setLevel(level)
      expect(await ids(await get('/api/transactions'))).toEqual(['j1', 'v1', 'v2'])
    }
  })

  test.each(['q=Zebra', 'tag=secret', 'accountId=o-spend'])('filter %s finds nothing below full', async (filter) => {
    expect(await ids(await get(`/api/transactions?${filter}`))).toEqual(['o1'])
    setLevel('hide-transactions')
    const res = await get(`/api/transactions?${filter}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [], nextCursor: null })
  })

  test.each(['', '/budget-line', '/repayment'])('GET /transactions/:id%s is 404 below full, like an unknown id', async (suffix) => {
    expect((await get(`/api/transactions/o1${suffix}`)).status).toBe(200)
    setLevel('balances')
    const hidden = await get(`/api/transactions/o1${suffix}`)
    const unknown = await get(`/api/transactions/nope${suffix}`)
    expect(hidden.status).toBe(404)
    const body = await hidden.json()
    expect(body).toEqual(await unknown.json())
    expect(body).toEqual(NOT_FOUND)
  })

  test('writes to a hidden transaction are 404 and reach neither Up nor the row', async () => {
    setLevel('hide-transactions')
    const before = t.fake.requests.length
    const responses = [
      await send('/api/transactions/o1/category', 'PATCH', { categoryId: 'groceries' }),
      await send('/api/transactions/o1/tags', 'POST', { labels: ['x'] }),
      await send('/api/transactions/o1/tags', 'DELETE', { labels: ['secret'] }),
    ]
    for (const res of responses) {
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual(NOT_FOUND)
    }
    expect(t.fake.requests.length).toBe(before)
    expect(t.db.select().from(s.transactions).where(eq(s.transactions.id, 'o1')).get()!.categoryId).toBeNull()
    expect(t.db.select().from(s.transactionTags).where(eq(s.transactionTags.transactionId, 'o1')).all()).toHaveLength(1)
  })

  test("a viewer's transfer to a hidden account stays a lone row, and paging returns each row once", async () => {
    setLevel('none')
    const viewerId = t.db.select().from(s.users).where(eq(s.users.username, OWNER.username)).get()!.id
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = listTransactions(t.db, { userId: viewerId, limit: 1, cursor })
      seen.push(...page.items.map((i) => i.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen.sort()).toEqual(['j1', 'v1', 'v2'])
  })
})

describe('accounts', () => {
  const listed = async () => ((await (await get('/api/accounts')).json()) as { id: string }[]).map((a) => a.id)

  test('an owner account is listed at balances and above, not at none', async () => {
    expect(await listed()).toContain('o-spend')
    for (const level of ['hide-transactions', 'balances'] as const) {
      setLevel(level)
      expect(await listed()).toContain('o-spend')
    }
    setLevel('none')
    expect(await listed()).not.toContain('o-spend')
    expect(await listed()).toEqual(expect.arrayContaining(['joint', 'v-spend']))
  })

  test('GET /accounts/:id is 404 at none, like an unknown id', async () => {
    expect((await get('/api/accounts/o-spend')).status).toBe(200)
    setLevel('none')
    const hidden = await get('/api/accounts/o-spend')
    const unknown = await get('/api/accounts/nope')
    expect(hidden.status).toBe(404)
    expect(await hidden.json()).toEqual(await unknown.json())
  })

  test('a personal account with no owner is never listed', async () => {
    expect(await listed()).not.toContain('orphan')
    expect((await get('/api/accounts/orphan')).status).toBe(404)
  })
})

describe('overview', () => {
  const overview = async () =>
    (await (await get('/api/overview?month=2026-10')).json()) as {
      totalBalanceCents: number
      month: { spentCents: number }
      spendingByParent: { cents: number }[]
      recent: { id: string }[]
    }

  test('full counts everything', async () => {
    const o = await overview()
    expect(o.totalBalanceCents).toBe(50_000 + 20_000 + 7_000 + 3_000)
    expect(o.month.spentCents).toBe(1_000 + 500 + 200)
    expect(o.recent.map((r) => r.id)).toContain('o1')
  })

  test('balances: the balance is counted, spending and recent are not', async () => {
    setLevel('balances')
    const o = await overview()
    expect(o.totalBalanceCents).toBe(50_000 + 20_000 + 7_000 + 3_000)
    expect(o.month.spentCents).toBe(500 + 200)
    expect(o.spendingByParent.reduce((n, r) => n + r.cents, 0)).toBe(500 + 200)
    expect(o.recent.map((r) => r.id)).not.toContain('o1')
  })

  test('hide-transactions: totals include the owner, recent does not', async () => {
    setLevel('hide-transactions')
    const o = await overview()
    expect(o.month.spentCents).toBe(1_000 + 500 + 200)
    expect(o.recent.map((r) => r.id)).not.toContain('o1')
  })

  test('none: the balance is left out too', async () => {
    setLevel('none')
    const o = await overview()
    expect(o.totalBalanceCents).toBe(7_000 + 3_000)
    expect(o.month.spentCents).toBe(500 + 200)
  })
})

describe('net worth', () => {
  const today = async () => ((await (await get('/api/net-worth')).json()) as { points: { upCents: number }[] }).points.at(-1)!.upCents

  test('counts the owner balance at balances and above, not at none', async () => {
    expect(await today()).toBe(80_000)
    setLevel('balances')
    expect(await today()).toBe(80_000)
    setLevel('none')
    expect(await today()).toBe(10_000)
  })
})

describe('goals', () => {
  test("leaves out the owner's Saver at balances, though accounts lists it", async () => {
    const goals = async () => ((await (await get('/api/goals')).json()) as { goals: { accountId: string }[] }).goals.map((g) => g.accountId)
    expect(await goals()).toContain('o-save')
    setLevel('balances')
    expect(await goals()).not.toContain('o-save')
    expect(((await (await get('/api/accounts')).json()) as { id: string }[]).map((a) => a.id)).toContain('o-save')
  })
})

describe('tags', () => {
  test("the owner's tag is listed only at full; a joint transaction's tag always is", async () => {
    const tags = async () => (await (await get('/api/tags')).json()) as string[]
    expect(await tags()).toEqual(['secret', 'shared'])
    setLevel('hide-transactions')
    expect(await tags()).toEqual(['shared'])
  })
})
