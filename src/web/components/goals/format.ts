import type { GoalDto, GoalStatus } from '../../../shared/types'
import { money } from '../budgets/format'
import { monthLabel } from '../debts/format'

export const GOAL_STATUS_TONES: Record<GoalStatus, string> = {
  reached: 'text-positive',
  'on-track': 'text-fg-2',
  behind: 'text-warning',
  'date-passed': 'text-warning',
  projected: 'text-fg-2',
  'not-growing': 'text-fg-3',
  'topped-up': 'text-positive',
  below: 'text-warning',
}

/** The status line as plain text; '' when the goal has no status. */
export function goalStatusText(g: GoalDto): string {
  const per = g.neededPer === 'month' ? 'per month' : 'per pay'
  switch (g.status) {
    case 'reached':
      return 'Reached ✓'
    case 'on-track':
      return `On track · ${money(g.neededCents ?? 0)} ${per}`
    case 'behind':
      return `Behind by ${money(g.behindCents ?? 0)} ${per}`
    case 'date-passed':
      return 'Target date passed'
    case 'projected':
      return `At this rate: ${monthLabel(g.projectedDate!)}`
    case 'not-growing':
      return 'Not growing'
    case 'topped-up':
      return 'Topped up'
    case 'below':
      return `${money(g.belowCents ?? 0)} below`
    default:
      return ''
  }
}
