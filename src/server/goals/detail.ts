import { and, eq, gte, isNull } from 'drizzle-orm'
import type { GoalDetailDto, GoalDto, GoalRange } from '../../shared/types'
import { addMonthsClamped, localDate, periodRangeUtc, type LocalDate } from '../budgets/dates'
import { BudgetError } from '../budgets/errors'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { GoalRow } from '../db/schema'
import { debtNextDue } from '../debts/debts'
import { RANGE_MONTHS } from '../networth/rebuild'
import { canSeeAccount } from '../sharing/policy'
import { followedDebt, goalStartDate, planLookup, toGoalDto } from './goals'
import { debtSeries, saverHistory } from './history'

/**
 * A debt goal's gap closes from both ends, so the Saver covers only its share of it: the rest of the combined rate is
 * the debt falling. Clamped because a growing debt or a draining Saver takes that share outside 0..1.
 */
export function projectedSaverCents(
  balanceCents: number,
  targetCents: number,
  combinedRateCents: number,
  fallCents: number,
): number {
  const gap = targetCents - balanceCents
  const covered = combinedRateCents > 0 ? (gap * (combinedRateCents - fallCents)) / combinedRateCents : 0
  return Math.min(Math.max(Math.round(balanceCents + covered), 0), targetCents)
}

function expectedPath(goal: GoalDto, saved: GoalRow | undefined, tz: string): GoalDetailDto['expected'] {
  const target = goal.goal
  if (!saved || !target?.targetDate || goal.status === 'reached' || goal.status === 'date-passed') return null
  return {
    from: { date: goalStartDate(saved, tz), cents: saved.startCents },
    to: { date: target.targetDate, cents: target.targetCents },
  }
}

function projectedPath(goal: GoalDto): GoalDetailDto['projected'] {
  if (goal.status !== 'projected' || !goal.projectedDate || !goal.goal) return null
  const target = goal.goal.targetCents
  return {
    date: goal.projectedDate,
    saverCents: goal.debt
      ? projectedSaverCents(goal.balanceCents, target, goal.recentRateCents ?? 0, goal.debtFallCents ?? 0)
      : target,
  }
}

const monthBounds = (firstDay: LocalDate, tz: string) =>
  periodRangeUtc(firstDay, addMonthsClamped(firstDay, 1, 1), tz)

/**
 * In and out per local month, newest first. A month the range starts partway through still counts whole, so its totals
 * match the rows its bounds list (and the label's month).
 */
function monthTotals(
  db: Db,
  accountId: string,
  range: GoalRange,
  today: LocalDate,
  tz: string,
): GoalDetailDto['months'] {
  const since =
    range === 'all' ? undefined : monthBounds(addMonthsClamped(today, -RANGE_MONTHS[range], 1), tz).start
  const rows = db
    .select({ at: s.transactions.createdAt, cents: s.transactions.amountCents })
    .from(s.transactions)
    .where(
      and(
        eq(s.transactions.accountId, accountId),
        isNull(s.transactions.deletedAt),
        since ? gte(s.transactions.createdAt, since) : undefined,
      ),
    )
    .all()
  const totals = new Map<string, { inCents: number; outCents: number }>()
  for (const { at, cents } of rows) {
    const month = localDate(at, tz).slice(0, 7)
    const total = totals.get(month) ?? { inCents: 0, outCents: 0 }
    if (cents > 0) total.inCents += cents
    else total.outCents -= cents
    totals.set(month, total)
  }
  return [...totals]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([month, total]) => {
      const { start, end } = monthBounds(`${month}-01`, tz)
      return { month, fromIso: start, toIso: end, ...total }
    })
}

/** The goal page. A missing account, one that isn't a Saver and a hidden Saver all look the same. */
export function getGoalDetail(
  db: Db,
  accountId: string,
  range: GoalRange,
  viewerId: string,
  today: LocalDate,
  tz: string,
): GoalDetailDto {
  const saver = db.select().from(s.accounts).where(eq(s.accounts.id, accountId)).get()
  if (!saver || saver.accountType !== 'SAVER' || !canSeeAccount(db, viewerId, saver, 'finances')) {
    throw new BudgetError(404, 'Goal not found')
  }
  const saved = db.select().from(s.goals).where(eq(s.goals.accountId, accountId)).get()
  const goal = toGoalDto(db, saver, saved, accountId, viewerId, today, tz, planLookup(db))
  const followed = followedDebt(db, saved, viewerId, today, tz)

  const history = saverHistory(db, saver, range, today, tz)
  const targets = followed
    ? debtSeries(followed.days, history.map((p) => p.date), followed.leftCents)
    : history.map(() => goal.goal?.targetCents ?? null)

  return {
    goal,
    range,
    points: history.map((p, i) => ({ ...p, targetCents: targets[i]! })),
    expected: expectedPath(goal, saved, tz),
    projected: projectedPath(goal),
    debt:
      goal.debt && followed
        ? {
            id: goal.debt.id,
            name: goal.debt.name,
            leftCents: goal.debt.leftCents,
            startTargetCents: goal.debt.startTargetCents,
            fallCents: goal.debtFallCents ?? 0,
            nextDue: debtNextDue(db, followed.debt, today, tz),
          }
        : null,
    months: monthTotals(db, accountId, range, today, tz),
    transactionsHidden: !canSeeAccount(db, viewerId, saver, 'transactions'),
  }
}
