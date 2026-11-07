import { describe, expect, test, vi } from 'vitest'
import { UpClient } from '../../src/server/up/client'
import { UpApiError, UpUnauthorizedError } from '../../src/server/up/errors'

const BASE = 'https://up.test/api/v1'

interface Recorded {
  method: string
  url: string
  headers: Headers
  body: unknown
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> }

function stubFetch(replies: Reply[]) {
  const requests: Recorded[] = []
  const queue = [...replies]
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requests.push({
      method: init?.method ?? 'GET',
      url,
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const r = queue.shift()
    if (!r) throw new Error(`no stubbed reply for ${url}`)
    const hasBody = r.body !== undefined && r.status !== 204
    return new Response(hasBody ? JSON.stringify(r.body) : null, {
      status: r.status,
      headers: { 'content-type': 'application/json', ...r.headers },
    })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests, calls: () => fetchImpl.mock.calls.length }
}

function client(replies: Reply[]) {
  const stub = stubFetch(replies)
  const sleep = vi.fn(async (_ms: number) => {})
  const c = new UpClient({ token: 'up:yeah:t', baseUrl: BASE, fetchImpl: stub.fetchImpl, sleep, random: () => 0 })
  return { c, sleep, ...stub }
}

const money = (cents: number) => ({ currencyCode: 'AUD', value: (cents / 100).toFixed(2), valueInBaseUnits: cents })

function tx(id: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'transactions',
    id,
    attributes: {
      status: 'SETTLED',
      rawText: null,
      description: 'Shop',
      message: null,
      isCategorizable: true,
      holdInfo: null,
      roundUp: null,
      cashback: null,
      amount: money(-1000),
      foreignAmount: null,
      cardPurchaseMethod: null,
      settledAt: '2026-10-28T01:00:00+11:00',
      createdAt: '2026-10-28T00:00:00+11:00',
      ...overrides,
    },
    relationships: {
      account: { data: { type: 'accounts', id: 'acc-1' } },
      transferAccount: { data: null },
      category: { data: null },
      parentCategory: { data: null },
      tags: { data: [] },
    },
  }
}

const page = (data: unknown[], next: string | null = null) => ({ data, links: { prev: null, next } })

