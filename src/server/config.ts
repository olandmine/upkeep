import path from 'node:path'
import { z } from 'zod'

export interface Config {
  port: number
  dataDir: string
  secretKey?: string
  tz: string
  syncIntervalMinutes: number
  reconcileHour: number
  upApiBaseUrl: string
  migrationsDir: string
  webDistDir: string
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().min(1).default('./data'),
  UPKEEP_SECRET_KEY: z.string().min(1).optional(),
  TZ: z
    .string()
    .min(1)
    .refine(isValidTimeZone, { message: 'TZ must be a valid IANA timezone' })
    .optional(),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(5),
  RECONCILE_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  UP_API_BASE_URL: z.url().default('https://api.up.com.au/api/v1'),
})

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid configuration: ${issues}`)
  }
  const e = parsed.data
  return {
    port: e.PORT,
    dataDir: path.resolve(e.DATA_DIR),
    secretKey: e.UPKEEP_SECRET_KEY,
    tz: e.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    syncIntervalMinutes: e.SYNC_INTERVAL_MINUTES,
    reconcileHour: e.RECONCILE_HOUR,
    upApiBaseUrl: e.UP_API_BASE_URL,
    migrationsDir: path.resolve('src/server/db/migrations'),
    webDistDir: path.resolve('dist/web'),
  }
}
