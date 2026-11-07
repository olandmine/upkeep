import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { SpendingHistoryDto } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { BudgetRow } from '../db/schema'
import { budgetAccountIds } from './budgets'
import { addDays, type LocalDate } from './dates'
import { BudgetError } from './errors'
import { finishedPeriods } from './standard-pay'
import { periodFilter, spendingGroups } from './status'

const DOLLAR = 100

/** Recent spending to suggest buckets from: the finished pays Standard pay counts, or the current pay when none has finished. */
export function getSpendingHistory(db: Db, budget: BudgetRow, today: LocalDate, tz: string): SpendingHistoryDto {
  const pays = finishedPeriods(db, budget, today)
  if (!pays) throw new BudgetError(404, 'No pay periods yet')
  const periods = pays.periods.length ? pays.periods : [pays.current]
  const first = periods[0]!
  const last = periods[periods.length - 1]!
  const inWindow = periodFilter({ ...first, end: last.end }, tz)
  const accountIds = budgetAccountIds(db, budget)

  const spent = new Map<string, number>()
  for (const g of spendingGroups(db, accountIds, inWindow)) {
    if (g.categoryId) spent.set(g.categoryId, (spent.get(g.categoryId) ?? 0) - g.cents)
  }
  const categories = [...spent]
    .sort(([aId, a], [bId, b]) => b - a || aId.localeCompare(bId))
    .map(([categoryId, cents]) => ({
      categoryId,
      perPayCents: Math.round(cents / periods.length / DOLLAR) * DOLLAR,
    }))
    .filter((c) => c.perPayCents > 0)

  const uncategorised = accountIds.length
    ? db
        .select({
          count: sql<number>`count(*)`,
          cents: sql<number>`coalesce(-sum(${s.transactions.amountCents}), 0)`,
        })
        .from(s.transactions)
        .where(
          and(
            inArray(s.transactions.accountId, accountIds),
            isNull(s.transactions.categoryId),
            eq(s.transactions.isTransfer, false),
            eq(s.transactions.isCategorizable, true),
            lt(s.transactions.amountCents, 0),
            inWindow,
          ),
        )
        .get()!
    : { count: 0, cents: 0 }

  return {
    from: first.start,
    to: last.end ? addDays(last.end, -1) : today,
    payCount: periods.length,
    categories,
    uncategorised,
  }
}
