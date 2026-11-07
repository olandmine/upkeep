import { asc } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { countUsers, createUser, findUserByUsername, MAX_USERS, toUserDto } from '../auth/users'
import * as s from '../db/schema'
import { NewUserSchema } from './schemas'
import { validate } from './validate'

export function usersRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', (c) => c.json(deps.db.select().from(s.users).orderBy(asc(s.users.createdAt)).all().map(toUserDto)))
    .post('/', validate('json', NewUserSchema), async (c) => {
      if (countUsers(deps.db) >= MAX_USERS) return c.json({ error: 'Upkeep supports two users' }, 409)
      const input = c.req.valid('json')
      if (findUserByUsername(deps.db, input.username)) return c.json({ error: 'That username is taken' }, 409)
      const user = await createUser(deps.db, { ...input, givenPassword: 'kept' }, deps.now())
      return c.json(toUserDto(user), 201)
    })
}
