import type { z } from 'zod'
import type { Logger } from '../logger'
import { UpApiError, UpParseError, UpUnauthorizedError } from './errors'
import {
  UpAccountSchema,
  UpCategorySchema,
  UpPageSchema,
  UpTransactionSchema,
  type UpAccount,
  type UpCategory,
  type UpTransaction,
} from './schemas'

export interface UpClientOptions {
  token: string
  baseUrl: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  logger?: Logger
}

export interface UpTransactionPage {
  items: UpTransaction[]
  skipped: number
  /** Ids of records that failed to parse: they still exist in Up, so callers must not treat them as deleted. */
  skippedIds: string[]
}

const PAGE_SIZE = 100
const MAX_429_ATTEMPTS = 6
const MAX_SERVER_RETRIES = 3
const LOW_RATE_LIMIT = 10
const LOW_RATE_LIMIT_PAUSE_MS = 2000

export class UpClient {
  private readonly token: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  private readonly logger?: Logger
  private _rateLimitRemaining: number | null = null

  constructor(opts: UpClientOptions) {
    this.token = opts.token
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.random = opts.random ?? Math.random
    this.logger = opts.logger
  }

  get rateLimitRemaining(): number | null {
    return this._rateLimitRemaining
  }

  async ping(): Promise<void> {
    await this.request('GET', '/util/ping')
  }

  async listAccounts(): Promise<UpAccount[]> {
    const accounts: UpAccount[] = []
    for await (const p of this.pages(`/accounts?page[size]=${PAGE_SIZE}`, UpAccountSchema, 'account')) {
      accounts.push(...p.items)
    }
    return accounts
  }

  async *transactionPages(p: { since?: string; until?: string } = {}): AsyncGenerator<UpTransactionPage> {
    const params = new URLSearchParams({ 'page[size]': String(PAGE_SIZE) })
    if (p.since) params.set('filter[since]', p.since)
    if (p.until) params.set('filter[until]', p.until)
    yield* this.pages(`/transactions?${params}`, UpTransactionSchema, 'transaction')
  }

  /** null when Up says it no longer exists (404); throws UpParseError when it exists but can't be read. */
  async getTransaction(id: string): Promise<UpTransaction | null> {
    let json: unknown
    try {
      json = await this.request('GET', `/transactions/${encodeURIComponent(id)}`)
    } catch (err) {
      if (err instanceof UpApiError && err.status === 404) return null
      throw err
    }
    const parsed = UpTransactionSchema.safeParse((json as { data?: unknown } | null)?.data)
    if (!parsed.success) {
      this.logger?.warn('Unparseable Up transaction', { id, issues: parsed.error.issues.slice(0, 3).map((i) => i.message) })
      throw new UpParseError(id)
    }
    return parsed.data
  }

  async listCategories(): Promise<UpCategory[]> {
    const json = UpPageSchema.parse(await this.request('GET', '/categories'))
    return this.parseItems(json.data, UpCategorySchema, 'category').items
  }

  async listTags(): Promise<string[]> {
    const labels: string[] = []
    let url: string | null = `/tags?page[size]=${PAGE_SIZE}`
    while (url) {
      const page = UpPageSchema.parse(await this.request('GET', url))
      for (const t of page.data) {
        const id = (t as { id?: unknown }).id
        if (typeof id === 'string') labels.push(id)
      }
      url = page.links?.next ?? null
    }
    return labels
  }

  async setCategory(txId: string, categoryId: string | null): Promise<void> {
    await this.request('PATCH', `/transactions/${encodeURIComponent(txId)}/relationships/category`, {
      data: categoryId ? { type: 'categories', id: categoryId } : null,
    })
  }

  async addTags(txId: string, labels: string[]): Promise<void> {
    await this.request('POST', `/transactions/${encodeURIComponent(txId)}/relationships/tags`, tagBody(labels))
  }

  async removeTags(txId: string, labels: string[]): Promise<void> {
    await this.request('DELETE', `/transactions/${encodeURIComponent(txId)}/relationships/tags`, tagBody(labels))
  }

  private async *pages<S extends z.ZodType>(
    firstPath: string,
    schema: S,
    kind: string,
  ): AsyncGenerator<{ items: z.infer<S>[]; skipped: number; skippedIds: string[] }> {
    let url: string | null = firstPath
    while (url) {
      const page = UpPageSchema.parse(await this.request('GET', url))
      yield this.parseItems(page.data, schema, kind)
      url = page.links?.next ?? null
      if (url && this._rateLimitRemaining !== null && this._rateLimitRemaining < LOW_RATE_LIMIT) {
        await this.sleep(LOW_RATE_LIMIT_PAUSE_MS)
      }
    }
  }

  private parseItems<S extends z.ZodType>(data: unknown[], schema: S, kind: string) {
    const items: z.infer<S>[] = []
    const skippedIds: string[] = []
    let skipped = 0
    for (const raw of data) {
      const r = schema.safeParse(raw)
      if (r.success) {
        items.push(r.data)
      } else {
        skipped++
        const id = (raw as { id?: unknown } | null)?.id
        if (typeof id === 'string') skippedIds.push(id)
        this.logger?.warn(`Skipping unparseable Up ${kind}`, {
          id,
          issues: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`),
        })
      }
    }
    return { items, skipped, skippedIds }
  }

  private backoffMs(attempt: number): number {
    return Math.min(60_000, 1000 * 2 ** attempt) + Math.floor(this.random() * 250)
  }

  private async request(method: string, pathOrUrl: string, body?: unknown): Promise<unknown> {
    const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const init: RequestInit = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }

    let rateLimited = 0
    let serverRetries = 0
    for (;;) {
      let res: Response
      try {
        res = await this.fetchImpl(url, init)
      } catch (err) {
        if (serverRetries < MAX_SERVER_RETRIES) {
          await this.sleep(this.backoffMs(serverRetries++))
          continue
        }
        throw new UpApiError(0, `Network error: ${err instanceof Error ? err.message : String(err)}`)
      }

      const remaining = res.headers.get('X-RateLimit-Remaining')
      if (remaining !== null && remaining !== '' && !Number.isNaN(Number(remaining))) {
        this._rateLimitRemaining = Number(remaining)
      }

      if (res.status === 401) throw new UpUnauthorizedError()
      if (res.status === 429) {
        rateLimited++
        if (rateLimited >= MAX_429_ATTEMPTS) throw new UpApiError(429, await errorDetail(res))
        this.logger?.warn('Up rate limited; backing off', { attempt: rateLimited })
        await this.sleep(this.backoffMs(rateLimited - 1))
        continue
      }
      if (res.status >= 500) {
        if (serverRetries < MAX_SERVER_RETRIES) {
          await this.sleep(this.backoffMs(serverRetries++))
          continue
        }
        throw new UpApiError(res.status, await errorDetail(res))
      }
      if (!res.ok) throw new UpApiError(res.status, await errorDetail(res))
      if (res.status === 204) return null
      const text = await res.text()
      return text ? JSON.parse(text) : null
    }
  }
}

function tagBody(labels: string[]) {
  return { data: labels.map((id) => ({ type: 'tags', id })) }
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { errors?: { detail?: string; title?: string }[] }
    const e = json.errors?.[0]
    return e?.detail ?? e?.title ?? res.statusText
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}
