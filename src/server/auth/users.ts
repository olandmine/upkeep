import { randomUUID } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import type { UserDto } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { UserRow } from '../db/schema'
import { hashPassword } from './passwords'

export const MAX_USERS = 2

// New logins are an Up $handle, typed with or without the "$".
export const normaliseUsername = (username: string) => username.trim().replace(/^\$/, '').toLowerCase()
const upHandle = (username: string) => `$${username.trim().replace(/^\$/, '')}`

export function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    upDisplayName: u.upDisplayName,
    negativeStyle: u.negativeStyle,
    accent: u.accent,
    sharingLevel: u.sharingLevel,
    connectUpAnswered: u.connectUpAnswered,
    gettingStartedHidden: u.gettingStartedHidden,
  }
}

export function countUsers(db: Db): number {
  return db.select({ n: count() }).from(s.users).get()?.n ?? 0
}

export function findUserByUsername(db: Db, username: string): UserRow | undefined {
  return db.select().from(s.users).where(eq(s.users.username, normaliseUsername(username))).get()
}

export async function createUser(
  db: Db,
  input: { username: string; displayName: string; password: string; givenPassword?: 'kept' },
  now: Date,
): Promise<UserRow> {
  const user: UserRow = {
    id: randomUUID(),
    username: normaliseUsername(input.username),
    displayName: input.displayName.trim(),
    passwordHash: await hashPassword(input.password),
    upDisplayName: upHandle(input.username),
    negativeStyle: 'minus',
    accent: 'amber',
    sharingLevel: null,
    connectUpAnswered: false,
    upHandleLeftBlank: false,
    givenPassword: input.givenPassword ?? null,
    gettingStartedHidden: false,
    createdAt: now.toISOString(),
  }
  db.insert(s.users).values(user).run()
  return user
}

/** Records the Connect Up answer once: later connects, skips and disconnects leave it as first given. */
export function answerConnectUp(db: Db, userId: string): void {
  const row = db.select().from(s.users).where(eq(s.users.id, userId)).get()
  if (!row || row.connectUpAnswered) return
  db.update(s.users)
    .set({ connectUpAnswered: true, upHandleLeftBlank: !row.upDisplayName })
    .where(eq(s.users.id, userId))
    .run()
}
