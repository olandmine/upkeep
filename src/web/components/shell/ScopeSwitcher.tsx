import type { Scope } from '../../../shared/types'
import { cn } from '../../lib/cn'

const OPTIONS: { value: Scope; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'me', label: 'Me' },
  { value: 'partner', label: 'Partner' },
  { value: 'joint', label: 'Joint' },
]

export function ScopeSwitcher({ value, onChange }: { value: Scope; onChange: (scope: Scope) => void }) {
  return (
    <div role="group" aria-label="Whose money" className="flex flex-wrap gap-1">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'type-label h-7 rounded-full border px-3 transition-colors duration-150',
            o.value === value
              ? 'border-accent/40 bg-accent-muted text-accent'
              : 'border-line-2 text-fg-2 hover:bg-elevated hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
