import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { createUser } from '../../src/server/auth/users'
import { openDb } from '../../src/server/db/client'
import { SHARING_LEVELS } from '../../src/shared/sharing'
import { createTestApp, PARTNER } from '../helpers/app'

test.each(SHARING_LEVELS)('PATCH /api/me sets sharing level %s', async (level) => {
  const t = createTestApp()
  const cookie = await t.setupOwner()
  const res = await t.json('/api/me', { method: 'PATCH', body: { sharingLevel: level }, cookie })
  expect(res.status).toBe(200)
  expect((await res.json()).sharingLevel).toBe(level)
  expect((await (await t.json('/api/me', { cookie })).json()).sharingLevel).toBe(level)
})

test.each([null, 'everything'])('PATCH /api/me rejects sharing level %s', async (level) => {
  const t = createTestApp()
  const cookie = await t.setupOwner()
  const res = await t.json('/api/me', { method: 'PATCH', body: { sharingLevel: level }, cookie })
  expect(res.status).toBe(400)
})

test('createUser stores no level', async () => {
  const t = createTestApp()
  const user = await createUser(t.db, { username: 'new', displayName: 'New', password: 'correct horse' }, new Date())
  expect(user.sharingLevel).toBeNull()
})

test('POST /api/users ignores a sharingLevel in the body', async () => {
  const t = createTestApp()
  const cookie = await t.setupOwner()
  const res = await t.json('/api/users', { method: 'POST', body: { ...PARTNER, sharingLevel: 'full' }, cookie })
  expect(res.status).toBe(201)
  expect((await res.json()).sharingLevel).toBeNull()
})

test("a user cannot change the other person's level", async () => {
  const t = createTestApp()
  const ownerCookie = await t.setupOwner()
  const partnerCookie = await t.addPartner(ownerCookie)
  await t.json('/api/me', { method: 'PATCH', body: { sharingLevel: 'balances' }, cookie: ownerCookie })
  const users = await (await t.json('/api/users', { cookie: partnerCookie })).json()
  expect(users.map((u: { username: string; sharingLevel: string }) => [u.username, u.sharingLevel])).toEqual([
    ['owner', 'balances'],
    ['partner', 'full'],
  ])
})

const MIGRATIONS = 'src/server/db/migrations'

/** An empty database with every migration before `tag` applied, and a way to apply one more by hand. */
function databaseBefore(tag: string) {
  const { db, sqlite } = openDb(':memory:')
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as { entries: { tag: string }[] }
  const files = journal.entries.map((e) => e.tag)
  expect(files).toContain(tag)
  const run = (name: string) => {
    for (const stmt of readFileSync(`${MIGRATIONS}/${name}.sql`, 'utf8').split('--> statement-breakpoint')) sqlite.exec(stmt)
  }
  for (const name of files.slice(0, files.indexOf(tag))) run(name)
  return { db, sqlite, run }
}

test('migration 0010 sets full for people with an Up connection and leaves the rest unchosen', () => {
  const { db, sqlite, run } = databaseBefore('0010_sharing_level')
  const stamp = '2026-01-01T00:00:00.000Z'
  const insertUser = sqlite.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, 'x', '${stamp}')`,
  )
  insertUser.run('with', 'with', 'With')
  insertUser.run('without', 'without', 'Without')
  sqlite
    .prepare(
      `INSERT INTO up_connections (id, user_id, token_ciphertext, status, created_at) VALUES ('c1', 'with', 'v1:x', 'ok', '${stamp}')`,
    )
    .run()
  run('0010_sharing_level')
  const levels = sqlite.prepare('SELECT id, sharing_level AS level FROM users ORDER BY id').all()
  expect(levels).toEqual([
    { id: 'with', level: 'full' },
    { id: 'without', level: null },
  ])
  void db
})

test('migration 0011 agrees existing joint rules for connected people only', () => {
  const { sqlite, run } = databaseBefore('0011_rule_people')
  const stamp = '2026-01-01T00:00:00.000Z'
  const insertUser = sqlite.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, created_at, sharing_level) VALUES (?, ?, ?, 'x', '${stamp}', 'none')`,
  )
  insertUser.run('with', 'with', 'With')
  insertUser.run('without', 'without', 'Without')
  sqlite
    .prepare(`INSERT INTO up_connections (id, user_id, token_ciphertext, status, created_at) VALUES ('c1', 'with', 'v1:x', 'ok', '${stamp}')`)
    .run()
  const insertDebt = sqlite.prepare(
    `INSERT INTO debts (id, owner_user_id, kind, name, repayment_cents, repayment_frequency, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, 'loan', ?, 100, 'monthly', 'with', '${stamp}', '${stamp}')`,
  )
  insertDebt.run('joint', null, 'Joint')
  insertDebt.run('personal', 'with', 'Personal')
  const insertRule = sqlite.prepare('INSERT INTO debt_repayment_rules (id, debt_id, match) VALUES (?, ?, ?)')
  insertRule.run('joint-rule', 'joint', 'joint shop')
  insertRule.run('personal-rule', 'personal', 'personal shop')

  run('0011_rule_people')

  expect(sqlite.prepare('SELECT rule_id AS ruleId, user_id AS userId FROM debt_repayment_rule_people').all()).toEqual([
    { ruleId: 'joint-rule', userId: 'with' },
  ])
  expect(sqlite.pragma('foreign_key_check')).toEqual([])
  sqlite.prepare("DELETE FROM debt_repayment_rules WHERE id = 'joint-rule'").run()
  expect(sqlite.prepare('SELECT count(*) AS n FROM debt_repayment_rule_people').get()).toEqual({ n: 0 })
})
