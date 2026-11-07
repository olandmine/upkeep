import { eq, inArray } from 'drizzle-orm'
import type { BudgetPeriodDto, LineStatusDto, StandardPayDto } from '../../shared/types'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { BudgetRow } from '../db/schema'
import { budgetAccountIds, budgetPayEvents, findPeriod, type Period } from './budgets'
import { todayLocal, type LocalDate } from './dates'
import { activeLines, expandCategories, lineColorToken } from './lines'
import { getTemplate } from './plans'
import { movedBack, periodFilter, spendingGroups, spentOn, unclaimedSpend } from './status'
import { goalCaption } from '../goals/goals'

const USUAL_PAYS = 6
const MIN_USUAL_PAYS = 3
const PAY_DAYS = 14

/** The middle value, or the average of the two middle values rounded to the nearest cent. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** The budget's finished pays (the last USUAL_PAYS before the current one) and the current period. */
export function finishedPeriods(db: Db, budget: BudgetRow, today: LocalDate) {
  const current = findPeriod(db, budget, today)
  if (!current) return null
  const events = budgetPayEvents(db, budget).filter((e) => e.payDate <= today)
  const finished = events.slice(0, -1).slice(-USUAL_PAYS)
  return {
    current,
    events: finished,
    periods: finished.map((e) => findPeriod(db, budget, e.payDate)!),
  }
}

/** Each active line's usual spend, Other spending and money moved back, as medians over `periods`. */
function usualPeriod(
  db: Db,
  budget: BudgetRow,
  current: Period,
  periods: Period[],
  today: LocalDate,
  tz: string,
  incomeCents: number,
): BudgetPeriodDto {
  const hasUsual = periods.length >= MIN_USUAL_PAYS
  const lines = activeLines(db, budget.id)
  const expanded = lines.map((l) => expandCategories(db, l.categoryIds))
  const claimed = new Set(expanded.flatMap((e) => [...e]))
  const accountIds = budgetAccountIds(db, budget)

  const perPay = periods.map((p) => {
    const inPeriod = periodFilter(p, tz)
    const groups = spendingGroups(db, accountIds, inPeriod)
    return {
      spent: lines.map((l, i) => (l.categoryIds.length ? Math.max(0, spentOn(groups, expanded[i])) : 0)),
      other: unclaimedSpend(groups, claimed),
      movedBack: movedBack(db, budget.kind, accountIds, inPeriod),
    }
  })

  const savers = new Map(
    lines.length
      ? db
          .select()
          .from(s.accounts)
          .where(
            inArray(
              s.accounts.id,
              lines.flatMap((l) => (l.saverAccountId ? [l.saverAccountId] : [])),
            ),
          )
          .all()
          .map((a) => [a.id, a])
      : [],
  )

  const statuses: LineStatusDto[] = lines.map((line, i) => {
    const saver = line.saverAccountId ? savers.get(line.saverAccountId) : undefined
    return {
      lineId: line.id,
      kind: line.kind,
      name: line.name,
      amountCents: line.amountCents,
      categoryIds: line.categoryIds,
      colorToken: lineColorToken(db, line.categoryIds),
      saverAccountId: line.saverAccountId,
      saverName: saver?.displayName ?? null,
      saverBalanceCents: saver?.balanceCents ?? null,
      saverMissing: Boolean(line.saverAccountId) && !saver,
      spentCents: hasUsual ? median(perPay.map((p) => p.spent[i])) : 0,
      remainingCents: null,
      spentRatio: null,
      state: null,
      coverage: null,
      contributedCents: null,
      withdrawnCents: null,
      contribution: null,
      goal: line.kind === 'fund' && line.saverAccountId ? goalCaption(db, line.saverAccountId, today, tz) : null,
    }
  })

  // The pays counted run from the oldest to where the current pay starts.
  const start = periods[0]?.start ?? current.start
  const spending = statuses.filter((l) => l.kind === 'spending')
  return {
    budgetId: budget.id,
    start,
    end: current.start,
    nominalEnd: current.start,
    isCurrent: false,
    prevDate: null,
    nextDate: null,
    source: 'detected',
    payNotSeen: false,
    daysTotal: PAY_DAYS,
    daysElapsed: PAY_DAYS,
    incomeCents,
    movedBackCents: hasUsual ? median(perPay.map((p) => p.movedBack)) : 0,
    lines: statuses,
    notBudgetedCents: hasUsual ? median(perPay.map((p) => p.other)) : 0,
    totals: {
      limitCents: spending.reduce((sum, l) => sum + l.amountCents, 0),
      spentCents: spending.reduce((sum, l) => sum + l.spentCents, 0),
    },
    beforeSetup: false,
  }
}

/**
 * What a normal pay usually leaves: the plan template and every-pay limits against the medians of the last
 * USUAL_PAYS finished pays. Read-only: it never writes a period snapshot or a pay plan. Null with no plan template
 * or no pay yet.
 */
export function getStandardPay(db: Db, userId: string, now: Date, tz: string): StandardPayDto | null {
  const budget = db.select().from(s.budgets).where(eq(s.budgets.ownerUserId, userId)).get()
  const template = getTemplate(db, userId)
  if (!budget || !template) return null
  const today = todayLocal(now, tz)
  const mine = finishedPeriods(db, budget, today)
  if (!mine) return null

  const known = mine.events.flatMap((e) => (e.amountCents === null ? [] : [e.amountCents]))
  const payIsMedian = known.length >= MIN_USUAL_PAYS
  const incomeCents = payIsMedian ? median(known) : template.expectedIncomeCents

  const jointBudget = db.select().from(s.budgets).where(eq(s.budgets.kind, 'joint')).get()
  const joint = jointBudget ? finishedPeriods(db, jointBudget, today) : null

  return {
    plan: {
      userId,
      payDate: mine.current.start,
      incomeCents,
      incomeIsExpected: !payIsMedian,
      allocatedCents: template.items.reduce((sum, i) => sum + i.amountCents, 0),
      customised: false,
      items: template.items,
    },
    period: usualPeriod(db, budget, mine.current, mine.periods, today, tz, incomeCents),
    jointPeriod: jointBudget && joint ? usualPeriod(db, jointBudget, joint.current, joint.periods, today, tz, 0) : null,
    payCount: mine.periods.length,
    hasUsual: mine.periods.length >= MIN_USUAL_PAYS,
    jointHasUsual: (joint?.periods.length ?? 0) >= MIN_USUAL_PAYS,
    payIsMedian,
  }
}
