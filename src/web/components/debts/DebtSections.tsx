import { X } from 'lucide-react'
import type { DebtRepaymentDto, DebtRepaymentRuleDto } from '../../../shared/types'
import { PlainLink, type LinkLike } from '../AppLink'
import { money } from '../budgets/format'
import { Button } from '../ui/Button'

/** "1 Oct 2026". */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function ExclusionRow({
  r,
  action,
  LinkComponent,
}: {
  r: DebtRepaymentDto
  action: React.ReactNode
  LinkComponent: LinkLike
}) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="w-28 text-fg-2">{longDate(r.date)}</span>
      <LinkComponent
        to={`/transactions?q=${encodeURIComponent(r.description)}`}
        className="min-w-0 flex-1 truncate text-fg hover:underline"
      >
        {r.description}
      </LinkComponent>
      <span className="num text-fg">{money(r.amountCents)}</span>
      {action}
    </li>
  )
}

/** The repayment rules and the "Not a repayment" exclusions; the repayments themselves are in Activity. */
export function RepaymentsSection({
  rules,
  exclusions,
  hasRepayments,
  canEdit,
  onStopMatching,
  onUndo,
  LinkComponent = PlainLink,
}: {
  rules: DebtRepaymentRuleDto[]
  exclusions: DebtRepaymentDto[]
  /** Whether Activity lists any repayment (matched or one-off). */
  hasRepayments: boolean
  canEdit: boolean
  onStopMatching: (ruleId: string) => void
  onUndo: (transactionId: string) => void
  LinkComponent?: LinkLike
}) {
  return (
    <div className="flex flex-col gap-3">
      {rules.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="type-label text-fg-2">Matching</h3>
          <ul className="flex flex-wrap gap-2">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-1 rounded-sm border border-line-2 py-0.5 pl-2">
                <span className="text-fg">{`“${rule.match}”`}</span>
                {canEdit && (
                  <Button
                    variant="ghost"
                    icon
                    aria-label={`Stop matching “${rule.match}”`}
                    onClick={() => onStopMatching(rule.id)}
                  >
                    <X aria-hidden size={14} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rules.length === 0 && !hasRepayments && (
        <p className="text-fg-2">No repayments matched yet. Mark one from Transactions.</p>
      )}
      {exclusions.length > 0 && (
        <>
          <h3 className="type-label mt-2 text-fg-2">Marked “Not a repayment”</h3>
          <ul className="flex flex-col divide-y divide-line">
            {exclusions.map((r) => (
              <ExclusionRow
                key={r.transactionId}
                r={r}
                LinkComponent={LinkComponent}
                action={
                  canEdit && (
                    <Button variant="ghost" onClick={() => onUndo(r.transactionId)}>
                      Undo
                    </Button>
                  )
                }
              />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
