import { useId } from 'react'
import { SHARING_LEVELS, type SharingLevel } from '../../../shared/sharing'
import { cn } from '../../lib/cn'

const COPY: Record<SharingLevel, { label: string; line: string }> = {
  full: { label: 'Full transparency', line: 'Everything, including individual transactions.' },
  'hide-transactions': {
    label: 'Hide transactions',
    line: 'Balances, budgets, goals, debts and category totals, but no individual transactions.',
  },
  balances: { label: 'Balances only', line: 'Account balances and net worth, but no spending, budgets, goals or debts.' },
  none: { label: 'No sharing', line: 'Nothing from your personal accounts.' },
}

const CANT_HIDE = [
  'A transfer into a joint account can name your personal account and shows its amount.',
  'A joint budget running on your pay cycle reveals your pay dates.',
  'At Balances only, a balance moving over time gives a rough idea of your spending.',
  'Subtracting their own share from a Household figure reveals yours.',
  "A repayment rule on a joint debt shows its description, and your repayments under it change the debt's balance.",
  'Whoever runs this Upkeep server can still read the database directly.',
]

/** The four sharing levels as one radio group; `value` is null until a person has chosen. */
export function SharingLevelOptions({
  value,
  onChange,
  disabled,
}: {
  value: SharingLevel | null
  onChange: (level: SharingLevel) => void
  disabled?: boolean
}) {
  const name = useId()
  return (
    <fieldset role="radiogroup" disabled={disabled} className="flex flex-col gap-2">
      <legend className="sr-only">What can your partner see?</legend>
      {SHARING_LEVELS.map((level) => (
        <label
          key={level}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-sm border px-3 py-3',
            value === level ? 'border-accent/50 bg-accent-muted' : 'border-line-2',
            disabled && 'cursor-default opacity-60',
          )}
        >
          <input
            type="radio"
            name={name}
            className="mt-1 accent-[var(--accent)]"
            checked={value === level}
            onChange={() => onChange(level)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="type-label text-fg">{COPY[level].label}</span>
            <span className="type-caption text-fg-3">{COPY[level].line}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/** What a level can't promise, so the choice is made knowing it. */
export function SharingCaveats() {
  return (
    <details className="type-caption text-fg-2">
      <summary className="cursor-pointer text-fg-2 hover:text-fg">What this can&apos;t hide</summary>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
        {CANT_HIDE.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  )
}
