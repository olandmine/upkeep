import type { SharingLevel } from '../../src/shared/sharing'
import * as s from '../../src/server/db/schema'
import type { Db } from '../../src/server/db/client'

// Direct DB seeding for budget tests. Times are UTC ISO; `local()` builds one from a Sydney wall-clock time.

export const TZ = 'Australia/Sydney'
const STAMP = '2026-01-01T00:00:00.000Z'

/** ISO instant for `date` at `time` in Sydney (AEDT +11 from Oct to early Apr, AEST +10 otherwise). */
export function local(date: string, time = '09:00'): string {
  const offset = date >= '2026-04-05' && date < '2026-10-04' ? '+10:00' : '+11:00'
  return new Date(`${date}T${time}:00${offset}`).toISOString()
}

export function seedUser(
  db: Db,
  id: string,
  displayName = id,
  createdAt = STAMP,
  sharingLevel: SharingLevel | null = 'full',
) {
  db.insert(s.users).values({ id, username: id, displayName, passwordHash: 'x', createdAt, sharingLevel }).run()
}

export function seedConnection(db: Db, userId: string) {
  db.insert(s.upConnections)
    .values({ id: `c-${userId}`, userId, tokenCiphertext: 'v1:x', status: 'ok', createdAt: STAMP })
    .run()
}

export function seedAccount(
  db: Db,
  a: {
    id: string
    owner: string | null
    type?: 'TRANSACTIONAL' | 'SAVER'
    ownership?: 'INDIVIDUAL' | 'JOINT'
    name?: string
    balanceCents?: number
  },
) {
  db.insert(s.accounts)
    .values({
      id: a.id,
      displayName: a.name ?? a.id,
      accountType: a.type ?? 'TRANSACTIONAL',
      ownership: a.ownership ?? 'INDIVIDUAL',
      ownerUserId: a.owner,
      balanceCents: a.balanceCents ?? 0,
      currency: 'AUD',
      colorIndex: 0,
      upCreatedAt: STAMP,
      rawJson: '{}',
      updatedAt: STAMP,
    })
    .run()
}

export function seedTx(
  db: Db,
  t: {
    id: string
    accountId: string
    amountCents: number
    createdAt: string
    description?: string
    status?: 'HELD' | 'SETTLED'
    categoryId?: string | null
    parentCategoryId?: string | null
    transferAccountId?: string | null
    isTransfer?: boolean
    transactionType?: string | null
    performedByUserId?: string | null
    deletedAt?: string | null
  },
) {
  const isTransfer = t.isTransfer ?? Boolean(t.transferAccountId)
  db.insert(s.transactions)
    .values({
      id: t.id,
      accountId: t.accountId,
      status: t.status ?? 'SETTLED',
      amountCents: t.amountCents,
      currency: 'AUD',
      description: t.description ?? 'Merchant',
      categoryId: t.categoryId ?? null,
      parentCategoryId: t.parentCategoryId ?? null,
      isCategorizable: !isTransfer,
      transferAccountId: t.transferAccountId ?? null,
      isTransfer,
      transactionType: t.transactionType ?? (isTransfer ? 'Transfer' : 'Purchase'),
      performedByUserId: t.performedByUserId ?? null,
      createdAt: t.createdAt,
      deletedAt: t.deletedAt ?? null,
      rawJson: '{}',
      syncedAt: STAMP,
    })
    .run()
}

export function seedCategories(db: Db, rows: { id: string; name: string; parentId: string | null }[]) {
  db.insert(s.categories).values(rows).run()
}

/** "ACME PAY" deposits of `amountCents` every 14 days from `from`, ids pay0, pay1, … */
export function seedPays(db: Db, accountId: string, from: string, count: number, amountCents = 400000) {
  const t0 = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const dates: string[] = []
  for (let i = 0; i < count; i++) {
    const date = new Date(t0 + i * 14 * 86_400_000).toISOString().slice(0, 10)
    dates.push(date)
    seedTx(db, { id: `pay${i}`, accountId, amountCents, createdAt: local(date), description: 'ACME PAY' })
  }
  return dates
}

/** Detected pay events straight into pay_events (no schedule needed). */
export function seedEvents(db: Db, userId: string, dates: string[], amountCents = 400000) {
  db.insert(s.payEvents)
    .values(
      dates.map((payDate, i) => ({
        userId,
        payDate,
        source: 'detected' as const,
        transactionId: `${userId}-pay${i}`,
        amountCents,
        derivedAt: STAMP,
      })),
    )
    .run()
}
