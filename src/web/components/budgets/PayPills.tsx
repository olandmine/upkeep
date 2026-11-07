import { cn } from '../../lib/cn'

export interface PayPill {
  id: string | undefined
  label: string
}

/** "Your pay" and "{partner}'s pay"; locked while a pay is being edited so the one on screen can't change. */
export function PayPills({
  pills,
  person,
  disabled = false,
  onSelect,
}: {
  pills: PayPill[]
  person: string | undefined
  disabled?: boolean
  onSelect: (id: string | undefined) => void
}) {
  return (
    <div role="group" aria-label="Whose pay" className="flex flex-wrap gap-1">
      {pills.map((p) => (
        <button
          key={p.label}
          type="button"
          aria-pressed={p.id === person}
          disabled={disabled}
          onClick={() => onSelect(p.id)}
          className={cn(
            'type-label h-8 rounded-full border px-3 transition-colors disabled:pointer-events-none disabled:opacity-50',
            p.id === person ? 'border-accent/40 bg-accent-muted text-accent' : 'border-line-2 text-fg-2 hover:text-fg',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
