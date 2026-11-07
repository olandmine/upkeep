import { planOutcome, type PlanOutcome } from '../../../shared/goals/pace'
import type { GoalDto } from '../../../shared/types'
import { money, shortDate } from '../budgets/format'
import { monthLabel } from '../debts/format'

export const SLIDER_STEP_CENTS = 1_000

export const perOf = (g: GoalDto) => (g.cadence?.kind === 'month' ? 'a month' : 'a pay')

/** What reaches a debt goal's Saver other than the plan: the debt's fall, less what already leaves the Saver. */
export function otherRate(g: GoalDto): number {
  if (g.goal?.kind !== 'debt') return 0
  return (g.debtFallCents ?? 0) - (g.saverOutCents ?? 0)
}

/** The plan amounts line; null when nothing visible is planned. */
export function planLine(g: GoalDto): string | null {
  const p = g.plan
  if (!p) return null
  const per = perOf(g)
  if (p.mineCents > 0 && (p.partnerCents ?? 0) > 0) {
    return `Plans put in ${money(p.amountCents)} ${per}: ${money(p.mineCents)} from you, ${money(p.partnerCents ?? 0)} from ${p.partnerName ?? 'your partner'}`
  }
  if (p.mineCents <= 0 && (p.partnerCents ?? 0) > 0) {
    return `${p.partnerName ?? 'Your partner'}'s plan puts in ${money(p.amountCents)} ${per}`
  }
  return `Your plan puts in ${money(p.amountCents)} ${per}`
}

function outcomeAt(g: GoalDto, amountCents: number): PlanOutcome | null {
  if (!g.goal || !g.cadence) return null
  return planOutcome({
    balanceCents: g.balanceCents,
    targetCents: g.goal.targetCents,
    targetDate: g.goal.targetDate,
    today: g.today,
    amountCents,
    otherRateCents: otherRate(g),
    cadence: g.cadence,
  })
}

/** The planned amount set against the goal; null when there is nothing to compare. */
export function planComparison(g: GoalDto): { text: string; warning: boolean } | null {
  if (!g.plan || !g.goal || !g.cadence) return null
  if (g.goal.kind === 'buffer' || g.status === 'reached' || g.status === 'date-passed') return null
  const o = outcomeAt(g, g.plan.amountCents)
  // Whose rate it is: the viewer's own plan, or only the partner's.
  const rate = g.plan.mineCents > 0 ? 'your planned rate' : 'the planned rate'
  if (o?.kind === 'none' && !g.goal.targetDate) return { text: `not growing at ${rate}`, warning: true }
  if (!o || o.kind === 'none') return null
  const isDebt = g.goal.kind === 'debt'
  if (o.kind === 'short') return { text: `short by ${money(o.shortCents)} ${perOf(g)}`, warning: true }
  if (o.kind === 'enough') {
    return { text: `enough to ${isDebt ? 'cover' : 'reach'} it by ${shortDate(o.date)}`, warning: false }
  }
  return {
    text: isDebt
      ? `At ${rate}, enough to pay it off by ${monthLabel(o.date)}`
      : `At ${rate}, about ${monthLabel(o.date)}`,
    warning: false,
  }
}

/** Whether Try an amount applies to this goal. */
export function canTryAmount(g: GoalDto): boolean {
  if (!g.goal || !g.cadence || !g.canEdit || g.accountMissing) return false
  if (g.goal.kind === 'buffer') return false
  return g.status !== 'reached' && g.status !== 'date-passed'
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step
const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step

/** The slider's start and top, in cents. */
export function sliderRange(g: GoalDto): { maxCents: number; startCents: number } {
  // The plan is the start exactly; only the recent-rate fallback rounds to a step.
  const startCents = g.plan
    ? g.plan.amountCents
    : roundTo(Math.max(0, (g.recentRateCents ?? 0) - otherRate(g)), SLIDER_STEP_CENTS)
  const needed = g.neededCents ?? 0
  const maxCents = ceilTo(
    // The last term keeps "enough" reachable when more leaves the Saver than the debt falls.
    Math.max(2 * needed, 2 * (g.plan?.amountCents ?? 0), 10_000, startCents, needed - otherRate(g)),
    5_000,
  )
  return { maxCents, startCents }
}

/** The slider's result row for a tried amount. */
export function tryResult(g: GoalDto, amountCents: number): string {
  const o = outcomeAt(g, amountCents)
  const isDebt = g.goal?.kind === 'debt'
  if (!o || o.kind === 'none') return 'Not growing at this amount'
  if (o.kind === 'short') return `Short by ${money(o.shortCents)} ${perOf(g)}`
  if (o.kind === 'enough') return `Enough to ${isDebt ? 'cover' : 'reach'} it by ${shortDate(o.date)}`
  return isDebt ? `Enough to pay it off by ${monthLabel(o.date)}` : `Reach it about ${monthLabel(o.date)}`
}
