import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export function openDb(file: string): { db: Db; sqlite: Database.Database } {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  const sqlite = new Database(file)
  if (file !== ':memory:') sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  return { db: drizzle(sqlite, { schema }), sqlite }
}

export function migrateDb(db: Db, migrationsDir: string): void {
  migrate(db, { migrationsFolder: migrationsDir })
}
