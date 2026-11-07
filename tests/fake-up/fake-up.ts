import { Hono, type Context } from 'hono'
import type { UpAccount, UpCategory, UpTransaction } from '../../src/server/up/schemas'
import categoriesFixture from '../fixtures/up/categories.json'
import { money } from './builders'

/** In-memory fake of the Up API, enough for sync and write-back tests. */
export interface FakeUp {
  app: Hono
  fetch: typeof fetch
  baseUrl: string
  requests: { method: string; url: URL; token: string | null; body: unknown }[]
  addCustomer(token: string, accountIds: string[]): void
  revokeToken(token: string): void
  addAccount(a: UpAccount): void
  setBalance(accountId: string, cents: number): void
  addTransaction(t: UpTransaction): void
  settle(id: string, amountCents?: number): void
  remove(id: string): void
  /** Matched against the decoded path + query string. */
  failNext(pathRegex: RegExp, status: number, times?: number): void
  setRateLimitRemaining(n: number | null): void
  categoryOf(txId: string): string | null
  tagsOf(txId: string): string[]
}

const HOST = 'http://fake-up.test'
const BASE_PATH = '/api/v1'
const DEFAULT_PAGE_SIZE = 20

const clone = <T>(v: T): T => structuredClone(v)
const errorBody = (status: number, detail: string) => ({ errors: [{ status: String(status), title: 'Error', detail }] })

