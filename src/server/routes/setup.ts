import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../app'
import { setSessionCookie } from '../auth/middleware'
import { createSession } from '../auth/sessions'
import { countUsers, createUser, toUserDto } from '../auth/users'
import { NewUserSchema } from './schemas'
import { validate } from './validate'

export function setupRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get('/status', (c) => c.json({ needsSetup: countUsers(deps.db) === 0 }))
    .post('/', validate('json', NewUserSchema), async (c) => {
      if (countUsers(deps.db) > 0) return c.json({ error: 'Setup is already complete' }, 409)
      const user = await createUser(deps.db, c.req.valid('json'), deps.now())
      const session = createSession(deps.db, user.id, deps.now())
      setSessionCookie(c, session.token, session.expiresAt)
      return c.json(toUserDto(user), 201)
    })
}
