import { readdirSync, readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { expect, test } from 'vitest'

const DIR = 'src/server/db/migrations'
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
const run = (db: Database.Database, file: string) => {
  for (const stmt of readFileSync(`${DIR}/${file}`, 'utf8').split('--> statement-breakpoint')) db.exec(stmt)
}

test('0015 marks people who already connected Up as answered, with the card hidden', () => {
  const db = new Database(':memory:')
  for (const f of files.filter((f) => f < '0015')) run(db, f)

  for (const [id, name] of [['u1', 'connected'], ['u2', 'other']]) {
    db.prepare(
      "INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, 'x', '2026-01-01T00:00:00Z')",
    ).run(id, name, name)
  }
  db.prepare(
    "INSERT INTO up_connections (id, user_id, token_ciphertext, status, created_at) VALUES ('c1', 'u1', 'x', 'ok', '2026-01-01T00:00:00Z')",
  ).run()

  const next = files.find((f) => f.startsWith('0015_onboarding'))
  expect(next).toBeDefined()
  run(db, next!)

  const get = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>
  expect(get('u1')).toMatchObject({ connect_up_answered: 1, getting_started_hidden: 1 })
  expect(get('u2')).toMatchObject({ connect_up_answered: 0, getting_started_hidden: 0 })
  for (const id of ['u1', 'u2']) expect(get(id)).toMatchObject({ up_handle_left_blank: 0, given_password: null })
})
