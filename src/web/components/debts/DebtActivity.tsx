import { Pencil, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DebtActivityDto, DebtEntryInputDto, InterestCharge } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { PlainLink, type LinkLike } from '../AppLink'
import { money, parseDollars } from '../budgets/format'
import { Button } from '../ui/Button'
import { AddEntryForm } from './AddEntryForm'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Input } from '../ui/Input'
import { todayIso } from './DebtForm'
import { longDate } from './DebtSections'
import { activityLabel } from './format'

const PAGE = 50

/** Amounts that raise the debt carry a "+"; the rest use the usual minus. */
const signed = (cents: number) => (cents > 0 ? `+${money(cents)}` : money(cents))

function Tag({ children }: { children: string }) {
  return <span className="type-caption rounded-xs bg-elevated px-1.5 text-fg-3">{children}</span>
}

/** The interest amount as a button; while `text` is set it is an input with Save and Cancel instead. */
function InterestAmount({
  row,
  label,
  canEdit,
  text,
  onStart,
  onChange,
  onSave,
  onCancel,
}: {
  row: Extract<DebtActivityDto, { kind: 'interest' }>
  label: string
  canEdit: boolean
  /** The input's value, or null when not editing. */
  text: string | null
  onStart: () => void
  onChange: (text: string) => void
  onSave: (cents: number) => void
  onCancel: () => void
}) {
  const cents = text === null ? null : parseDollars(text)
  // The label is "Interest 1 Sep – 30 Sep" (or "Interest Sep 2026"); the aria-labels already say "interest".
  const period = label.replace(/^Interest /, '')
  // A charge that hasn't happened yet (the current part-month of daily charging) can't be edited.
  if (!canEdit || row.chargeDate > todayIso()) return <span>{signed(row.amountCents)}</span>
  if (text === null) {
    return (
      <button
        type="button"
        data-focus={row.key}
        aria-label={`Edit interest for ${period}`}
        className="num rounded-xs underline decoration-dotted underline-offset-4 hover:text-accent"
        onClick={onStart}
      >
        {signed(row.amountCents)}
      </button>
    )
  }
  return (
    <form
      className="flex items-center gap-1 max-sm:flex-wrap max-sm:justify-start sm:flex-nowrap sm:justify-end"
      onSubmit={(e) => {
        e.preventDefault()
        if (cents !== null) onSave(cents)
      }}
    >
      <Input
        autoFocus
        inputMode="decimal"
        aria-label={`Interest for ${period}`}
        aria-invalid={cents === null ? true : undefined}
        className="w-28!"
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={cents === null}>
        Save
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}

/** Date · Description · Amount · Balance, newest first, with the actions each kind of row allows. */
export function DebtActivity({
  rows,
  charge,
  canEdit,
  canRemoveCheck,
  canRemoveRate,
  onEditInterest,
  onSaveEntry,
  onDeleteEntry,
  onRemoveCheck,
  onRemoveRate,
  onNotRepayment,
  LinkComponent = PlainLink,
}: {
  rows: DebtActivityDto[]
  charge: InterestCharge
  canEdit: boolean
  canRemoveCheck: boolean
  canRemoveRate: boolean
  /** `null` resets the charge to the calculated amount. */
  onEditInterest: (chargeDate: string, cents: number | null) => void
  /** Resolves when saved, so the inline form stays open if the save fails. */
  onSaveEntry: (entryId: string, body: DebtEntryInputDto) => void | Promise<unknown>
  onDeleteEntry: (entryId: string) => void
  onRemoveCheck: (balanceId: string) => void
  onRemoveRate: (rateId: string) => void
  onNotRepayment: (transactionId: string) => void
  LinkComponent?: LinkLike
}) {
  const [showAll, setShowAll] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  // The interest row being edited, with the input's text.
  const [interestEdit, setInterestEdit] = useState<{ key: string; text: string } | null>(null)
  // Closing an inline editor hands focus back to the row's Edit button.
  const table = useRef<HTMLDivElement>(null)
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    if (refocus.current === null) return
    const key = refocus.current
    refocus.current = null
    table.current?.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`)?.focus()
  })
  const closeInterest = (key: string) => {
    refocus.current = key
    setInterestEdit(null)
  }
  const closeEntry = (key: string) => {
    refocus.current = key
    setEditingId(null)
  }
  if (rows.length === 0) return <p className="text-fg-2">No activity yet.</p>

  // Newest first, so the opening rate is the oldest rate row.
  const firstRateKey = rows.findLast((r) => r.kind === 'rate')?.key
  const shown = showAll ? rows : rows.slice(0, PAGE)

  const actions = (row: DebtActivityDto, label: string) => {
    if (!canEdit) return null
    switch (row.kind) {
      case 'interest':
        return row.edited ? (
          <Button variant="ghost" size="sm" onClick={() => onEditInterest(row.chargeDate, null)}>
            Reset
          </Button>
        ) : null
      case 'repayment':
        return (
          <Button variant="ghost" size="sm" onClick={() => onNotRepayment(row.transactionId)}>
            Not a repayment
          </Button>
        )
      case 'added':
      case 'payment':
        return (
          <>
            <Button
              variant="ghost"
              icon
              data-focus={row.key}
              aria-label={`Edit ${label} from ${longDate(row.date)}`}
              onClick={() => setEditingId(row.entryId)}
            >
              <Pencil aria-hidden size={14} />
            </Button>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" icon aria-label={`Delete ${label} from ${longDate(row.date)}`}>
                  <X aria-hidden size={14} />
                </Button>
              }
              description={`Delete “${label}” from ${longDate(row.date)}? The balance recalculates without it.`}
              confirmLabel="Delete"
              onConfirm={() => onDeleteEntry(row.entryId)}
            />
          </>
        )
      case 'check':
        return canRemoveCheck ? (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" icon aria-label={`Remove balance check from ${longDate(row.date)}`}>
                <X aria-hidden size={14} />
              </Button>
            }
            description={`Remove the balance check from ${longDate(row.date)}? The timeline recalculates without it.`}
            confirmLabel="Remove"
            onConfirm={() => onRemoveCheck(row.balanceId)}
          />
        ) : null
      case 'rate':
        return canRemoveRate ? (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" icon aria-label={`Remove rate from ${longDate(row.date)}`}>
                <X aria-hidden size={14} />
              </Button>
            }
            description={`Remove the rate from ${longDate(row.date)}? Interest recalculates without it.`}
            confirmLabel="Remove"
            onConfirm={() => onRemoveRate(row.rateId)}
          />
        ) : null
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div ref={table}>
        <table className="block w-full border-collapse text-left sm:table">
          <thead className="max-sm:sr-only">
            <tr className="type-label text-fg-2">
              <th scope="col" className="py-2 pr-3 font-normal">
                Date
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                Description
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">
                Amount
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Balance
              </th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-line sm:table-row-group">
            {shown.map((row) => {
              const label = activityLabel(row, charge, row.key === firstRateKey)
              if ((row.kind === 'added' || row.kind === 'payment') && row.entryId === editingId) {
                return (
                  <tr key={row.key} className="block sm:table-row">
                    <td colSpan={4} className="block py-3 sm:table-cell">
                      <AddEntryForm
                        kind={row.kind}
                        initial={{ date: row.date, amountCents: Math.abs(row.amountCents), note: row.note }}
                        onCancel={() => closeEntry(row.key)}
                        onSave={(body) => {
                          if (body.kind === 'rate') return
                          Promise.resolve(onSaveEntry(row.entryId, body)).then(
                            () => closeEntry(row.key),
                            () => {}, // The page has already shown the error; keep the form for another go.
                          )
                        }}
                      />
                    </td>
                  </tr>
                )
              }
              const editingInterest = row.kind === 'interest' && interestEdit?.key === row.key
              return (
                // Below sm each row is two lines: the description, then date, amount and balance.
                <tr key={row.key} className="grid grid-cols-[1fr_auto_auto] gap-x-4 py-2 sm:table-row sm:py-0">
                  <td className="num order-2 max-sm:col-start-1 max-sm:type-caption text-fg-2 sm:table-cell sm:py-2 sm:pr-3 sm:align-middle sm:whitespace-nowrap">
                    {longDate(row.date)}
                  </td>
                  <td className="order-1 col-span-3 sm:table-cell sm:py-2 sm:pr-3 sm:align-middle">
                    <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
                      {row.kind === 'repayment' ? (
                        <LinkComponent
                          to={`/transactions?q=${encodeURIComponent(row.description)}`}
                          className="text-fg hover:underline"
                        >
                          {label}
                        </LinkComponent>
                      ) : (
                        <span className="text-fg">{label}</span>
                      )}
                      {row.kind === 'repayment' && row.oneOff && <Tag>One-off</Tag>}
                      {row.kind === 'interest' && row.edited && <Tag>Edited</Tag>}
                      {row.kind === 'check' && row.correctionCents !== null && row.correctionCents !== 0 && (
                        <span className="type-caption num text-fg-3">
                          {`${signed(row.correctionCents)} vs calculated`}
                        </span>
                      )}
                      {actions(row, label)}
                    </div>
                  </td>
                  <td
                    className={cn(
                      'num order-3 text-right sm:table-cell sm:py-2 sm:pr-3 sm:align-middle',
                      row.amountCents > 0 ? 'text-fg' : 'text-fg-2',
                      // Below sm the editor gets a full-width line of its own, under the date and balance.
                      editingInterest && 'max-sm:order-5 max-sm:col-span-3 max-sm:pt-2 max-sm:text-left',
                    )}
                  >
                    {row.kind === 'interest' ? (
                      <InterestAmount
                        row={row}
                        label={label}
                        canEdit={canEdit}
                        text={editingInterest ? interestEdit.text : null}
                        onStart={() => setInterestEdit({ key: row.key, text: (row.amountCents / 100).toFixed(2) })}
                        onChange={(text) => setInterestEdit({ key: row.key, text })}
                        onSave={(cents) => {
                          onEditInterest(row.chargeDate, cents)
                          closeInterest(row.key)
                        }}
                        onCancel={() => closeInterest(row.key)}
                      />
                    ) : row.kind === 'rate' || row.kind === 'check' ? null : (
                      signed(row.amountCents)
                    )}
                  </td>
                  <td className="num order-4 text-right text-fg max-sm:col-start-3 sm:table-cell sm:py-2 sm:align-middle">
                    <span className="type-caption text-fg-3 sm:hidden">Balance </span>
                    {money(row.balanceAfterCents)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!showAll && rows.length > PAGE && (
        <Button variant="ghost" className="self-start" onClick={() => setShowAll(true)}>
          Show all
        </Button>
      )}
    </div>
  )
}
