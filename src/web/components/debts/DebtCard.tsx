import type { DebtDto } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { PlainLink, type LinkLike } from '../AppLink'
import { money } from '../budgets/format'
import { Badge } from '../ui/Badge'
import { buildingUpCaption, KIND_LABEL, monthLabel } from './format'

/** "Paid off ✓", "Never · Short $X/month" or "Paid off by Mar 2028". */
export function PayoffLine({ debt }: { debt: DebtDto }) {
  if (debt.paidOffOn) return <span className="type-label text-positive">Paid off ✓</span>
  if (!debt.projection) return null
  if (!debt.projection.payoffDate) {
    return (
      <span className="type-label flex flex-wrap gap-x-2 text-warning">
        <span>Never</span>
        {debt.projection.shortfallCents !== null && (
          <span>{`Short ${money(debt.projection.shortfallCents)}/month`}</span>
        )}
      </span>
    )
  }
  return (
    <span className="type-label text-fg-2">{`Paid off by ${monthLabel(debt.projection.payoffDate)}`}</span>
  )
}

export function DebtCard({
  debt,
  showOwner,
  LinkComponent = PlainLink,
}: {
  debt: DebtDto
  showOwner?: boolean
  LinkComponent?: LinkLike
}) {
  const start = debt.firstBalance.balanceCents
  const paid = start > 0 ? Math.min(Math.max((start - debt.balanceCents) / start, 0), 1) : 1
  const percent = Math.round(paid * 100)
  const caption = buildingUpCaption(debt)
  return (
    <LinkComponent
      to={`/debts/${debt.id}`}
      className="block rounded-lg border border-line bg-raised p-4 transition-colors hover:bg-elevated"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-heading min-w-0 text-fg">{debt.name}</span>
        <Badge>{KIND_LABEL[debt.kind]}</Badge>
        {showOwner && <span className="type-caption text-fg-3">{debt.ownerName}</span>}
        <span className="type-kpi num ml-auto text-fg">{money(debt.balanceCents)}</span>
      </div>
      {caption && <p className="type-caption num mt-1 text-right text-fg-3">{caption}</p>}
      <div
        role="meter"
        aria-label={`${debt.name} paid off`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-3 h-1.5 rounded-full bg-elevated"
      >
        <div className={cn('h-full rounded-full bg-accent')} style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <PayoffLine debt={debt} />
        {debt.estimated && <span className="type-caption text-fg-3">Estimated</span>}
      </div>
    </LinkComponent>
  )
}
