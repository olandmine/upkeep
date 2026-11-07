import { asc, eq, inArray } from 'drizzle-orm'
import type { AccountDto, Scope } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { scopeAccountIds } from './scope'

function query(db: Db) {
  return db
    .select({ account: s.accounts, ownerName: s.users.displayName })
    .from(s.accounts)
    .leftJoin(s.users, eq(s.users.id, s.accounts.ownerUserId))
}

function toDto(row: { account: typeof s.accounts.$inferSelect; ownerName: string | null }): AccountDto {
  const a = row.account
  return {
    id: a.id,
    displayName: a.displayName,
    accountType: a.accountType,
    ownership: a.ownership === 'JOINT' ? 'JOINT' : 'INDIVIDUAL',
    ownerUserId: a.ownerUserId,
    ownerName: row.ownerName,
    balanceCents: a.balanceCents,
    currency: a.currency,
    colorIndex: a.colorIndex,
  }
}

export function listAccounts(db: Db, scope: Scope, userId: string): AccountDto[] {
  const ids = scopeAccountIds(db, scope, userId, 'balances')
  if (!ids.length) return []
  return query(db)
    .where(inArray(s.accounts.id, ids))
    .orderBy(asc(s.accounts.colorIndex))
    .all()
    .map(toDto)
}

export function getAccount(db: Db, id: string): AccountDto | null {
  const row = query(db).where(eq(s.accounts.id, id)).get()
  return row ? toDto(row) : null
}
