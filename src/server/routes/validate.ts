import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { z } from 'zod'

/** zod validation that answers 400 with the first issue's message. */
export function validate<T extends keyof ValidationTargets, S extends z.ZodType>(target: T, schema: S) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json({ error: result.error.issues[0]?.message ?? 'Invalid request' }, 400)
  })
}
