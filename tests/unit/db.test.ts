import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import { migrateDb, openDb, type Db } from '../../src/server/db/client'
import * as s from '../../src/server/db/schema'

let db: Db
const now = '2026-10-29T00:00:00.000Z'

function seedUser(id = 'u1', username = 'owner') {
  db.insert(s.users).values({ id, username, displayName: 'Owner', passwordHash: 'x', createdAt: now }).run()
}

function seedAccount(id = 'acc-1') {
  db.insert(s.accounts)
    .values({
      id,
      displayName: 'Spending',
      accountType: 'TRANSACTIONAL',
      ownership: 'INDIVIDUAL',
      ownerUserId: 'u1',
      balanceCents: 1000,
      currency: 'AUD',
      colorIndex: 0,
      upCreatedAt: now,
      rawJson: '{}',
      updatedAt: now,
    })
    .run()
}

function txValues(id: string, accountId: string) {
  return {
    id,
    accountId,
    status: 'SETTLED' as const,
    amountCents: -500,
    currency: 'AUD',
    description: 'Shop',
    isCategorizable: true,
    isTransfer: false,
    createdAt: now,
    rawJson: '{}',
    syncedAt: now,
  }
}

beforeEach(() => {
  db = openDb(':memory:').db
  migrateDb(db, 'src/server/db/migrations')
})

test('stores a user, account and transaction', () => {
  seedUser()
  seedAccount()
  db.insert(s.transactions).values(txValues('t1', 'acc-1')).run()
  const row = db.select().from(s.transactions).where(eq(s.transactions.id, 't1')).get()
  expect(row).toMatchObject({ amountCents: -500, isCategorizable: true, isTransfer: false, deletedAt: null })
  const user = db.select().from(s.users).get()
  expect(user?.negativeStyle).toBe('minus')
})

test('enforces foreign keys', () => {
  expect(() => db.insert(s.transactions).values(txValues('t1', 'missing')).run()).toThrow(/FOREIGN KEY/)
})

test('enforces unique usernames', () => {
  seedUser('u1', 'owner')
  expect(() => seedUser('u2', 'owner')).toThrow(/UNIQUE/)
})

test('deleting a connection cascades its account visibility', () => {
  seedUser()
  seedAccount()
  db.insert(s.upConnections).values({ id: 'c1', userId: 'u1', tokenCiphertext: 'v1:x', status: 'ok', createdAt: now }).run()
  db.insert(s.accountConnections).values({ accountId: 'acc-1', connectionId: 'c1' }).run()
  db.delete(s.upConnections).where(eq(s.upConnections.id, 'c1')).run()
  expect(db.select().from(s.accountConnections).all()).toEqual([])
})

test('transaction tags cascade with their transaction', () => {
  seedUser()
  seedAccount()
  db.insert(s.transactions).values(txValues('t1', 'acc-1')).run()
  db.insert(s.transactionTags).values({ transactionId: 't1', label: 'bali' }).run()
  db.delete(s.transactions).where(eq(s.transactions.id, 't1')).run()
  expect(db.select().from(s.transactionTags).all()).toEqual([])
})

test('opens a database in a data directory that does not exist yet', () => {
  // e.g. first start with UPKEEP_SECRET_KEY set, so nothing else created DATA_DIR
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'upkeep-db-')), 'fresh', 'data', 'upkeep.db')
  const { db: fresh, sqlite } = openDb(file)
  migrateDb(fresh, 'src/server/db/migrations')
  expect(fresh.select().from(s.users).all()).toEqual([])
  sqlite.close()
})

