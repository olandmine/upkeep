import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppDeps, AppEnv } from '../app'
import { SESSION_COOKIE, validateSession } from './sessions'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/** Mutating requests must be JSON and same-origin. */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    if (!(c.req.header('Content-Type') ?? '').toLowerCase().startsWith('application/json')) {
      return c.json({ error: 'Requests must be JSON' }, 415)
    }
    const origin = c.req.header('Origin')
    if (origin && hostOf(origin) !== new URL(c.req.url).host) {
      return c.json({ error: 'Cross-origin request blocked' }, 403)
    }
  }
  await next()
}

export function requireUser(deps: Pick<AppDeps, 'db' | 'now'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE)
    const session = token ? validateSession(deps.db, token, deps.now()) : null
    if (!token || !session) return c.json({ error: 'Not logged in' }, 401)
    c.set('user', session.user)
    await next()
    // Sliding expiry: keep the browser's cookie in step with the extended session.
    if (session.renewedExpiresAt) setSessionCookie(c, token, session.renewedExpiresAt)
  }
}

const isHttps = (c: Context) =>
  new URL(c.req.url).protocol === 'https:' || c.req.header('X-Forwarded-Proto')?.toLowerCase() === 'https'

export function setSessionCookie(c: Context, token: string, expiresAt: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: isHttps(c),
    expires: new Date(expiresAt),
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}
