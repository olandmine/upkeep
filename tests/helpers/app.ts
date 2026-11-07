import { createApp } from '../../src/server/app'
import { rederiveAll } from '../../src/server/budgets/pay-schedule'
import type { SchedulerLike } from '../../src/server/app'
import { createEngineHarness } from './engine'
import { silentLogger } from './engine'

const TZ = 'Australia/Sydney'

export const OWNER = { username: 'owner', displayName: 'Owner', password: 'correct horse' }
export const PARTNER = { username: 'partner', displayName: 'Partner', password: 'battery staple' }

export function createTestApp(opts: { now?: Date } = {}) {
  // Like production: every successful sync re-derives pay events.
  const h: ReturnType<typeof createEngineHarness> = createEngineHarness(opts.now, {
    afterRun: () => rederiveAll(h.db, h.now(), TZ),
  })
  const triggered: [string, string][] = []
  const scheduler: SchedulerLike & { triggered: typeof triggered } = {
    triggered,
    trigger(connectionId, kind) {
      triggered.push([connectionId, kind])
    },
    async runNow() {},
  }
  const app = createApp({ db: h.db, now: h.now, tz: TZ, logger: silentLogger, engine: h.engine, scheduler })

  async function json(
    path: string,
    init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...init.headers }
    if (init.cookie) headers.Cookie = init.cookie
    return app.request(path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  }

  const cookieFrom = (res: Response) => {
    const header = res.headers.get('Set-Cookie') ?? ''
    const match = /upkeep_session=[^;]+/.exec(header)
    if (!match) throw new Error(`no session cookie in response (${res.status})`)
    return match[0]
  }

  async function login(user: { username: string; password: string }): Promise<string> {
    return cookieFrom(await json('/api/auth/login', { method: 'POST', body: user }))
  }

  return {
    ...h,
    app,
    scheduler,
    json,
    cookieFrom,
    login,
    async setupOwner(): Promise<string> {
      const cookie = cookieFrom(await json('/api/setup', { method: 'POST', body: OWNER }))
      await json('/api/me', { method: 'PATCH', body: { sharingLevel: 'full' }, cookie })
      return cookie
    },
    async addPartner(ownerCookie: string): Promise<string> {
      const res = await json('/api/users', { method: 'POST', body: PARTNER, cookie: ownerCookie })
      if (res.status !== 201) throw new Error(`add partner failed: ${res.status}`)
      const cookie = await login(PARTNER)
      await json('/api/me', { method: 'PATCH', body: { sharingLevel: 'full' }, cookie })
      return cookie
    },
  }
}

export type TestApp = ReturnType<typeof createTestApp>
