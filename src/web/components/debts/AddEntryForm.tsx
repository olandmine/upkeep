import { ChevronDown } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useState } from 'react'
import type { DebtEntryInputDto } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { parseDollars } from '../budgets/format'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { todayIso } from './DebtForm'
import { parseRate } from './format'

export type EntryFormKind = 'added' | 'payment' | 'rate'

export const ENTRY_FORM_TITLE: Record<EntryFormKind, string> = {
  added: 'Added to debt',
  payment: 'Payment outside Up',
  rate: 'Rate change',
}

export type EntryFormBody = DebtEntryInputDto | { kind: 'rate'; fromDate: string; rateBp: number }

/** The header's "Add…" menu: which kind of entry to add. */
export function AddEntryMenu({
  onPick,
  allowRate = true,
}: {
  onPick: (kind: EntryFormKind) => void
  /** False for a debt that charges no interest (BNPL). */
  allowRate?: boolean
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button>
          Add…
          <ChevronDown aria-hidden size={14} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="type-body z-50 min-w-48 rounded-md border border-line-2 bg-raised p-1 shadow-float"
        >
          {(Object.keys(ENTRY_FORM_TITLE) as EntryFormKind[]).filter((kind) => allowRate || kind !== 'rate').map((kind) => (
            <DropdownMenu.Item
              key={kind}
              className="cursor-pointer rounded-sm px-3 py-2 text-fg outline-none data-[highlighted]:bg-elevated"
              onSelect={() => onPick(kind)}
            >
              {ENTRY_FORM_TITLE[kind]}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** A small form for "Added to debt", "Payment outside Up" or a rate change; `initial` edits an entry. */
export function AddEntryForm({
  kind,
  initial,
  onSave,
  onCancel,
}: {
  kind: EntryFormKind
  initial?: { date: string; amountCents: number; note: string | null }
  onSave: (body: EntryFormBody) => void
  onCancel: () => void
}) {
  const isRate = kind === 'rate'
  const [date, setDate] = useState(initial?.date ?? todayIso())
  const [amount, setAmount] = useState(initial ? (initial.amountCents / 100).toFixed(2) : '')
  const [note, setNote] = useState(initial?.note ?? '')

  const cents = isRate ? null : parseDollars(amount)
  const rateBp = isRate ? parseRate(amount) : null
  const amountOk = isRate ? rateBp !== null : cents !== null && cents > 0
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && (isRate || date <= todayIso())
  const valid = amountOk && dateOk

  return (
    <form
      className={cn(
        'grid gap-4 sm:grid-cols-2 lg:items-end',
        isRate ? 'lg:grid-cols-[1fr_1fr_auto]' : 'lg:grid-cols-[1fr_1fr_2fr_auto]',
      )}
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        if (isRate) onSave({ kind: 'rate', fromDate: date, rateBp: rateBp! })
        else onSave({ kind, date, amountCents: cents!, note: note.trim() === '' ? null : note.trim() })
      }}
    >
      <Field label="Date" error={!isRate && date > todayIso() ? "Entry date can't be in the future." : null}>
        {(p) => (
          <Input
            {...p}
            type="date"
            max={isRate ? undefined : todayIso()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        )}
      </Field>
      <Field
        label={isRate ? 'Rate' : 'Amount'}
        error={amount !== '' && !amountOk ? (isRate ? 'Enter a rate from 0% to 100%' : 'Enter an amount more than $0') : null}
        hint={isRate ? 'Yearly, from this date' : undefined}
      >
        {(p) => (
          <Input {...p} autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        )}
      </Field>
      {!isRate && (
        <Field label="Note">
          {(p) => <Input {...p} maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      )}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <Button type="submit" variant="primary" disabled={!valid}>
          Save
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
