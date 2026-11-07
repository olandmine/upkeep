import { useState } from 'react'
import type { GoalDebtOptionDto, GoalDto, GoalKind } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { money, parseDollars } from '../budgets/format'
import { todayIso } from '../debts/DebtForm'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Input'

export const GOAL_KINDS: { kind: GoalKind; label: string; hint: string }[] = [
  { kind: 'save', label: 'Save up to', hint: 'A target, with an optional date' },
  { kind: 'buffer', label: 'Keep topped up', hint: 'A level to stay at' },
  { kind: 'debt', label: 'Pay off a debt', hint: 'The target follows a debt' },
]

/**
 * Set or edit a Saver's goal: what it is for, then the name (default: the Saver's name) and the
 * fields that kind needs. `debts` is what a debt goal can follow (undefined while loading); the page
 * fetches it when `onKindChange` reports the debt kind.
 */
export function GoalForm({
  goal,
  followedDebtId,
  saverName,
  debts,
  onKindChange,
  onSave,
  onRemove,
  onCancel,
}: {
  goal?: GoalDto['goal']
  followedDebtId?: string
  saverName: string
  debts: GoalDebtOptionDto[] | undefined
  onKindChange?: (kind: GoalKind) => void
  onSave: (body: {
    kind: GoalKind
    name: string
    targetCents?: number
    targetDate: string | null
    debtId?: string
  }) => void
  onRemove?: () => void
  onCancel: () => void
}) {
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? 'save')
  const [name, setName] = useState(goal?.name ?? saverName)
  const [nameTouched, setNameTouched] = useState(!!goal)
  const [target, setTarget] = useState(goal ? (goal.targetCents / 100).toFixed(2) : '')
  const [date, setDate] = useState(goal?.targetDate ?? '')
  const [debtId, setDebtId] = useState(goal?.kind === 'debt' ? (followedDebtId ?? '') : '')
  const targetCents = parseDollars(target)
  // An existing goal may keep a date that has since passed. The date field is hidden for Keep topped up, so it doesn't count there.
  const datePast = kind !== 'buffer' && date !== '' && date < todayIso() && date !== goal?.targetDate
  const chosen = debts?.find((d) => d.id === debtId)
  const noDebts = kind === 'debt' && debts !== undefined && debts.length === 0
  const valid =
    name.trim() !== '' &&
    !datePast &&
    (kind === 'debt' ? debtId !== '' : targetCents !== null && targetCents > 0)

  const pickKind = (k: GoalKind) => {
    setKind(k)
    onKindChange?.(k)
  }
  const pickDebt = (id: string) => {
    setDebtId(id)
    const d = debts?.find((x) => x.id === id)
    if (d && (!nameTouched || name.trim() === '')) setName(d.name)
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        const base = { kind, name: name.trim() }
        if (kind === 'debt') onSave({ ...base, debtId, targetDate: date || null })
        else if (kind === 'buffer') onSave({ ...base, targetCents: targetCents!, targetDate: null })
        else onSave({ ...base, targetCents: targetCents!, targetDate: date || null })
      }}
    >
      <fieldset className="flex flex-col">
        <legend className="type-label mb-1.5 text-fg-2">What is this Saver for?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {GOAL_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              aria-pressed={kind === k.kind}
              onClick={() => pickKind(k.kind)}
              className={cn(
                'flex flex-col items-start gap-0.5 rounded-sm border px-3 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent',
                kind === k.kind
                  ? 'border-accent bg-accent-muted text-fg'
                  : 'border-line-2 bg-elevated text-fg-2 hover:border-line-3',
              )}
            >
              <span className="type-body font-medium">{k.label}</span>
              <span className="type-caption text-fg-3">{k.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name">
          {(p) => (
            <Input
              {...p}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameTouched(true)
              }}
            />
          )}
        </Field>
        {kind === 'debt' ? (
          <Field label="Debt">
            {(p) => (
              <select
                {...p}
                value={debtId}
                onChange={(e) => pickDebt(e.target.value)}
                className="type-body h-9 w-full rounded-sm border border-line-2 bg-elevated px-3 text-fg outline-none hover:border-line-3 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Choose a debt</option>
                {debts?.map((d) => (
                  <option key={d.id} value={d.id} disabled={d.followedBy !== null}>
                    {`${d.name} · ${money(d.leftCents)} left${d.followedBy ? ` (followed by ${d.followedBy})` : ''}`}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
          <Field
            label={kind === 'buffer' ? 'Level to keep' : 'Target'}
            error={
              target !== '' && (targetCents === null || targetCents <= 0)
                ? `${kind === 'buffer' ? 'Level' : 'Target'} must be more than $0.`
                : null
            }
          >
            {(p) => (
              <Input {...p} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            )}
          </Field>
        )}
        {kind !== 'buffer' && (
          <Field
            label={kind === 'debt' ? 'Have it covered by (optional)' : 'Target date (optional)'}
            error={datePast ? "Target date can't be in the past." : null}
          >
            {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        )}
      </div>
      {kind === 'buffer' && (
        <p className="type-caption text-fg-3">
          Shows "Topped up" at or above this level, and how much it's below when it dips. No date and no pace.
        </p>
      )}
      {kind === 'debt' && chosen && (
        <p className="type-caption text-fg-3">
          The target follows the debt: {money(chosen.leftCents)} today, falling as you repay it. Interest that
          builds up counts too. When the Saver covers what's left, the goal is reached.
        </p>
      )}
      {noDebts && (
        <p className="type-caption text-fg-3">
          No debts this Saver can follow. A personal Saver can follow its owner's debts or joint debts; a joint
          Saver only joint debts.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onRemove && (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="ghost" className="mr-auto">
                Remove goal
              </Button>
            }
            description="Remove this goal? The Saver and its money stay as they are."
            confirmLabel="Remove goal"
            onConfirm={onRemove}
          />
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!valid}>
          Save goal
        </Button>
      </div>
    </form>
  )
}
