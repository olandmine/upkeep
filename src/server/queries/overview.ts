import { and, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { categoryColorToken } from '../../shared/categories'
import type { MonthTotals, OverviewDto, Scope } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { scopeAccountIds } from './scope'
import { monthRangeUtc, shiftMonth } from './time'
import { listTransactions } from './transactions'

const t = s.transactions
const MONTHS_IN_CHART = 6
const TOP_CATEGORIES = 8
const RECENT = 8
const BALANCE_TYPES = ['TRANSACTIONAL', 'SAVER']

const spent = sql<number>`coalesce(sum(case when ${t.amountCents} < 0 then -${t.amountCents} else 0 end), 0)`
const income = sql<number>`coalesce(sum(case when ${t.amountCents} > 0 then ${t.amountCents} else 0 end), 0)`

/** Counted spending/income: in scope, not deleted, not a transfer, HELD included. */
function counted(accountIds: string[], range: { start: string; end: string }): SQL {
  return and(
    inArray(t.accountId, accountIds),
    isNull(t.deletedAt),
    eq(t.isTransfer, false),
    gte(t.createdAt, range.start),
    lt(t.createdAt, range.end),
  )!
}

function monthTotals(db: Db, accountIds: string[], month: string, tz: string): MonthTotals {
  if (!accountIds.length) return { spentCents: 0, incomeCents: 0, netCents: 0 }
  const row = db.select({ spent, income }).from(t).where(counted(accountIds, monthRangeUtc(month, tz))).get()
  const spentCents = Number(row?.spent ?? 0)
  const incomeCents = Number(row?.income ?? 0)
  return { spentCents, incomeCents, netCents: incomeCents - spentCents }
}

export function getOverview(db: Db, p: { month: string; scope: Scope; userId: string; tz: string }): OverviewDto {
  const balanceIds = scopeAccountIds(db, p.scope, p.userId, 'balances')
  const accountIds = scopeAccountIds(db, p.scope, p.userId, 'finances')
  const accounts = balanceIds.length
    ? db.select().from(s.accounts).where(inArray(s.accounts.id, balanceIds)).orderBy(desc(s.accounts.balanceCents)).all()
    : []
  const balanceAccounts = accounts.filter((a) => BALANCE_TYPES.includes(a.accountType))
  const homeLoans = accounts.filter((a) => a.accountType === 'HOME_LOAN')

  const categories = db.select().from(s.categories).all()
  const parentIds = categories.filter((c) => c.parentId === null).map((c) => c.id)
  const nameOf = (id: string | null) => (id === null ? 'Uncategorised' : (categories.find((c) => c.id === id)?.name ?? id))

  let spendingByParent: OverviewDto['spendingByParent'] = []
  let topCategories: OverviewDto['topCategories'] = []
  if (accountIds.length) {
    const outflow = and(counted(accountIds, monthRangeUtc(p.month, p.tz)), lt(t.amountCents, 0))
    const cents = sql<number>`sum(-${t.amountCents})`
    spendingByParent = db
      .select({ parentId: t.parentCategoryId, cents })
      .from(t)
      .where(outflow)
      .groupBy(t.parentCategoryId)
      .orderBy(desc(cents))
      .all()
      .map((r) => ({
        parentId: r.parentId,
        name: nameOf(r.parentId),
        colorToken: categoryColorToken(r.parentId, parentIds),
        cents: Number(r.cents),
      }))
    topCategories = db
      .select({ categoryId: t.categoryId, parentId: t.parentCategoryId, cents })
      .from(t)
      .where(outflow)
      .groupBy(t.categoryId, t.parentCategoryId)
      .orderBy(desc(cents))
      .limit(TOP_CATEGORIES)
      .all()
      .map((r) => ({
        categoryId: r.categoryId,
        name: nameOf(r.categoryId),
        parentId: r.parentId,
        colorToken: categoryColorToken(r.parentId, parentIds),
        cents: Number(r.cents),
      }))
  }

  const monthly = Array.from({ length: MONTHS_IN_CHART }, (_, i) => {
    const month = shiftMonth(p.month, i - (MONTHS_IN_CHART - 1))
    const totals = monthTotals(db, accountIds, month, p.tz)
    return { month, spentCents: totals.spentCents, incomeCents: totals.incomeCents }
  })

  return {
    totalBalanceCents: balanceAccounts.reduce((sum, a) => sum + a.balanceCents, 0),
    homeLoanCents: homeLoans.length ? homeLoans.reduce((sum, a) => sum + a.balanceCents, 0) : null,
    month: monthTotals(db, accountIds, p.month, p.tz),
    previousMonth: monthTotals(db, accountIds, shiftMonth(p.month, -1), p.tz),
    balancesByAccount: balanceAccounts.map((a) => ({
      accountId: a.id,
      displayName: a.displayName,
      colorIndex: a.colorIndex,
      balanceCents: a.balanceCents,
    })),
    spendingByParent,
    topCategories,
    monthly,
    recent: listTransactions(db, { scope: p.scope, userId: p.userId, limit: RECENT }).items,
  }
}
