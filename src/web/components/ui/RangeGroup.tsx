import { cn } from '../../lib/cn'

/** A row of pill buttons picking how far back a chart reaches; the chosen one is pressed. */
export function RangeGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label="Range" className="flex gap-1">
      {options.map((r) => (
        <button
          key={r.value}
          type="button"
          aria-pressed={r.value === value}
          onClick={() => onChange(r.value)}
          className={cn(
            'type-label h-7 rounded-full border px-3 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            r.value === value
              ? 'border-accent/40 bg-accent-muted text-accent'
              : 'border-line-2 text-fg-2 hover:bg-elevated hover:text-fg',
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
