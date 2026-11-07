import { migrateDb, openDb, type Db } from '../../src/server/db/client'

export function createTestDb(): Db {
  const { db } = openDb(':memory:')
  migrateDb(db, 'src/server/db/migrations')
  return db
}
