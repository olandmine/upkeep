import { and, gte, inArray, isNull, sql } from 'drizzle-orm'
import type { NetWorthDto, NetWorthRange, Scope } from '../../shared/types'
import { addDays, localDate, periodRangeUtc, type LocalDate } from '../budgets/dates'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { debtLedgerFor, debtsInScope } from '../debts/debts'
import { scopeAccountIds } from '../queries/scope'
import { historyStart, pointDates, rebuildTotals, type Delta } from './rebuild'

/** Up balances minus tracked debts, rebuilt backwards from today. */
export function getNetWorth(
  db: Db,
  scope: Scope,
  viewerId: string,
  range: NetWorthRange,
  today: LocalDate,
  tz: string,
): NetWorthDto {
  const ids = scopeAccountIds(db, scope, viewerId, 'balances')
  const accounts = ids.length ? db.select().from(s.accounts).where(inArray(s.accounts.id, ids)).all() : []
  const counted = and(inArray(s.transactions.accountId, ids), isNull(s.transactions.deletedAt))
  // A purchase's round-up leaves Spending separately from its amount (ARCHITECTURE "Round-ups").
  const cents = sql<number>`${s.transactions.amountCents} + coalesce(${s.transactions.roundUpCents}, 0)`

  // Per-account totals and first transaction for the history check, in SQL.
  const totals = new Map(
    (ids.length
      ? db
          .select({
            accountId: s.transactions.accountId,
            total: sql<number>`sum(${cents})`,
            first: sql<string>`min(${s.transactions.createdAt})`,
          })
          .from(s.transactions)
          .where(counted)
          .groupBy(s.transactions.accountId)
          .all()
      : []
    ).map((r) => [r.accountId, r]),
  )
  const firstDates = [...totals.values()].map((t) => localDate(t.first, tz))
  const firstDate = firstDates.reduce((min, d) => (d < min ? d : min), today)
  const historyFrom = historyStart(
    accounts.map((a) => {
      const t = totals.get(a.id)
      return {
        type: a.accountType,
        balanceNow: a.balanceCents,
        totalCents: Number(t?.total ?? 0),
        firstDate: t ? localDate(t.first, tz) : null,
      }
    }),
  )
  const dates = pointDates(range, today, historyFrom ?? firstDate).filter(
    (d) => !historyFrom || d >= historyFrom,
  )

  // End of each local day as a UTC instant; transactions compare against it as ISO strings.
  const cutoffs = dates.map((d) => periodRangeUtc(d, addDays(d, 1), tz).end)
  const since = cutoffs[0]
  const deltas: Delta[] =
    ids.length && since
      ? db
          .select({ at: s.transactions.createdAt, cents })
          .from(s.transactions)
          .where(and(counted, gte(s.transactions.createdAt, since)))
          .all()
      : []
  const balanceNow = accounts.reduce((sum, a) => sum + a.balanceCents, 0)
  const up = rebuildTotals(balanceNow, deltas, cutoffs)

  const debt = dates.map(() => 0)
  for (const row of debtsInScope(db, scope, viewerId)) {
    const byDate = new Map(debtLedgerFor(db, row, today, tz).ledger.days.map((d) => [d.date, d.balance]))
    dates.forEach((date, i) => (debt[i]! += byDate.get(date) ?? 0))
  }

  const points = dates.map((date, i) => {
    const upCents = Math.round(up[i]!)
    const debtCents = Math.round(debt[i]!)
    return { date, upCents, debtCents, netCents: upCents - debtCents }
  })
  const todayCents = points.at(-1)?.netCents ?? 0
  return { points, historyFrom, todayCents, changeCents: todayCents - (points[0]?.netCents ?? 0) }
}
