import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import { createSession, deleteSession, validateSession } from '../../src/server/auth/sessions'
import type { Db } from '../../src/server/db/client'
import * as s from '../../src/server/db/schema'
import { createTestDb } from '../helpers/db'

const DAY = 86_400_000
const t0 = new Date('2026-10-01T00:00:00Z')
const later = (ms: number) => new Date(t0.getTime() + ms)
let db: Db

beforeEach(() => {
  db = createTestDb()
  db.insert(s.users).values({ id: 'u1', username: 'owner', displayName: 'Owner', passwordHash: 'x', createdAt: t0.toISOString() }).run()
})

test('creates a session stored by hash with a 90-day expiry', () => {
  const { token, expiresAt } = createSession(db, 'u1', t0)
  expect(expiresAt).toBe(later(90 * DAY).toISOString())
  const row = db.select().from(s.sessions).get()
  expect(row?.id).not.toBe(token)
  expect(row?.id).toMatch(/^[0-9a-f]{64}$/)
  expect(validateSession(db, token, t0)).toMatchObject({ user: { id: 'u1' }, renewedExpiresAt: null })
})

test('sliding renewal at most daily', () => {
  const { token } = createSession(db, 'u1', t0)
  validateSession(db, token, later(3_600_000))
  expect(db.select().from(s.sessions).get()?.expiresAt).toBe(later(90 * DAY).toISOString())
  expect(validateSession(db, token, later(2 * DAY))?.renewedExpiresAt).toBe(later(92 * DAY).toISOString())
  const row = db.select().from(s.sessions).get()
  expect(row?.expiresAt).toBe(later(92 * DAY).toISOString())
  expect(row?.lastSeenAt).toBe(later(2 * DAY).toISOString())
})

test('expired and unknown sessions are invalid', () => {
  const { token } = createSession(db, 'u1', t0)
  expect(validateSession(db, token, later(91 * DAY))).toBeNull()
  expect(validateSession(db, 'nope', t0)).toBeNull()
})

test('deleteSession removes it', () => {
  const { token } = createSession(db, 'u1', t0)
  deleteSession(db, token)
  expect(db.select().from(s.sessions).where(eq(s.sessions.userId, 'u1')).all()).toEqual([])
})