describe('UpClient', () => {
  test('sends bearer token to /util/ping', async () => {
    const { c, requests } = client([{ status: 200, body: { meta: { id: 'x', statusEmoji: '⚡️' } } }])
    await c.ping()
    expect(requests[0].url).toBe(`${BASE}/util/ping`)
    expect(requests[0].headers.get('Authorization')).toBe('Bearer up:yeah:t')
  })

  test('transactionPages follows links.next', async () => {
    const next = `${BASE}/transactions?page%5Bafter%5D=abc`
    const { c, requests } = client([
      { status: 200, body: page([tx('t1'), tx('t2')], next) },
      { status: 200, body: page([tx('t3')]) },
    ])
    const batches: string[][] = []
    for await (const p of c.transactionPages({ since: '2026-10-26T00:00:00.000Z' })) {
      batches.push(p.items.map((t) => t.id))
    }
    expect(batches).toEqual([['t1', 't2'], ['t3']])
    const first = new URL(requests[0].url)
    expect(first.pathname).toBe('/api/v1/transactions')
    expect(first.searchParams.get('page[size]')).toBe('100')
    expect(first.searchParams.get('filter[since]')).toBe('2026-10-26T00:00:00.000Z')
    expect(requests[1].url).toBe(next)
  })

  test('retries 429 with exponential backoff', async () => {
    const { c, sleep } = client([{ status: 429 }, { status: 429 }, { status: 200, body: {} }])
    await c.ping()
    expect(sleep.mock.calls.map((a) => a[0])).toEqual([1000, 2000])
  })

  test('gives up after 6 attempts on 429', async () => {
    const { c, calls } = client(Array.from({ length: 6 }, () => ({ status: 429 })))
    const err = await c.ping().catch((e) => e)
    expect(err).toBeInstanceOf(UpApiError)
    expect(err.status).toBe(429)
    expect(calls()).toBe(6)
  })

  test('retries 5xx three times', async () => {
    const { c, calls } = client(Array.from({ length: 4 }, () => ({ status: 500 })))
    const err = await c.ping().catch((e) => e)
    expect(err).toBeInstanceOf(UpApiError)
    expect(err.status).toBe(500)
    expect(calls()).toBe(4)
  })

  test('401 throws UpUnauthorizedError without retry', async () => {
    const { c, calls } = client([{ status: 401, body: { errors: [{ status: '401', title: 'Not Authorized', detail: 'nope' }] } }])
    await expect(c.ping()).rejects.toBeInstanceOf(UpUnauthorizedError)
    expect(calls()).toBe(1)
  })

  test('getTransaction returns null on 404', async () => {
    const { c } = client([{ status: 404, body: { errors: [{ status: '404', title: 'Not Found', detail: 'gone' }] } }])
    expect(await c.getTransaction('t1')).toBeNull()
  })

  test('skips unparseable transactions', async () => {
    const bad = tx('t2')
    delete (bad.attributes as Record<string, unknown>).amount
    const { c } = client([{ status: 200, body: page([tx('t1'), bad]) }])
    const pages = []
    for await (const p of c.transactionPages()) pages.push(p)
    expect(pages[0].items.map((t) => t.id)).toEqual(['t1'])
    expect(pages[0].skipped).toBe(1)
    expect(pages[0].skippedIds).toEqual(['t2'])
  })

  test('pauses 2s between pages when rate limit is low', async () => {
    const { c, sleep } = client([
      { status: 200, body: page([tx('t1')], `${BASE}/transactions?page%5Bafter%5D=x`), headers: { 'X-RateLimit-Remaining': '5' } },
      { status: 200, body: page([tx('t2')]), headers: { 'X-RateLimit-Remaining': '4' } },
    ])
    const it = c.transactionPages()
    await it.next()
    expect(c.rateLimitRemaining).toBe(5)
    expect(sleep).not.toHaveBeenCalled()
    await it.next()
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  test('setCategory sends JSON:API body', async () => {
    const { c, requests } = client([{ status: 204 }, { status: 204 }])
    await c.setCategory('t1', 'groceries')
    await c.setCategory('t1', null)
    expect(requests[0].method).toBe('PATCH')
    expect(requests[0].url).toBe(`${BASE}/transactions/t1/relationships/category`)
    expect(requests[0].body).toEqual({ data: { type: 'categories', id: 'groceries' } })
    expect(requests[0].headers.get('Content-Type')).toBe('application/json')
    expect(requests[1].body).toEqual({ data: null })
  })

  test('addTags/removeTags send tag identifiers', async () => {
    const { c, requests } = client([{ status: 204 }, { status: 204 }])
    await c.addTags('t1', ['bali'])
    await c.removeTags('t1', ['bali'])
    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ['POST', `${BASE}/transactions/t1/relationships/tags`],
      ['DELETE', `${BASE}/transactions/t1/relationships/tags`],
    ])
    expect(requests[0].body).toEqual({ data: [{ type: 'tags', id: 'bali' }] })
    expect(requests[1].body).toEqual({ data: [{ type: 'tags', id: 'bali' }] })
  })

  test('surfaces Up error detail', async () => {
    const { c } = client([{ status: 422, body: { errors: [{ status: '422', title: 'Invalid', detail: 'Nope' }] } }])
    const err = await c.setCategory('t1', 'x').catch((e) => e)
    expect(err).toBeInstanceOf(UpApiError)
    expect(err).toMatchObject({ status: 422, detail: 'Nope' })
  })

  test('lists accounts, categories and tags', async () => {
    const account = {
      type: 'accounts',
      id: 'acc-1',
      attributes: {
        displayName: 'Spending',
        accountType: 'TRANSACTIONAL',
        ownershipType: 'INDIVIDUAL',
        balance: money(12345),
        createdAt: '2020-01-01T00:00:00+11:00',
      },
    }
    const category = {
      type: 'categories',
      id: 'groceries',
      attributes: { name: 'Groceries' },
      relationships: { parent: { data: { type: 'categories', id: 'home' } }, children: { data: [] } },
    }
    const { c } = client([
      { status: 200, body: page([account]) },
      { status: 200, body: { data: [category] } },
      { status: 200, body: page([{ type: 'tags', id: 'bali' }]) },
    ])
    expect((await c.listAccounts()).map((a) => a.id)).toEqual(['acc-1'])
    expect((await c.listCategories())[0].relationships.parent.data?.id).toBe('home')
    expect(await c.listTags()).toEqual(['bali'])
  })
})
