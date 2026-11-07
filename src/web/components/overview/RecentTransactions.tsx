import type { CategoryDto, TransactionDto } from '../../../shared/types'
import { combineTransfers, isCombined } from '../../lib/combine-transfers'
import { CategoryChip, Payee, TransferAmount, TransferBadges, TransferPayee, TxAmount, TxBadges } from '../transactions/TransactionRow'

const shortDate = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' })

export function RecentTransactions({ items, categories }: { items: TransactionDto[]; categories: CategoryDto[] }) {
  if (!items.length) return <p className="type-body text-fg-3">No transactions yet.</p>
  const byId = new Map(categories.map((c) => [c.id, c]))
  return (
    <ul className="flex flex-col divide-y divide-line">
      {combineTransfers(items).map((row) => (
        <li key={row.id} className="flex items-center gap-3 py-2.5">
          <span className="type-caption num w-12 shrink-0 text-fg-3">{shortDate.format(new Date(row.createdAt))}</span>
          {isCombined(row) ? (
            <>
              <span className="min-w-0 flex-1">
                <TransferPayee row={row} />
              </span>
              <TransferBadges row={row} />
              <TransferAmount row={row} />
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1">
                <Payee tx={row} />
              </span>
              <span className="hidden sm:block">
                <CategoryChip category={row.categoryId ? byId.get(row.categoryId) : undefined} />
              </span>
              <TxBadges tx={row} />
              <TxAmount tx={row} />
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
