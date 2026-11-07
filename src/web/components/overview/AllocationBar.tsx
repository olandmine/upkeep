import { formatMoney } from '../../../shared/money'
import { allocationSegments, type AllocationItem } from '../../lib/allocation'
import { Money } from '../Money'
import { Dot } from '../ui/Badge'

/** Signature component: 6px bar, 2px gaps, pill ends, legend with full values. */
export function AllocationBar({ items, label }: { items: AllocationItem[]; label: string }) {
  const segments = allocationSegments(items)
  if (!segments.length) return <p className="type-body text-fg-3">Nothing to show yet.</p>
  return (
    <figure className="flex flex-col gap-4">
      <div role="img" aria-label={label} className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
        {segments.map((s) => (
          <span
            key={s.key}
            title={`${s.label}: ${formatMoney(s.cents)} (${s.percent.toFixed(1)}%)`}
            className="h-full min-w-[2px]"
            style={{ width: `${s.percent}%`, background: `var(--${s.colorToken})` }}
          />
        ))}
      </div>
      <figcaption>
        <ul className="flex flex-wrap gap-x-6 gap-y-3">
          {segments.map((s) => (
            <li key={s.key} className="flex flex-col gap-0.5">
              <span className="type-caption flex items-center gap-1.5 text-fg-3">
                <Dot token={s.colorToken} />
                {s.label}
              </span>
              <Money cents={s.cents} className="type-body text-fg" />
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}
