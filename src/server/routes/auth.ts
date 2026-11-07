import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../app'
import { clearSessionCookie, setSessionCookie } from '../auth/middleware'
import { verifyPassword } from '../auth/passwords'
import { createSession, deleteSession, SESSION_COOKIE } from '../auth/sessions'
import { findUserByUsername, normaliseUsername, toUserDto } from '../auth/users'
import { validate } from './validate'

const LoginSchema = z.object({ username: z.string().min(1).max(50), password: z.string().min(1).max(200) })

export function authRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .post('/login', validate('json', LoginSchema), async (c) => {
      const { username, password } = c.req.valid('json')
      const key = normaliseUsername(username)
      if (deps.limiter.isBlocked(key, deps.now())) {
        return c.json({ error: 'Too many attempts. Try again in a few minutes.' }, 429)
      }
      const user = findUserByUsername(deps.db, key)
      if (!user || !(await verifyPassword(user.passwordHash, password))) {
        deps.limiter.fail(key, deps.now())
        return c.json({ error: 'Wrong username or password.' }, 401)
      }
      deps.limiter.reset(key)
      const session = createSession(deps.db, user.id, deps.now())
      setSessionCookie(c, session.token, session.expiresAt)
      return c.json(toUserDto(user), 200)
    })
    .post('/logout', (c) => {
      const token = getCookie(c, SESSION_COOKIE)
      if (token) deleteSession(deps.db, token)
      clearSessionCookie(c)
      return c.body(null, 204)
    })
}
