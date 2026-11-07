import { count, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { UpAccount, UpCategory, UpTransaction } from '../up/schemas'
import { mapTransaction } from './map'

const PALETTE_SIZE = 8

export function upsertAccounts(
  db: Db,
  conn: { id: string; userId: string },
  accounts: UpAccount[],
  now = new Date().toISOString(),
): void {
  db.transaction((tx) => {
    for (const a of accounts) {
      const attrs = a.attributes
      const joint = attrs.ownershipType === 'JOINT'
      const values = {
        displayName: attrs.displayName,
        accountType: attrs.accountType,
        ownership: attrs.ownershipType,
        ownerUserId: joint ? null : conn.userId,
        balanceCents: attrs.balance.valueInBaseUnits,
        currency: attrs.balance.currencyCode,
        upCreatedAt: new Date(attrs.createdAt).toISOString(),
        rawJson: JSON.stringify(a),
        updatedAt: now,
      }
      const existing = tx.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.id, a.id)).get()
      if (existing) {
        tx.update(s.accounts).set(values).where(eq(s.accounts.id, a.id)).run()
      } else {
        const n = tx.select({ n: count() }).from(s.accounts).get()?.n ?? 0
        tx.insert(s.accounts)
          .values({ id: a.id, ...values, colorIndex: n % PALETTE_SIZE })
          .run()
      }
      tx.insert(s.accountConnections).values({ accountId: a.id, connectionId: conn.id }).onConflictDoNothing().run()
    }
  })
}

export function upsertTransactions(
  db: Db,
  txs: UpTransaction[],
  syncedAt: string,
): { upserted: number; missingAccountIds: string[] } {
  return db.transaction((tx) => {
    const knownAccountIds = new Set(tx.select({ id: s.accounts.id }).from(s.accounts).all().map((a) => a.id))
    const users = tx.select({ id: s.users.id, upDisplayName: s.users.upDisplayName }).from(s.users).all()
    const missing = new Set<string>()
    let upserted = 0

    for (const t of txs) {
      const { row, tags } = mapTransaction(t, { users, knownAccountIds, syncedAt })
      if (!knownAccountIds.has(row.accountId)) {
        missing.add(row.accountId)
        continue
      }
      const { id: _id, ...update } = row
      tx.insert(s.transactions).values(row).onConflictDoUpdate({ target: s.transactions.id, set: update }).run()
      tx.delete(s.transactionTags).where(eq(s.transactionTags.transactionId, row.id)).run()
      for (const label of tags) {
        tx.insert(s.transactionTags).values({ transactionId: row.id, label }).run()
        tx.insert(s.tags).values({ label }).onConflictDoNothing().run()
      }
      upserted++
    }
    return { upserted, missingAccountIds: [...missing] }
  })
}

export function upsertCategories(db: Db, cats: UpCategory[]): void {
  db.transaction((tx) => {
    for (const c of cats) {
      const values = { name: c.attributes.name, parentId: c.relationships.parent.data?.id ?? null }
      tx.insert(s.categories)
        .values({ id: c.id, ...values })
        .onConflictDoUpdate({ target: s.categories.id, set: values })
        .run()
    }
  })
}

/** Replace the tag catalogue with Up's list. */
export function replaceTags(db: Db, labels: string[]): void {
  db.transaction((tx) => {
    tx.delete(s.tags).run()
    for (const label of new Set(labels)) tx.insert(s.tags).values({ label }).run()
  })
}
