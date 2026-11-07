import type { DebtRateDto } from '../../../shared/types'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { longDate } from './DebtSections'
import { rateText } from './format'

/** A debt's rates, newest first (future-dated ones too). Each can be removed unless it's the only one. */
export function RateHistory({
  rates,
  today,
  onRemove,
}: {
  rates: DebtRateDto[]
  today: string
  onRemove?: (rateId: string) => void
}) {
  if (rates.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <p className="type-label text-fg-2">Rate history</p>
      <ul className="flex flex-col divide-y divide-line">
        {rates.map((r) => {
          const label = `${rateText(r.rateBp)} from ${longDate(r.fromDate)}`
          return (
            <li key={r.id} className="type-body flex items-center justify-between gap-2 py-1.5">
              <span className="num min-w-0 text-fg">
                {label}
                {r.fromDate > today && <span className="type-caption ml-2 text-fg-3">Upcoming</span>}
              </span>
              {rates.length > 1 && onRemove && (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm" aria-label={`Remove ${label}`}>
                      Remove
                    </Button>
                  }
                  description={`Remove the rate from ${longDate(r.fromDate)}? Interest recalculates without it.`}
                  confirmLabel="Remove"
                  onConfirm={() => onRemove(r.id)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
