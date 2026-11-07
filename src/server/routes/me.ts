import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { ACCENTS } from '../../shared/accent'
import { SHARING_LEVELS } from '../../shared/sharing'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { hashPassword, verifyPassword } from '../auth/passwords'
import { answerConnectUp, toUserDto } from '../auth/users'
import * as s from '../db/schema'
import { PasswordSchema, UpDisplayNameSchema } from './schemas'
import { validate } from './validate'

const PatchMeSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  upDisplayName: UpDisplayNameSchema,
  negativeStyle: z.enum(['minus', 'parentheses']).optional(),
  accent: z.enum(ACCENTS).optional(),
  sharingLevel: z.enum(SHARING_LEVELS).optional(),
  connectUpSkipped: z.literal(true).optional(),
  gettingStartedHidden: z.literal(true).optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: PasswordSchema.optional(),
})

export function meRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', (c) => c.json(toUserDto(c.get('user'))))
    .patch('/', validate('json', PatchMeSchema), async (c) => {
      const user = c.get('user')
      const body = c.req.valid('json')
      const changes: Partial<typeof s.users.$inferInsert> = {}
      if (body.displayName !== undefined) changes.displayName = body.displayName
      if (body.upDisplayName !== undefined) changes.upDisplayName = body.upDisplayName || null
      if (body.negativeStyle !== undefined) changes.negativeStyle = body.negativeStyle
      if (body.accent !== undefined) changes.accent = body.accent
      if (body.sharingLevel !== undefined) changes.sharingLevel = body.sharingLevel
      if (body.gettingStartedHidden) changes.gettingStartedHidden = true
      if (body.newPassword !== undefined) {
        if (!body.currentPassword || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
          return c.json({ error: 'Current password is incorrect' }, 400)
        }
        changes.passwordHash = await hashPassword(body.newPassword)
        if (user.givenPassword === 'kept') changes.givenPassword = 'changed'
      }
      if (Object.keys(changes).length) deps.db.update(s.users).set(changes).where(eq(s.users.id, user.id)).run()
      if (body.connectUpSkipped) answerConnectUp(deps.db, user.id)
      const updated = deps.db.select().from(s.users).where(eq(s.users.id, user.id)).get()!
      return c.json(toUserDto(updated), 200)
    })
}
