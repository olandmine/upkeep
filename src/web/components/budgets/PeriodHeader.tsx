import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { BudgetPeriodDto } from '../../../shared/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { addDays, shortDate } from './format'

/** "‹ 30 Oct – 12 Nov ›" with days left for the current period and a badge when the pay wasn't seen. */
export function PeriodHeader({
  period,
  onPrev,
  onNext,
  disabled = false,
}: {
  period: BudgetPeriodDto
  onPrev: () => void
  onNext: () => void
  /** True while a pay is being edited, so the pay on screen can't change under the draft. */
  disabled?: boolean
}) {
  const last = addDays(period.end ?? period.nominalEnd, -1)
  const daysLeft = period.daysTotal - period.daysElapsed
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <Button variant="ghost" icon aria-label="Previous period" onClick={onPrev} disabled={disabled || !period.prevDate}>
          <ChevronLeft aria-hidden size={16} />
        </Button>
        <span className="type-label num min-w-32 text-center text-fg">
          {`${shortDate(period.start)} – ${shortDate(last)}`}
        </span>
        <Button variant="ghost" icon aria-label="Next period" onClick={onNext} disabled={disabled || !period.nextDate}>
          <ChevronRight aria-hidden size={16} />
        </Button>
      </div>
      {period.isCurrent && (
        <span className="type-caption text-fg-3">{daysLeft === 1 ? '1 day left' : `${daysLeft} days left`}</span>
      )}
      {period.payNotSeen && <Badge tone="info">Pay not seen</Badge>}
      {period.beforeSetup && <span className="type-caption text-fg-3">Before budgets were set up</span>}
    </div>
  )
}
