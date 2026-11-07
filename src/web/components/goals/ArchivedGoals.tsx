import { ChevronRight } from 'lucide-react'
import type { ArchivedGoalDto } from '../../../shared/types'
import { money } from '../budgets/format'
import { monthLabel } from '../debts/format'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'

/** The goals that were reached and archived, collapsed until asked for; nothing when there are none. */
export function ArchivedGoals({
  archived,
  onDelete,
}: {
  archived: ArchivedGoalDto[]
  onDelete: (a: ArchivedGoalDto) => void
}) {
  if (archived.length === 0) return null
  return (
    <details className="group">
      <summary className="type-heading flex cursor-pointer list-none items-center gap-2 rounded-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <ChevronRight
          aria-hidden
          size={14}
          className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-90"
        />
        Reached goals
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        {archived.map((a) => (
          <li key={a.id}>
            <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <span className="type-body min-w-0 flex-1 text-fg">{a.name}</span>
              <span className="type-caption text-fg-3">{a.saverName}</span>
              {/* A debt that was already paid off when linked started at $0, which says nothing. */}
              {a.targetCents > 0 && <span className="num type-body text-fg-2">{money(a.targetCents)}</span>}
              <span className="type-caption text-fg-3">{`Reached ${monthLabel(a.reachedOn)}`}</span>
              {a.debtName && (
                <span className="type-caption text-fg-3">{`${a.debtPaidOff ? 'Paid off' : 'Covered'} ${a.debtName}`}</span>
              )}
              {a.canEdit && (
                <ConfirmDialog
                  trigger={<Button variant="ghost" aria-label={`Delete ${a.name}`}>Delete</Button>}
                  description={`Delete ${a.name} from Reached goals?`}
                  confirmLabel="Delete"
                  onConfirm={() => onDelete(a)}
                />
              )}
            </Card>
          </li>
        ))}
      </ul>
    </details>
  )
}
