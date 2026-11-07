import { eq } from 'drizzle-orm'
import type { BudgetDto } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { BudgetRow } from '../db/schema'
import { getSchedule } from './pay-schedule'

/** Whether a budget can be planned yet: its pay person (the owner, or the Joint anchor) must be connected and have a pay schedule. */
export function budgetSetup(db: Db, b: BudgetRow): BudgetDto['setup'] {
  const relevant = b.kind === 'joint' ? b.anchorUserId : b.ownerUserId
  const connected = relevant
    ? Boolean(db.select().from(s.upConnections).where(eq(s.upConnections.userId, relevant)).get())
    : false
  return !connected ? 'partner-not-connected' : relevant && getSchedule(db, relevant) ? 'ready' : 'needs-pay'
}