test('migration 0002 backfills transaction_type from raw_json', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'upkeep-mig-'))
  cpSync('src/server/db/migrations', dir, { recursive: true })
  const journalPath = path.join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] }
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }))

  const { db: old, sqlite } = openDb(':memory:')
  migrateDb(old, dir)
  sqlite
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES ('u1', 'owner', 'Owner', 'x', ?)`,
    )
    .run(now)
  sqlite
    .prepare(
      `INSERT INTO accounts (id, display_name, account_type, ownership, owner_user_id, balance_cents, currency, color_index, up_created_at, raw_json, updated_at)
       VALUES ('acc-1', 'Spending', 'TRANSACTIONAL', 'INDIVIDUAL', 'u1', 0, 'AUD', 0, ?, '{}', ?)`,
    )
    .run(now, now)
  sqlite
    .prepare(
      `INSERT INTO transactions (id, account_id, status, amount_cents, currency, description, is_categorizable, is_transfer, created_at, raw_json, synced_at)
       VALUES ('t1', 'acc-1', 'SETTLED', -500, 'AUD', 'Shop', 1, 1, ?, '{"attributes":{"transactionType":"Transfer"}}', ?)`,
    )
    .run(now, now)

  writeFileSync(journalPath, JSON.stringify(journal))
  migrateDb(old, dir)
  expect(old.select().from(s.transactions).where(eq(s.transactions.id, 't1')).get()?.transactionType).toBe('Transfer')
  sqlite.close()
})

/** Drizzle wraps SQLite errors; the constraint message is on `cause`. */
function causeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return String((err as { cause?: unknown }).cause ?? err)
  }
  return 'no error'
}

test('migration 0004 creates the debts and goals tables', () => {
  seedUser()
  const debt = (id: string) =>
    db.run(
      sql`INSERT INTO debts (id, owner_user_id, kind, name, repayment_cents, repayment_frequency, created_by_user_id, created_at, updated_at)
          VALUES (${id}, 'u1', 'loan', 'Car', 0, 'monthly', 'u1', ${now}, ${now})`,
    )
  debt('d1')
  debt('d2')
  // One description marks one debt's repayments (0006).
  const rule = (debtId: string) =>
    db.run(sql`INSERT INTO debt_repayment_rules (id, debt_id, match) VALUES (${crypto.randomUUID()}, ${debtId}, 'acme')`)
  rule('d1')
  expect(causeOf(() => rule('d2'))).toMatch(/UNIQUE/)
  const balance = () =>
    db.run(sql`INSERT INTO debt_balances (id, debt_id, as_of, balance_cents, created_at)
               VALUES (${crypto.randomUUID()}, 'd1', '2026-10-01', 100, ${now})`)
  balance()
  expect(causeOf(balance)).toMatch(/UNIQUE/)
  db.run(sql`INSERT INTO goals (account_id, name, target_cents, created_at, updated_at)
             VALUES ('no-such-account', 'Holiday', 100, ${now}, ${now})`)
})

test("migration 0006 moves each debt's repayment rule into its own table", () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'upkeep-mig-'))
  cpSync('src/server/db/migrations', dir, { recursive: true })
  const journalPath = path.join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] }
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 6) }))

  const { db: old, sqlite } = openDb(':memory:')
  migrateDb(old, dir)
  const debt = sqlite.prepare(
    `INSERT INTO debts (id, owner_user_id, kind, name, rate_bp, repayment_cents, repayment_frequency, repayment_match, created_by_user_id, created_at, updated_at)
     VALUES (?, NULL, 'loan', 'Car', 0, 0, 'monthly', ?, 'u1', ?, ?)`,
  )
  debt.run('d1', 'acme car finance', now, now)
  debt.run('d2', null, now, now)
  // Every debt has a balance; 0007 dates its first rate from it.
  for (const id of ['d1', 'd2']) {
    sqlite
      .prepare(`INSERT INTO debt_balances (id, debt_id, as_of, balance_cents, created_at) VALUES (?, ?, '2026-10-01', 100, ?)`)
      .run(`b-${id}`, id, now)
  }

  writeFileSync(journalPath, JSON.stringify(journal))
  migrateDb(old, dir)
  expect(old.select({ debtId: s.debtRepaymentRules.debtId, match: s.debtRepaymentRules.match }).from(s.debtRepaymentRules).all()).toEqual([
    { debtId: 'd1', match: 'acme car finance' },
  ])
  sqlite.close()
})

test('migration 0007 moves the rate and sets interest by kind', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'upkeep-mig-'))
  cpSync('src/server/db/migrations', dir, { recursive: true })
  const journalPath = path.join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] }
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 7) }))

  const { db: old, sqlite } = openDb(':memory:')
  migrateDb(old, dir)
  const debt = sqlite.prepare(
    `INSERT INTO debts (id, owner_user_id, kind, name, rate_bp, repayment_cents, repayment_frequency, created_by_user_id, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, 0, 'monthly', 'u1', ?, ?)`,
  )
  debt.run('d1', 'loan', 'Car', 1200, now, now)
  debt.run('d2', 'ato', 'Tax', 1063, now, now)
  debt.run('d3', 'hecs', 'HECS', 320, now, now)
  debt.run('d4', 'bnpl', 'Laptop', 0, now, now)
  const balance = sqlite.prepare(
    `INSERT INTO debt_balances (id, debt_id, as_of, balance_cents, created_at) VALUES (?, ?, ?, 100, ?)`,
  )
  balance.run('b1', 'd1', '2026-03-20', now)
  balance.run('b2', 'd1', '2026-01-15', now)
  balance.run('b3', 'd2', '2026-05-14', now)
  balance.run('b4', 'd3', '2026-07-01', now)
  balance.run('b5', 'd4', '2026-08-31', now)

  writeFileSync(journalPath, JSON.stringify(journal))
  migrateDb(old, dir)
  expect(
    sqlite
      .prepare(
        `SELECT id, interest_calc, interest_charge, interest_charge_day, interest_charge_date FROM debts ORDER BY id`,
      )
      .all(),
  ).toEqual([
    { id: 'd1', interest_calc: 'on_charge', interest_charge: 'monthly', interest_charge_day: 15, interest_charge_date: null },
    { id: 'd2', interest_calc: 'daily', interest_charge: 'monthly', interest_charge_day: 1, interest_charge_date: null },
    { id: 'd3', interest_calc: 'on_charge', interest_charge: 'yearly', interest_charge_day: null, interest_charge_date: '06-01' },
    { id: 'd4', interest_calc: 'on_charge', interest_charge: 'monthly', interest_charge_day: 1, interest_charge_date: null },
  ])
  expect(sqlite.prepare(`SELECT debt_id, from_date, rate_bp, created_at FROM debt_rates ORDER BY debt_id`).all()).toEqual([
    { debt_id: 'd1', from_date: '2026-01-15', rate_bp: 1200, created_at: now },
    { debt_id: 'd2', from_date: '2026-05-14', rate_bp: 1063, created_at: now },
    { debt_id: 'd3', from_date: '2026-07-01', rate_bp: 320, created_at: now },
    { debt_id: 'd4', from_date: '2026-08-31', rate_bp: 0, created_at: now },
  ])
  sqlite.close()
})

test("migration 0012 backfills each goal's start", () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'upkeep-mig-'))
  cpSync('src/server/db/migrations', dir, { recursive: true })
  const journalPath = path.join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] }
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 12) }))

  const { db: old, sqlite } = openDb(':memory:')
  migrateDb(old, dir)
  const created = '2026-09-01T00:00:00.000Z'
  sqlite
    .prepare(`INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES ('u1', 'owner', 'Owner', 'x', ?)`)
    .run(now)
  sqlite
    .prepare(
      `INSERT INTO accounts (id, display_name, account_type, ownership, owner_user_id, balance_cents, currency, color_index, up_created_at, raw_json, updated_at)
       VALUES ('acc-1', 'Saver', 'SAVER', 'INDIVIDUAL', 'u1', 50000, 'AUD', 0, ?, '{}', ?)`,
    )
    .run(now, now)
  const goal = sqlite.prepare(
    `INSERT INTO goals (account_id, name, target_cents, created_at, updated_at) VALUES (?, 'Holiday', 100000, ?, ?)`,
  )
  goal.run('acc-1', created, created)
  goal.run('gone', created, created)
  const tx = sqlite.prepare(
    `INSERT INTO transactions (id, account_id, status, amount_cents, currency, description, is_categorizable, is_transfer, created_at, deleted_at, raw_json, synced_at)
     VALUES (?, 'acc-1', 'SETTLED', ?, 'AUD', 'Deposit', 0, 0, ?, ?, '{}', ?)`,
  )
  tx.run('t1', 10_000, '2026-08-15T00:00:00.000Z', null, now)
  tx.run('t2', 20_000, '2026-09-10T00:00:00.000Z', null, now)
  tx.run('t3', 5_000, '2026-09-20T00:00:00.000Z', null, now)
  tx.run('t4', 99_000, '2026-09-15T00:00:00.000Z', now, now)

  writeFileSync(journalPath, JSON.stringify(journal))
  migrateDb(old, dir)
  expect(sqlite.prepare(`SELECT account_id, kind, start_cents, started_at FROM goals ORDER BY account_id`).all()).toEqual([
    { account_id: 'acc-1', kind: 'save', start_cents: 25_000, started_at: '2026-09-01T00:00:00.000Z' },
    { account_id: 'gone', kind: 'save', start_cents: 0, started_at: '2026-09-01T00:00:00.000Z' },
  ])

  // A debt is followed by at most one goal.
  const debt = sqlite.prepare(
    `INSERT INTO debts (id, owner_user_id, kind, name, repayment_cents, repayment_frequency, created_by_user_id, created_at, updated_at)
     VALUES (?, NULL, 'loan', 'Car', 0, 'monthly', 'u1', ?, ?)`,
  )
  debt.run('d1', now, now)
  debt.run('d2', now, now)
  const follow = sqlite.prepare(
    `INSERT INTO goals (account_id, name, target_cents, kind, debt_id, created_at, updated_at) VALUES (?, 'Car off', 100, 'debt', ?, ?, ?)`,
  )
  follow.run('g1', 'd1', now, now)
  expect(() => follow.run('g2', 'd1', now, now)).toThrow(/UNIQUE/)
  const plain = sqlite.prepare(
    `INSERT INTO goals (account_id, name, target_cents, created_at, updated_at) VALUES (?, 'Plain', 100, ?, ?)`,
  )
  plain.run('g3', now, now)
  plain.run('g4', now, now)
  sqlite.close()
})

test('migration 0013 creates the reached columns and tables', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'upkeep-mig-'))
  cpSync('src/server/db/migrations', dir, { recursive: true })
  const journalPath = path.join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] }
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 13) }))

  const { db: old, sqlite } = openDb(':memory:')
  migrateDb(old, dir)
  sqlite
    .prepare(`INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES ('u1', 'owner', 'Owner', 'x', ?)`)
    .run(now)
  sqlite
    .prepare(`INSERT INTO goals (account_id, name, target_cents, created_at, updated_at) VALUES ('acc-1', 'Holiday', 100000, ?, ?)`)
    .run(now, now)

  writeFileSync(journalPath, JSON.stringify(journal))
  migrateDb(old, dir)
  expect(sqlite.prepare(`SELECT reached_on FROM goals`).all()).toEqual([{ reached_on: null }])

  sqlite.prepare(`INSERT INTO goal_celebrations_seen (account_id, user_id, reached_on) VALUES ('acc-1', 'u1', '2026-10-30')`).run()
  sqlite
    .prepare(
      `INSERT INTO archived_goals (id, account_id, owner_user_id, saver_name, name, kind, target_cents, reached_on, archived_at)
       VALUES ('a1', 'acc-1', 'u1', 'Holiday', 'Trip', 'save', 100000, '2026-10-30', ?)`,
    )
    .run(now)
  expect(sqlite.prepare(`SELECT debt_paid_off FROM archived_goals`).all()).toEqual([{ debt_paid_off: 0 }])
  sqlite.prepare(`DELETE FROM users WHERE id = 'u1'`).run()
  expect(sqlite.prepare(`SELECT * FROM goal_celebrations_seen`).all()).toEqual([])
  expect(sqlite.prepare(`SELECT * FROM archived_goals`).all()).toEqual([])
  sqlite.close()
})
