import type { ReactNode } from 'react'
import { Money } from '../Money'
import { Button } from '../ui/Button'

interface Props {
  label: string
  color: string
  totalCents?: number
  /** What the total is for, shown after it: "per pay" or "a fortnight". */
  totalNote?: string
  /** Small text beside the label, such as the dates a shared section covers. */
  note?: string
  /** Edit mode: offers to add a bucket at the end, or shows the form that's doing it. */
  add?: { open: ReactNode; onAdd: () => void }
  /** Rows that close the section, after Add bucket, such as the Total. */
  footer?: ReactNode
  children: ReactNode
}

/** A titled group of bucket rows with its total in the header. */
export function BucketSection({ label, color, totalCents, totalNote, note, add, footer, children }: Props) {
  return (
    <section aria-label={label} className="overflow-hidden rounded-lg border border-line bg-raised">
      <header className="type-caption flex items-center justify-between gap-4 bg-sunken px-4 py-2.5 text-fg-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: `var(--${color})` }}
          />
          <h2>{label}</h2>
          {note && <span className="truncate">{note}</span>}
        </div>
        {totalCents !== undefined && (
          <span className="shrink-0">
            <Money cents={totalCents} />
            {totalNote && ` ${totalNote}`}
          </span>
        )}
      </header>
      <ul>
        {children}
        {add && (
          <li className="border-t border-line first:border-t-0">
            {add.open ?? (
              <div className="px-4 py-2">
                <Button variant="ghost" size="sm" onClick={add.onAdd}>
                  Add bucket
                </Button>
              </div>
            )}
          </li>
        )}
        {footer}
      </ul>
    </section>
  )
}
