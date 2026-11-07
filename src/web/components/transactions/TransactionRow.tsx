import type { CategoryDto, TransactionDto } from '../../../shared/types'
import type { CombinedTransfer } from '../../lib/combine-transfers'
import { Money } from '../Money'
import { Badge, Dot } from '../ui/Badge'

export function TxBadges({ tx }: { tx: TransactionDto }) {
  return (
    <span className="flex flex-wrap gap-1">
      {tx.status === 'HELD' && <Badge tone="info">Pending</Badge>}
      {tx.isTransfer && <Badge tone="neutral">Transfer</Badge>}
    </span>
  )
}

export function CategoryChip({ category }: { category: CategoryDto | undefined }) {
  return (
    <span className="type-label inline-flex items-center gap-1.5 text-fg-2">
      <Dot token={category?.colorToken ?? 'cat-slate'} />
      {category?.name ?? 'Uncategorised'}
    </span>
  )
}

export function TxAmount({ tx }: { tx: TransactionDto }) {
  return <Money cents={tx.amountCents} signed={!tx.isTransfer} className={tx.isTransfer ? 'text-fg-3' : 'text-fg'} />
}

export function Payee({ tx }: { tx: TransactionDto }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-fg">{tx.description}</span>
      {tx.message && <span className="type-caption truncate text-fg-3">{tx.message}</span>}
    </span>
  )
}

/** A combined transfer's accounts, read as "Spending to Rainy Day", and a note from either side. */
export function TransferPayee({ row }: { row: CombinedTransfer }) {
  const message = row.from.message ?? row.to.message
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-fg">
        <span>{row.from.accountName}</span> <span aria-hidden>→</span>
        <span className="sr-only">to</span> <span>{row.to.accountName}</span>
      </span>
      {message && <span className="type-caption truncate text-fg-3">{message}</span>}
    </span>
  )
}

/** Transfer, plus Pending while either side is. */
export function TransferBadges({ row }: { row: CombinedTransfer }) {
  return <TxBadges tx={row.from.status === 'HELD' ? row.from : row.to} />
}

export function TransferAmount({ row }: { row: CombinedTransfer }) {
  return <Money cents={row.amountCents} className="text-fg-3" />
}
