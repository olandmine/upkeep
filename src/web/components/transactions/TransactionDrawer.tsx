import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { formatMoney } from '../../../shared/money'
import type { CategoryDto, TransactionDto, TransactionRepaymentDto } from '../../../shared/types'
import { errorMessage } from '../../lib/api'
import { Money } from '../Money'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { TagEditor } from './TagEditor'
import { TxBadges } from './TransactionRow'

const when = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
const NONE = ''

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
      <dt className="type-caption text-fg-3">{label}</dt>
      <dd className="type-body min-w-0 text-right break-words text-fg">{children}</dd>
    </div>
  )
}

/** Detail + edits. Category and tags update optimistically and roll back if Up refuses. */
export function TransactionDetail({
  tx,
  categories,
  allTags,
  spentBy,
  onCategory,
  onAddTag,
  onRemoveTag,
  budgetLine,
  pay,
  repayment,
}: {
  tx: TransactionDto
  categories: CategoryDto[]
  allTags: string[]
  spentBy: string | null
  onCategory: (categoryId: string | null) => Promise<void>
  onAddTag: (label: string) => Promise<void>
  onRemoveTag: (label: string) => Promise<void>
  /** The budget line this counts toward; null when it counts toward none (transfers, deposits). */
  budgetLine?: { budgetName: string; lineName: string | null } | null
  /** Present when this deposit could be the viewer's pay. */
  pay?: { hasSchedule: boolean; onMark: () => void }
  /** Present for outflows: the debt this already repays, and the debts the viewer can mark it against. */
  repayment?: {
    current: TransactionRepaymentDto
    debts: { id: string; name: string }[]
    /** `matchFuture`: count later transactions with this description too. */
    onMark: (debtId: string, matchFuture: boolean) => void
    onNotRepayment: (debtId: string) => void
  }
}) {
  const toast = useToast()
  const [category, setCategory] = useState(tx.categoryId)
  const [tags, setTags] = useState(tx.tags)
  const [picking, setPicking] = useState(false)
  const [matchFuture, setMatchFuture] = useState(true)
  const [shown, setShown] = useState(tx)
  if (shown !== tx) {
    // A different or refreshed transaction: reset the optimistic copies.
    setShown(tx)
    setCategory(tx.categoryId)
    setTags(tx.tags)
    setPicking(false)
  }

  async function optimistic<T>(set: (v: T) => void, before: T, after: T, write: () => Promise<void>) {
    set(after)
    try {
      await write()
    } catch (err) {
      set(before)
      toast(errorMessage(err), 'error')
    }
  }

  const parents = categories.filter((c) => c.parentId === null)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Money cents={tx.amountCents} signed={!tx.isTransfer} className="type-kpi" />
        <TxBadges tx={tx} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tx-category" className="type-label text-fg-2">
          Category
        </label>
        <select
          id="tx-category"
          aria-describedby={tx.isCategorizable ? undefined : 'tx-category-help'}
          disabled={!tx.isCategorizable}
          value={category ?? NONE}
          onChange={(e) => {
            const next = e.target.value || null
            void optimistic(setCategory, category, next, () => onCategory(next))
          }}
          className="type-body h-9 rounded-sm border border-line-2 bg-elevated px-2 text-fg disabled:opacity-60"
        >
          <option value={NONE}>Uncategorised</option>
          {parents.map((p) => (
            <optgroup key={p.id} label={p.name}>
              {categories
                .filter((c) => c.parentId === p.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {!tx.isCategorizable && (
          <p id="tx-category-help" className="type-caption text-fg-3">
            Up doesn&apos;t allow this transaction to be categorised.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="type-label text-fg-2">Tags</span>
        <TagEditor
          tags={tags}
          suggestions={allTags}
          onAdd={(label) => void optimistic(setTags, tags, [...tags, label], () => onAddTag(label))}
          onRemove={(label) => void optimistic(setTags, tags, tags.filter((t) => t !== label), () => onRemoveTag(label))}
        />
      </div>

      {pay &&
        (pay.hasSchedule ? (
          <ConfirmDialog
            trigger={<Button>This is my pay</Button>}
            description="Replace your pay schedule?"
            confirmLabel="Use as my pay"
            onConfirm={pay.onMark}
          />
        ) : (
          <Button onClick={pay.onMark} className="self-start">
            This is my pay
          </Button>
        ))}

      {repayment && !repayment.current && repayment.debts.length > 0 && (
        <div className="flex flex-col items-start gap-2">
          <Button onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
            This is a repayment…
          </Button>
          {picking && (
            <>
              <label className="type-label flex items-center gap-2 text-fg-2">
                <input
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={matchFuture}
                  onChange={(e) => setMatchFuture(e.target.checked)}
                />
                {`Also count future “${tx.description}” payments`}
              </label>
              <div role="group" aria-label="Repayment for" className="flex flex-wrap gap-2">
                {repayment.debts.map((d) => (
                  <Button
                    key={d.id}
                    variant="ghost"
                    onClick={() => {
                      setPicking(false)
                      repayment.onMark(d.id, matchFuture)
                    }}
                  >
                    {d.name}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <dl>
        <Row label="Account">{tx.accountName}</Row>
        {repayment?.current && (
          <Row label="Repayment">
            <span className="inline-flex flex-wrap items-center justify-end gap-2">
              {repayment.current.debtName}
              {repayment.current.canEdit && (
                <Button variant="ghost" onClick={() => repayment.onNotRepayment(repayment.current!.debtId)}>
                  Not a repayment
                </Button>
              )}
            </span>
          </Row>
        )}
        {budgetLine && (
          <Row label="Budget">{budgetLine.lineName ? `${budgetLine.budgetName} · ${budgetLine.lineName}` : 'Other spending'}</Row>
        )}
        <Row label="When">{when.format(new Date(tx.createdAt))}</Row>
        {tx.settledAt && <Row label="Settled">{when.format(new Date(tx.settledAt))}</Row>}
        {spentBy && <Row label="Spent by">{spentBy}</Row>}
        {tx.message && <Row label="Message">{tx.message}</Row>}
        {tx.rawText && (
          <Row label="Raw text">
            <span className="font-mono text-[12px]">{tx.rawText}</span>
          </Row>
        )}
        {tx.cardMethod && (
          <Row label="Card">
            {tx.cardMethod.replaceAll('_', ' ').toLowerCase()}
            {tx.cardSuffix && <span className="font-mono"> ··{tx.cardSuffix}</span>}
          </Row>
        )}
        {tx.foreignAmountCents !== null && (
          <Row label="Foreign amount">
            <span className="num">{formatMoney(tx.foreignAmountCents, { currency: tx.foreignCurrency ?? undefined })}</span>
          </Row>
        )}
        {tx.roundUpCents !== null && (
          <Row label="Round-up">
            <Money cents={tx.roundUpCents} />
          </Row>
        )}
        {tx.cashbackCents !== null && (
          <Row label="Cashback">
            <Money cents={tx.cashbackCents} />
          </Row>
        )}
      </dl>
    </div>
  )
}

export function TransactionDrawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-line bg-raised p-6 shadow-float"
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <Dialog.Title className="type-heading">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" icon aria-label="Close">
                <X aria-hidden size={16} />
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