export function createFakeUp(): FakeUp {
  const customers = new Map<string, Set<string>>()
  const accounts = new Map<string, UpAccount>()
  const transactions = new Map<string, UpTransaction>()
  const extraTags = new Set<string>()
  const categories = categoriesFixture as unknown as UpCategory[]
  const failures: { pathRegex: RegExp; status: number; remaining: number }[] = []
  let rateLimitRemaining: number | null = null
  const requests: FakeUp['requests'] = []

  const parentOf = (categoryId: string) =>
    categories.find((c) => c.id === categoryId)?.relationships.parent.data?.id ?? null

  const visibleAccounts = (token: string) => customers.get(token) ?? new Set<string>()
  const canSee = (token: string, t: UpTransaction) => visibleAccounts(token).has(t.relationships.account.data.id)
  const allTags = () => {
    const set = new Set(extraTags)
    for (const t of transactions.values()) for (const tag of t.relationships.tags.data) set.add(tag.id)
    return [...set].sort()
  }

  const app = new Hono().basePath(BASE_PATH)

  app.use('*', async (c, next) => {
    const token = c.req.header('Authorization')?.replace(/^Bearer /, '') ?? null
    let body: unknown
    if (c.req.method !== 'GET') {
      const text = await c.req.raw.clone().text()
      body = text ? JSON.parse(text) : undefined
    }
    const url = new URL(c.req.url)
    requests.push({ method: c.req.method, url, token, body })
    if (rateLimitRemaining !== null) c.header('X-RateLimit-Remaining', String(rateLimitRemaining))
    if (!token || !customers.has(token)) return c.json(errorBody(401, 'Invalid token'), 401)
    const target = decodeURIComponent(url.pathname + url.search)
    const failure = failures.find((f) => f.remaining > 0 && f.pathRegex.test(target))
    if (failure) {
      failure.remaining--
      return c.json(errorBody(failure.status, 'Injected failure'), failure.status as 500)
    }
    c.set('token' as never, token as never)
    await next()
  })

  const tokenOf = (c: Context) => c.get('token' as never) as unknown as string

  function paginate<T>(c: Context, items: T[]) {
    const url = new URL(c.req.url)
    const size = Number(url.searchParams.get('page[size]') ?? DEFAULT_PAGE_SIZE)
    const offset = Number(Buffer.from(url.searchParams.get('page[after]') ?? 'MA', 'base64url').toString() || 0)
    const page = items.slice(offset, offset + size)
    let next: string | null = null
    if (offset + size < items.length) {
      const nextUrl = new URL(url)
      nextUrl.searchParams.set('page[after]', Buffer.from(String(offset + size)).toString('base64url'))
      next = nextUrl.href
    }
    return c.json({ data: clone(page), links: { prev: null, next } })
  }

  app.get('/util/ping', (c) => c.json({ meta: { id: 'fake', statusEmoji: '⚡️' } }))

  app.get('/accounts', (c) => {
    const visible = visibleAccounts(tokenOf(c))
    return paginate(c, [...accounts.values()].filter((a) => visible.has(a.id)))
  })

  app.get('/transactions', (c) => {
    const url = new URL(c.req.url)
    const since = url.searchParams.get('filter[since]')
    const until = url.searchParams.get('filter[until]')
    const token = tokenOf(c)
    const items = [...transactions.values()]
      .filter((t) => canSee(token, t))
      .filter((t) => !since || Date.parse(t.attributes.createdAt) >= Date.parse(since))
      .filter((t) => !until || Date.parse(t.attributes.createdAt) < Date.parse(until))
      .sort((a, b) => Date.parse(b.attributes.createdAt) - Date.parse(a.attributes.createdAt) || (a.id < b.id ? 1 : -1))
    return paginate(c, items)
  })

  const findVisible = (c: Context) => {
    const t = transactions.get(c.req.param('id') ?? '')
    return t && canSee(tokenOf(c), t) ? t : null
  }

  app.get('/transactions/:id', (c) => {
    const t = findVisible(c)
    return t ? c.json({ data: clone(t) }) : c.json(errorBody(404, 'Not found'), 404)
  })

  app.get('/categories', (c) => c.json({ data: clone(categories) }))
  app.get('/tags', (c) => paginate(c, allTags().map((id) => ({ type: 'tags', id }))))

  app.patch('/transactions/:id/relationships/category', async (c) => {
    const t = findVisible(c)
    if (!t) return c.json(errorBody(404, 'Not found'), 404)
    if (!t.attributes.isCategorizable) return c.json(errorBody(422, 'Transaction is not categorizable'), 422)
    const { data } = (await c.req.json()) as { data: { id: string } | null }
    if (data && !categories.some((cat) => cat.id === data.id)) return c.json(errorBody(422, 'Invalid category'), 422)
    t.relationships.category = { data: data ? { type: 'categories', id: data.id } : null }
    const parent = data ? parentOf(data.id) : null
    t.relationships.parentCategory = { data: parent ? { type: 'categories', id: parent } : null }
    return c.body(null, 204)
  })

  const tagRoute = (mode: 'add' | 'remove') => async (c: Context) => {
    const t = findVisible(c)
    if (!t) return c.json(errorBody(404, 'Not found'), 404)
    const { data } = (await c.req.json()) as { data: { id: string }[] }
    const labels = new Set(t.relationships.tags.data.map((d) => d.id))
    for (const { id } of data) {
      if (mode === 'add') labels.add(id)
      else labels.delete(id)
    }
    if (labels.size > 6) return c.json(errorBody(422, 'Too many tags'), 422)
    t.relationships.tags = { data: [...labels].map((id) => ({ type: 'tags', id })) }
    return c.body(null, 204)
  }
  app.post('/transactions/:id/relationships/tags', tagRoute('add'))
  app.delete('/transactions/:id/relationships/tags', tagRoute('remove'))

  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(app.fetch(new Request(input, init)))) as typeof fetch

  return {
    app,
    fetch: fetchImpl,
    baseUrl: `${HOST}${BASE_PATH}`,
    requests,
    addCustomer(token, accountIds) {
      const set = customers.get(token) ?? new Set<string>()
      for (const id of accountIds) set.add(id)
      customers.set(token, set)
    },
    revokeToken(token) {
      customers.delete(token)
    },
    addAccount(a) {
      accounts.set(a.id, clone(a))
    },
    setBalance(accountId, cents) {
      const a = accounts.get(accountId)
      if (!a) throw new Error(`unknown account ${accountId}`)
      a.attributes.balance = money(cents)
    },
    addTransaction(t) {
      transactions.set(t.id, clone(t))
    },
    settle(id, amountCents) {
      const t = transactions.get(id)
      if (!t) throw new Error(`unknown transaction ${id}`)
      t.attributes.status = 'SETTLED'
      t.attributes.settledAt = new Date().toISOString()
      if (amountCents !== undefined) t.attributes.amount = money(amountCents)
    },
    remove(id) {
      transactions.delete(id)
    },
    failNext(pathRegex, status, times = 1) {
      failures.push({ pathRegex, status, remaining: times })
    },
    setRateLimitRemaining(n) {
      rateLimitRemaining = n
    },
    categoryOf(txId) {
      return transactions.get(txId)?.relationships.category.data?.id ?? null
    },
    tagsOf(txId) {
      return transactions.get(txId)?.relationships.tags.data.map((d) => d.id) ?? []
    },
  }
}
