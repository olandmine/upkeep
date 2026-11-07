import { useState } from 'react'
import type { GoalDto } from '../../../shared/types'
import { parseDollars } from '../budgets/format'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Input'

/**
 * What a reached goal offers the people who can edit it. A debt goal's target comes from the debt, so it
 * has no new target; the built-in goal would come straight back, so it isn't archived.
 */
export function ReachedActions({
  goal: g,
  onNewTarget,
  onArchive,
}: {
  goal: GoalDto
  /** Resolves once saved, and rejects when it fails (the caller has already said so). */
  onNewTarget: (targetCents: number) => Promise<unknown> | void
  onArchive: () => void
}) {
  const [setting, setSetting] = useState(false)
  const [target, setTarget] = useState('')
  const [saving, setSaving] = useState(false)
  if (!g.canEdit || g.status !== 'reached' || !g.goal || g.goal.kind === 'buffer') return null
  const cents = parseDollars(target)
  const valid = cents !== null && cents > g.balanceCents

  if (setting) {
    return (
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid || saving) return
          setSaving(true)
          Promise.resolve(onNewTarget(cents)).then(
            () => {
              setSaving(false)
              setSetting(false)
              setTarget('')
            },
            () => setSaving(false),
          )
        }}
      >
        <Field label="New target">
          {(p) => <Input {...p} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" disabled={!valid || saving}>
          Save
        </Button>
        <Button variant="ghost" onClick={() => setSetting(false)}>
          Cancel
        </Button>
      </form>
    )
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {g.goal.kind === 'save' && <Button onClick={() => setSetting(true)}>Set a new target</Button>}
      {!g.goal.isDefault && (
        <ConfirmDialog
          trigger={<Button variant="ghost">Archive</Button>}
          description={`Archive ${g.goal.name}? It moves to Reached goals and frees ${g.saverName ?? 'the Saver'} for a new goal. You can't undo this.`}
          confirmLabel="Archive"
          onConfirm={onArchive}
        />
      )}
    </div>
  )
}
