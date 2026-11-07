import { useState } from 'react'
import { parseDollars } from '../budgets/format'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Input'
import { longDate } from './DebtSections'
import { todayIso } from './DebtForm'

/** "Update balance": a new starting point; a date that already has one asks before replacing it. */
export function UpdateBalanceForm({
  existingDates,
  onSave,
}: {
  existingDates: string[]
  onSave: (body: { balanceCents: number; asOf: string }) => void
}) {
  const [balance, setBalance] = useState('')
  const [asOf, setAsOf] = useState(todayIso())
  const cents = parseDollars(balance)
  const valid = cents !== null && /^\d{4}-\d{2}-\d{2}$/.test(asOf) && asOf <= todayIso()
  const save = () => valid && onSave({ balanceCents: cents!, asOf })

  return (
    <form
      className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        if (!existingDates.includes(asOf)) save()
      }}
    >
      <Field label="Balance" error={balance !== '' && cents === null ? 'Enter an amount' : null}>
        {(p) => (
          <Input {...p} inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
        )}
      </Field>
      <Field label="As of" error={asOf > todayIso() ? "Balance date can't be in the future." : null}>
        {(p) => (
          <Input {...p} type="date" max={todayIso()} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        )}
      </Field>
      {existingDates.includes(asOf) ? (
        <ConfirmDialog
          trigger={
            <Button type="button" variant="primary" disabled={!valid}>
              Save balance
            </Button>
          }
          description={`Replace the balance for ${longDate(asOf)}?`}
          confirmLabel="Replace"
          onConfirm={save}
        />
      ) : (
        <Button type="submit" variant="primary" disabled={!valid}>
          Save balance
        </Button>
      )}
    </form>
  )
}
