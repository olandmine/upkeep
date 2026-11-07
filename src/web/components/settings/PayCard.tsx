import { useState } from 'react'
import type { PayEventDto, PayScheduleDto, TransactionDto } from '../../../shared/types'
import { money, parseDollars, shortDate } from '../budgets/format'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Input'

const RECENT = 8

/** Settings › Pay: how pay is recognised, recent paydays, and undo for "Not my pay". */
export function PayCard({
  schedule,
  events,
  exclusions,
  onSave,
  onUndo,
  onNotMyPay,
  onDelete,
}: {
  schedule: PayScheduleDto | null
  events: PayEventDto[]
  exclusions: TransactionDto[]
  onSave: (patch: { descriptionMatch: string; minAmountCents: number }) => Promise<void>
  onUndo: (transactionId: string) => void
  onNotMyPay: (payDate: string) => void
  onDelete: () => void
}) {
  const [description, setDescription] = useState(schedule?.descriptionMatch ?? '')
  const [minimum, setMinimum] = useState(schedule ? (schedule.minAmountCents / 100).toFixed(2) : '')
  const minCents = parseDollars(minimum)

  if (!schedule) {
    return (
      <Card>
        <CardHeader title="Pay" />
        <p className="text-fg-2">Mark a pay deposit from Budgets or a transaction to set up pay periods.</p>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title="Pay" />
      {schedule.accountMissing && (
        <p className="type-caption mb-3 text-warning">Account not found</p>
      )}
      <form
        className="grid gap-4 sm:grid-cols-[1fr_160px_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          if (minCents !== null && description.trim()) void onSave({ descriptionMatch: description.trim(), minAmountCents: minCents })
        }}
      >
        <Field label="Pay description" hint={schedule.accountName ? `Deposits into ${schedule.accountName}` : undefined}>
          {(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <Field label="Minimum amount" error={minimum !== '' && minCents === null ? 'Enter an amount' : null}>
          {(p) => <Input {...p} inputMode="decimal" value={minimum} onChange={(e) => setMinimum(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" disabled={minCents === null || !description.trim()}>
          Save pay settings
        </Button>
      </form>

      <div className="mt-3">
        <ConfirmDialog
          trigger={<Button variant="ghost">Stop detecting pay</Button>}
          description="Budgets lose their pay periods until you mark a pay again. Lines and plans are kept."
          confirmLabel="Stop"
          onConfirm={onDelete}
        />
      </div>

      <h3 className="type-label mt-6 mb-2 text-fg-2">Recent paydays</h3>
      <ul className="flex flex-col divide-y divide-line">
        {events.slice(0, RECENT).map((e) => (
          <li key={e.payDate} className="flex items-center gap-3 py-2">
            <span className="w-20 text-fg">{shortDate(e.payDate)}</span>
            {e.payNotSeen ? (
              <Badge tone="info">Pay not seen</Badge>
            ) : (
              <span className="num flex-1 text-fg">
                {money((e.amountCents ?? 0) + e.extraCents)}
                {e.source === 'scheduled' && <span className="type-caption ml-2 text-fg-3">late</span>}
              </span>
            )}
            <span className="flex-1" />
            {e.source === 'detected' && (
              <Button variant="ghost" onClick={() => onNotMyPay(e.payDate)}>
                Not my pay
              </Button>
            )}
          </li>
        ))}
      </ul>

      {exclusions.length > 0 && (
        <>
          <h3 className="type-label mt-6 mb-2 text-fg-2">Marked “Not my pay”</h3>
          <ul className="flex flex-col divide-y divide-line">
            {exclusions.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-fg">{t.description}</span>
                <span className="num text-fg-2">{money(t.amountCents)}</span>
                <Button variant="ghost" onClick={() => onUndo(t.id)}>
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}
