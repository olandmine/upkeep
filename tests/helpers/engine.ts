import { randomBytes } from 'node:crypto'
import { createSecretBox } from '../../src/server/crypto'
import * as s from '../../src/server/db/schema'
import { createLogger } from '../../src/server/logger'
import { createSyncEngine } from '../../src/server/sync/engine'
import { buildAccount, buildTransaction } from '../fake-up/builders'
import { createFakeUp } from '../fake-up/fake-up'
import { createTestDb } from './db'

export const silentLogger = createLogger({ write: () => {} })

export function createEngineHarness(
  start = new Date('2026-10-29T00:00:00Z'),
  opts: { afterRun?: (connectionId: string) => void } = {},
) {
  const db = createTestDb()
  const fake = createFakeUp()
  const secrets = createSecretBox(randomBytes(32))
  let now = start
  const engine = createSyncEngine({
    db,
    secrets,
    upApiBaseUrl: fake.baseUrl,
    fetchImpl: fake.fetch,
    sleep: async () => {},
    now: () => now,
    logger: silentLogger,
    afterRun: opts.afterRun,
  })

  return {
    db,
    fake,
    secrets,
    engine,
    now: () => now,
    setNow(d: Date) {
      now = d
    },
    addUser(id: string, upDisplayName: string | null = null) {
      db.insert(s.users)
        .values({ id, username: id, displayName: id, passwordHash: 'x', upDisplayName, createdAt: now.toISOString() })
        .run()
    },
    /** Adds `count` daily transactions on `accountId`, newest last, starting at `from`. */
    addDailyTransactions(accountId: string, count: number, from = '2026-01-01T00:00:00Z', prefix = 't') {
      const t0 = Date.parse(from)
      for (let i = 0; i < count; i++) {
        fake.addTransaction(
          buildTransaction({
            id: `${prefix}${String(i).padStart(3, '0')}`,
            accountId,
            amountCents: -100 - i,
            createdAt: new Date(t0 + i * 86_400_000).toISOString(),
          }),
        )
      }
    },
    buildAccount,
    buildTransaction,
  }
}

export type EngineHarness = ReturnType<typeof createEngineHarness>
