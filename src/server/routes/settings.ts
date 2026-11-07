import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { answerConnectUp } from '../auth/users'
import * as s from '../db/schema'
import { getSyncStatus } from '../sync/status'
import { UpApiError, UpUnauthorizedError } from '../up/errors'
import { UpDisplayNameSchema } from './schemas'
import { validate } from './validate'

const TokenSchema = z.object({
  token: z.string().trim().min(1, 'Paste your Up personal access token').max(500),
  upDisplayName: UpDisplayNameSchema,
})

export function settingsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .put('/up-token', validate('json', TokenSchema), async (c) => {
      const user = c.get('user')
      try {
        const { token, upDisplayName } = c.req.valid('json')
        const conn = await deps.engine.connect(user.id, token)
        if (upDisplayName) deps.db.update(s.users).set({ upDisplayName }).where(eq(s.users.id, user.id)).run()
        answerConnectUp(deps.db, user.id)
        deps.scheduler.trigger(conn.id, conn.backfillCompletedAt ? 'incremental' : 'backfill')
      } catch (err) {
        if (err instanceof UpUnauthorizedError) return c.json({ error: "Up didn't accept that token" }, 400)
        if (err instanceof UpApiError) return c.json({ error: "Couldn't reach Up", detail: err.detail }, 502)
        throw err
      }
      return c.json(getSyncStatus(deps.db, c.get('user').id), 200)
    })
    .delete('/up-token', (c) => {
      deps.engine.disconnect(c.get('user').id)
      return c.json(getSyncStatus(deps.db, c.get('user').id), 200)
    })
}
