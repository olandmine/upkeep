import { useState } from 'react'
import type { GoalDto } from '../../../shared/types'
import { Button } from '../ui/Button'

/**
 * The banner on a goal that has just been reached. Dismissing hides it at once; if recording that fails
 * it stays hidden for this view and comes back on the next load.
 */
export function Celebration({ goal: g, onDismiss }: { goal: GoalDto; onDismiss: () => void }) {
  const [hidden, setHidden] = useState(false)
  if (hidden || !g.goal) return null
  const who = g.ownerName ?? 'You'
  const debtName = g.debt?.name ?? g.goal.name
  const text =
    g.goal.kind !== 'debt'
      ? `${who} reached ${g.goal.name}!`
      : g.debt?.paidOff
        ? `${debtName} is paid off!`
        : `${who} can pay off ${debtName} now!`
  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-positive-muted px-3 py-2 text-positive"
    >
      <span className="type-label min-w-0 flex-1">{text}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setHidden(true)
          onDismiss()
        }}
      >
        Dismiss
      </Button>
    </div>
  )
}
