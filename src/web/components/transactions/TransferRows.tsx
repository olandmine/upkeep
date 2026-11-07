import { ChevronRight } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { TransactionDto } from '../../../shared/types'
import type { CombinedTransfer } from '../../lib/combine-transfers'
import { cn } from '../../lib/cn'
import { Money } from '../Money'
import { Payee, TransferAmount, TransferBadges, TransferPayee } from './TransactionRow'

interface Props {
  row: CombinedTransfer
  expanded: boolean
  onToggle: () => void
  /** Opens a side's details. */
  onSelect: (id: string) => void
}

const Chevron = ({ expanded }: { expanded: boolean }) => (
  <ChevronRight aria-hidden size={14} className={cn('shrink-0 text-fg-3 transition-transform duration-150', expanded && 'rotate-90')} />
)

const sides = (row: CombinedTransfer) => [row.from, row.to]

/** One table row for a transfer, opening onto a row for each side. */
export function TransferTableRows({
  row,
  expanded,
  onToggle,
  onSelect,
  date,
  spentBy,
}: Props & { date: string; spentBy: (tx: TransactionDto) => string | null }) {
  // The row's own click toggles too, so the button's mustn't reach it and toggle back.
  const toggleOnce = (e: MouseEvent) => {
    e.stopPropagation()
    onToggle()
  }
  return (
    <>
      <tr onClick={onToggle} className="h-12 cursor-pointer border-t border-line transition-colors duration-150 hover:bg-elevated">
        <td className="num px-4 text-fg-3">{date}</td>
        <td className="px-4">
          <button type="button" aria-expanded={expanded} className="flex w-full min-w-0 items-center gap-1.5 text-left" onClick={toggleOnce}>
            <Chevron expanded={expanded} />
            <TransferPayee row={row} />
          </button>
        </td>
        <td className="px-4" />
        <td className="hidden px-4 lg:table-cell" />
        <td className="hidden truncate px-4 xl:table-cell">{spentBy(row.from) ?? '—'}</td>
        <td className="px-4">
          <TransferBadges row={row} />
        </td>
        <td className="px-4 text-right">
          <TransferAmount row={row} />
        </td>
      </tr>
      {expanded &&
        sides(row).map((tx) => (
          <tr
            key={tx.id}
            onClick={() => onSelect(tx.id)}
            className="h-12 cursor-pointer border-t border-line bg-sunken/40 transition-colors duration-150 hover:bg-elevated"
          >
            <td className="px-4" />
            <td className="px-4 pl-9">
              <button type="button" className="w-full min-w-0 text-left" onClick={() => onSelect(tx.id)}>
                <Payee tx={tx} />
              </button>
            </td>
            <td className="px-4" />
            <td className="hidden truncate px-4 lg:table-cell">{tx.accountName}</td>
            <td className="hidden px-4 xl:table-cell" />
            <td className="px-4" />
            <td className="px-4 text-right">
              <Money cents={tx.amountCents} signed />
            </td>
          </tr>
        ))}
    </>
  )
}

/** The same on a phone: one item, opening onto a button for each side. */
export function TransferListItem({ row, expanded, onToggle, onSelect }: Props) {
  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-elevated"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <Chevron expanded={expanded} />
            <TransferPayee row={row} />
          </span>
          <TransferBadges row={row} />
        </span>
        <TransferAmount row={row} />
      </button>
      {expanded && (
        <ul className="divide-y divide-line border-t border-line bg-sunken/40">
          {sides(row).map((tx) => (
            <li key={tx.id}>
              <button
                type="button"
                onClick={() => onSelect(tx.id)}
                className="flex min-h-14 w-full items-center gap-3 py-2.5 pr-4 pl-9 text-left hover:bg-elevated"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <Payee tx={tx} />
                  <span className="type-caption truncate text-fg-3">{tx.accountName}</span>
                </span>
                <Money cents={tx.amountCents} signed />
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
