import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import * as s from '../db/schema'

export type Positions = Record<string, { x: number; y: number }>

export function getLayout(db: Db, userId: string, key: string): Positions {
  const row = db
    .select()
    .from(s.flowLayouts)
    .where(and(eq(s.flowLayouts.userId, userId), eq(s.flowLayouts.key, key)))
    .get()
  return row ? (JSON.parse(row.positionsJson) as Positions) : {}
}

export function putLayout(db: Db, userId: string, key: string, positions: Positions, now: Date): void {
  const set = { positionsJson: JSON.stringify(positions), updatedAt: now.toISOString() }
  db.insert(s.flowLayouts)
    .values({ userId, key, ...set })
    .onConflictDoUpdate({ target: [s.flowLayouts.userId, s.flowLayouts.key], set })
    .run()
}

export function deleteLayout(db: Db, userId: string, key: string): void {
  db.delete(s.flowLayouts)
    .where(and(eq(s.flowLayouts.userId, userId), eq(s.flowLayouts.key, key)))
    .run()
}
