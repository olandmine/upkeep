import { cn } from '../../lib/cn'

export type PayViewValue = 'this' | 'standard'

const OPTIONS: { value: PayViewValue; label: string }[] = [
  { value: 'this', label: 'This pay' },
  { value: 'standard', label: 'Standard pay' },
]

/** "This pay" / "Standard pay"; plain text while a pay is being edited so the view on screen can't change under the draft. */
export function PayViewToggle({
  value,
  locked,
  onChange,
}: {
  value: PayViewValue
  locked: boolean
  onChange: (value: PayViewValue) => void
}) {
  return (
    <div role="group" aria-label="Which pay to show" className="flex flex-wrap gap-1">
      {locked ? (
        <span className="type-label flex h-8 items-center px-3 text-fg">{OPTIONS.find((o) => o.value === value)?.label}</span>
      ) : (
        OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn(
              'type-label h-8 rounded-full border px-3 transition-colors',
              o.value === value ? 'border-accent/40 bg-accent-muted text-accent' : 'border-line-2 text-fg-2 hover:text-fg',
            )}
          >
            {o.label}
          </button>
        ))
      )}
    </div>
  )
}
