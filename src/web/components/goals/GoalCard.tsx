import { Link } from '@tanstack/react-router'
import type { GoalDto } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { keepScope } from '../../lib/scope'
import { money } from '../budgets/format'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Celebration } from './Celebration'
import { GOAL_STATUS_TONES } from './format'
import { GoalPlan } from './GoalPlan'
import { ReachedActions } from './ReachedActions'
import { Sparkline } from './Sparkline'
import { nextStepText } from './summary'

export function GoalCard({
  goal: g,
  onEdit,
  onRemove,
  onSeen,
  onNewTarget,
  onArchive,
}: {
  goal: GoalDto
  onEdit: () => void
  onRemove: () => void
  onSeen: () => void
  onNewTarget: (targetCents: number) => Promise<unknown> | void
  onArchive: () => void
}) {
  if (g.accountMissing) {
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="type-heading text-fg">{g.goal?.name}</span>
          <Badge tone="warning">Saver not found</Badge>
          {g.canEdit && (
            <span className="ml-auto">
              <ConfirmDialog
                trigger={<Button variant="ghost">Delete</Button>}
                description={`Delete the ${g.goal?.name ?? ''} goal? Its Saver is no longer in Up.`}
                confirmLabel="Delete goal"
                onConfirm={onRemove}
              />
            </span>
          )}
        </div>
      </Card>
    )
  }

  if (!g.goal) {
    return (
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <span className="min-w-0 flex-1 truncate text-fg">{g.saverName}</span>
        <span className="num text-fg-2">{money(g.balanceCents)}</span>
        {g.canEdit && <Button aria-label={`Set goal for ${g.saverName}`} onClick={onEdit}>Set goal</Button>}
      </Card>
    )
  }

  const percent = Math.round(g.progress * 100)
  const status = nextStepText(g)
  const { kind } = g.goal
  const showToGo = kind !== 'buffer' && g.status !== 'reached' && g.toGoCents != null
  const deletedDebt = g.followedDebtName && kind === 'save'
  return (
    <Card className="p-4">
      {g.celebrate && <Celebration goal={g} onDismiss={onSeen} />}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          to="/goals/$accountId"
          params={{ accountId: g.accountId }}
          search={keepScope}
          className="type-heading min-w-0 rounded-sm text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {g.goal.name}
        </Link>
        <span className="type-caption text-fg-3">{g.saverName}</span>
        {g.goal.isDefault && <Badge>Default goal</Badge>}
        {kind === 'buffer' && <Badge>Keep topped up</Badge>}
        {kind === 'debt' && g.debt && (
          <Link
            to="/debts/$debtId"
            params={{ debtId: g.debt.id }}
            search={keepScope}
            className="type-caption rounded-sm text-accent underline underline-offset-2 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >{`Pays off ${g.debt.name}`}</Link>
        )}
        <span className="num ml-auto text-fg">{`${money(g.balanceCents)} / ${money(g.goal.targetCents)}`}</span>
      </div>
      <div className="relative mt-3">
        <div
          role="meter"
          aria-label={`${g.goal.name} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 rounded-full bg-elevated"
        >
          <div
            className={cn(
              'h-full rounded-full',
              g.status === 'reached' ? 'bg-positive' : 'bg-accent',
              g.celebrate && 'goal-fill',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        {g.expectedProgress != null && (
          <div
            role="img"
            aria-label={`Expected by now: ${Math.round(g.expectedProgress * 100)}%`}
            className="absolute -top-1 -bottom-1 w-0.5 bg-fg-2"
            style={{ left: `${Math.round(g.expectedProgress * 100)}%` }}
          />
        )}
      </div>
      {showToGo && <p className="num type-caption mt-1 text-fg-3">{`${money(g.toGoCents ?? 0)} to go`}</p>}
      {g.sparkline && (
        <div className="mt-2">
          <Sparkline
            balance={g.sparkline.balance}
            target={g.sparkline.target}
            label={`${g.goal.name} balance over the last 6 months`}
          />
        </div>
      )}
      {kind === 'debt' && g.debt && (
        <p className="type-caption mt-1 text-fg-3">
          {g.debt.paidOff
            ? `${g.debt.name} is paid off.`
            : `The target follows the debt: it was ${money(g.debt.startTargetCents)} when you set this.`}
        </p>
      )}
      {deletedDebt && (
        <p className="type-caption mt-1 text-fg-3">{`${g.followedDebtName} was deleted, so this goal keeps its last target of ${money(g.goal.targetCents)}.`}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3">
        {status && g.status && <span className={cn('type-label', GOAL_STATUS_TONES[g.status])}>{status}</span>}
      </div>
      <GoalPlan goal={g} />
      <ReachedActions goal={g} onNewTarget={onNewTarget} onArchive={onArchive} />
      <div className="mt-1 flex flex-wrap items-center gap-x-3">
        <Link
          to="/goals/$accountId"
          params={{ accountId: g.accountId }}
          search={keepScope}
          aria-label={`Details for ${g.goal.name}`}
          className="type-label ml-auto inline-flex h-9 items-center rounded-md px-3 text-fg-2 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Details
        </Link>
        {g.canEdit && (
          <Button variant="ghost" onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>
    </Card>
  )
}
