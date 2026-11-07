import { addDays, addMonthsClamped, dayOfMonth, diffDays, type LocalDate } from '../dates'
import type { GoalStatus } from '../types'

/** How a goal's owner gets paid: fortnightly-style paydays, or calendar months without a pay schedule. */
export type Cadence = { kind: 'pay'; frequencyDays: number; lastPayDate: LocalDate } | { kind: 'month' }

export interface GoalPace {
  progress: number
  status: GoalStatus
  neededCents: number | null
  neededPer: 'pay' | 'month' | null
  behindCents: number | null
  projectedDate: LocalDate | null
}

/** Paydays after today, in order: lastPayDate + k × frequency. */
function* paydaysAfter(cadence: Extract<Cadence, { kind: 'pay' }>, today: LocalDate) {
  let d = cadence.lastPayDate
  for (;;) {
    d = addDays(d, cadence.frequencyDays)
    if (d > today) yield d
  }
}

/** Beyond this a projection means nothing ("At this rate: Mar 29026"), so it reads as not growing. */
const MAX_PROJECTION_DAYS = 100 * 365

const monthsUntil = (today: LocalDate, target: LocalDate) =>
  (Number(target.slice(0, 4)) - Number(today.slice(0, 4))) * 12 +
  (Number(target.slice(5, 7)) - Number(today.slice(5, 7)))

/** Progress, "needed per pay" and on-track/behind against the recent rate. */
export function goalStatus(i: {
  balanceCents: number
  targetCents: number
  targetDate: LocalDate | null
  today: LocalDate
  recentRateCents: number
  cadence: Cadence
}): GoalPace {
  const progress = i.targetCents <= 0 ? 1 : Math.min(Math.max(i.balanceCents, 0) / i.targetCents, 1)
  const none = { progress, neededCents: null, neededPer: null, behindCents: null, projectedDate: null }
  if (i.targetCents <= 0 || i.balanceCents >= i.targetCents) return { ...none, status: 'reached' }
  const remaining = i.targetCents - i.balanceCents
  const per = i.cadence.kind === 'pay' ? 'pay' : 'month'

  if (i.targetDate) {
    if (i.targetDate < i.today) return { ...none, status: 'date-passed' }
    let count = 0
    if (i.cadence.kind === 'pay') {
      for (const d of paydaysAfter(i.cadence, i.today)) {
        if (d > i.targetDate) break
        count++
      }
    } else {
      count = monthsUntil(i.today, i.targetDate)
    }
    const neededCents = Math.ceil(remaining / Math.max(count, 1))
    const behind = neededCents - i.recentRateCents
    return {
      ...none,
      status: behind > 0 ? 'behind' : 'on-track',
      neededCents,
      neededPer: per,
      behindCents: behind > 0 ? behind : null,
    }
  }

  if (i.recentRateCents <= 0) return { ...none, status: 'not-growing' }
  const periods = Math.ceil(remaining / i.recentRateCents)
  const days = periods * (i.cadence.kind === 'pay' ? i.cadence.frequencyDays : 365 / 12)
  if (days > MAX_PROJECTION_DAYS) return { ...none, status: 'not-growing' }
  let projectedDate: LocalDate
  if (i.cadence.kind === 'pay') {
    let n = 0
    projectedDate = i.today
    for (const d of paydaysAfter(i.cadence, i.today)) {
      projectedDate = d
      if (++n >= periods) break
    }
  } else {
    projectedDate = addMonthsClamped(i.today, periods, dayOfMonth(i.today))
  }
  return { ...none, status: 'projected', projectedDate }
}

export type PlanOutcome =
  | { kind: 'short'; shortCents: number }
  | { kind: 'enough'; date: LocalDate }
  | { kind: 'reach'; date: LocalDate }
  | { kind: 'none' }

/** What a rate of `amountCents + otherRateCents` per period does for the goal: goalStatus, read as an outcome. */
export function planOutcome(i: {
  balanceCents: number
  targetCents: number
  targetDate: LocalDate | null
  today: LocalDate
  amountCents: number
  otherRateCents: number
  cadence: Cadence
}): PlanOutcome {
  const p = goalStatus({
    balanceCents: i.balanceCents,
    targetCents: i.targetCents,
    targetDate: i.targetDate,
    today: i.today,
    recentRateCents: i.amountCents + i.otherRateCents,
    cadence: i.cadence,
  })
  if (p.status === 'behind' && p.behindCents !== null) return { kind: 'short', shortCents: p.behindCents }
  if (p.status === 'on-track' && i.targetDate) return { kind: 'enough', date: i.targetDate }
  if (p.status === 'projected' && p.projectedDate) return { kind: 'reach', date: p.projectedDate }
  return { kind: 'none' }
}

/** A buffer goal holds a level rather than reaching a target: topped up at or above it, otherwise below. */
export function bufferStatus(balanceCents: number, levelCents: number) {
  const progress = levelCents <= 0 ? 1 : Math.min(Math.max(balanceCents, 0) / levelCents, 1)
  const below = balanceCents < levelCents
  return {
    progress,
    status: below ? ('below' as const) : ('topped-up' as const),
    belowCents: below ? levelCents - balanceCents : null,
  }
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1)

/** Where a goal should be today if it rose in a straight line from its start to its target date, 0..1. */
export function expectedProgress(i: {
  startCents: number
  startTargetCents: number
  startDate: LocalDate
  targetDate: LocalDate
  today: LocalDate
}): number {
  const startPct = i.startTargetCents <= 0 ? 1 : clamp01(i.startCents / i.startTargetCents)
  const span = diffDays(i.targetDate, i.startDate)
  const t = span <= 0 ? 1 : clamp01(diffDays(i.today, i.startDate) / span)
  return clamp01(startPct + (1 - startPct) * t)
}
