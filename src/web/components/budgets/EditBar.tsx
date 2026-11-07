import { formatMoney } from '../../../shared/money'
import type { PayView } from '../../lib/pay-view'
import { Money } from '../Money'
import { Button } from '../ui/Button'

interface Props {
  view: PayView
  changeCount: number
  /** The draft adds, removes or renames something, which only makes sense for every pay. */
  structural: boolean
  pending: boolean
  canApply: boolean
  onDiscard: () => void
  onApplyOnce: () => void
  onApplyAll: () => void
  /** The live figure beside the changes; defaults to Left to spend. */
  headline?: { label: string; cents: number }
  /** Standard pay only ever changes every pay, so This pay only and its reason are left out. */
  everyPayOnly?: boolean
}

const REASON_ID = 'edit-bar-reason'

/** Sticks to the top while amounts are being tried: the live Left to spend, and the ways to finish. */
export function EditBar({ view, changeCount, structural, pending, canApply, onDiscard, onApplyOnce, onApplyAll, headline, everyPayOnly = false }: Props) {
  return (
    <div
      role="region"
      aria-label="Editing"
      className="sticky top-2 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line-3 bg-elevated px-4 py-3 shadow-float"
    >
      <div className="mr-auto">
        <div className="type-label text-fg">Trying changes</div>
        <div className="type-caption num text-fg-3">
          {changeCount === 0
            ? 'Nothing is saved until you apply'
            : `${changeCount} ${changeCount === 1 ? 'change' : 'changes'}, not saved yet`}
        </div>
      </div>
      <div>
        <div className="type-caption text-fg-3">{headline?.label ?? 'Left to spend'}</div>
        <Money cents={headline?.cents ?? view.leftToSpendCents} className="type-heading font-normal" />
      </div>
      {view.overPayCents > 0 && (
        <p className="type-label text-warning">
          <span aria-hidden>⚠ </span>
          {`Over your pay by ${formatMoney(view.overPayCents)}`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onDiscard} disabled={pending}>
          Discard
        </Button>
        {!everyPayOnly && (
          <Button onClick={onApplyOnce} disabled={!canApply || structural} aria-describedby={structural ? REASON_ID : undefined}>
            This pay only
          </Button>
        )}
        <Button variant="primary" onClick={onApplyAll} disabled={!canApply}>
          Apply to every pay
        </Button>
      </div>
      {structural && !everyPayOnly && (
        <p id={REASON_ID} className="type-caption w-full text-fg-3">
          Adding, removing or renaming applies to every pay
        </p>
      )}
    </div>
  )
}
