import type { GoalDto } from '../../../shared/types'
import { money, shortDate } from '../budgets/format'
import { monthLabel } from '../debts/format'

export interface GoalSummary {
  count: number
  savedCents: number
  targetCents: number
  behind: number
  datePassed: number
  buffersLow: number
  onTrack: number
  next: { name: string; date: string } | null
}


/** The summary strip figures. `today` is YYYY-MM-DD. */
export function goalSummary(goals: GoalDto[], today: string): GoalSummary {
  const s: GoalSummary = {
    count: 0,
    savedCents: 0,
    targetCents: 0,
    behind: 0,
    datePassed: 0,
    buffersLow: 0,
    onTrack: 0,
    next: null,
  }
  for (const g of goals) {
    if (!g.goal || g.accountMissing) continue
    if (g.goal.kind !== 'buffer') {
      s.count += 1
      s.savedCents += Math.min(g.balanceCents, g.goal.targetCents)
      s.targetCents += g.goal.targetCents
    }
    if (g.status === 'behind') s.behind += 1
    else if (g.status === 'date-passed') s.datePassed += 1
    else if (g.status === 'below') s.buffersLow += 1
    else if (g.status === 'on-track') s.onTrack += 1
    const date = g.goal.targetDate
    if (date && date >= today && g.status !== 'reached' && g.status !== 'date-passed') {
      if (!s.next || date < s.next.date) s.next = { name: g.goal.name, date }
    }
  }
  return s
}

const ATTENTION = new Set(['behind', 'date-passed', 'below'])

const byName = (a: GoalDto, b: GoalDto) => (a.goal?.name ?? '').localeCompare(b.goal?.name ?? '')
/** Soonest date first, no date after dated, then name. */
const byDate = (a: GoalDto, b: GoalDto) => {
  const da = a.goal?.targetDate ?? null
  const db = b.goal?.targetDate ?? null
  if (da && db && da !== db) return da < db ? -1 : 1
  if (da && !db) return -1
  if (!da && db) return 1
  return byName(a, b)
}

/** The sections. */
export function goalSections(goals: GoalDto[]) {
  const attention: GoalDto[] = []
  const dated: GoalDto[] = []
  const undated: GoalDto[] = []
  const reached: GoalDto[] = []
  const withoutGoal: GoalDto[] = []
  for (const g of goals) {
    if (!g.goal) withoutGoal.push(g)
    else if (g.accountMissing) undated.push(g)
    else if (g.status === 'reached') reached.push(g)
    else if (g.status && ATTENTION.has(g.status)) attention.push(g)
    else if (g.status === 'on-track') dated.push(g)
    else undated.push(g)
  }
  attention.sort(byDate)
  dated.sort(byDate)
  undated.sort((a, b) => Number(a.accountMissing) - Number(b.accountMissing) || byName(a, b))
  // Newest first; the built-in goal has no date, so it and anything undated come last, by name.
  reached.sort((a, b) => {
    const ra = a.reachedOn
    const rb = b.reachedOn
    if (ra && rb && ra !== rb) return ra < rb ? 1 : -1
    if (ra && !rb) return -1
    if (!ra && rb) return 1
    return byName(a, b)
  })
  withoutGoal.sort((a, b) => (a.saverName ?? '').localeCompare(b.saverName ?? ''))
  return { attention, dated, undated, reached, withoutGoal }
}

/** The next step line; '' when there is none. */
export function nextStepText(g: GoalDto): string {
  if (!g.goal || g.accountMissing) return ''
  const isDebt = g.goal.kind === 'debt'
  const per = g.neededPer === 'month' ? 'a month' : 'a pay'
  const toGo = money(g.toGoCents ?? 0)
  const by = g.goal.targetDate ? shortDate(g.goal.targetDate) : ''
  switch (g.status) {
    case 'behind': {
      const lately = g.recentRateCents != null ? ` · lately about ${money(g.recentRateCents)}` : ''
      return `${money(g.neededCents ?? 0)} ${per} to ${isDebt ? 'cover' : 'reach'} it by ${by}${lately}`
    }
    case 'on-track':
      return `${money(g.neededCents ?? 0)} ${per} to ${isDebt ? 'cover' : 'reach'} it by ${by} · on track`
    case 'date-passed':
      return `The date passed with ${toGo} to go.`
    case 'projected':
      if (!g.projectedDate) return ''
      return isDebt
        ? `At this rate, enough to pay it off by ${monthLabel(g.projectedDate)}`
        : `At this rate, about ${monthLabel(g.projectedDate)}`
    case 'not-growing':
      return `Not growing lately. ${toGo} to go.`
    case 'below':
      return `${money(g.belowCents ?? 0)} below · top it up to ${money(g.goal.targetCents)}`
    case 'reached':
      return g.reachedOn ? `Reached ${shortDate(g.reachedOn)}` : 'Reached ✓'
    case 'topped-up':
      return 'Topped up'
    default:
      return ''
  }
}
