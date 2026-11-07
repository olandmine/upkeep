import { pairTransfers } from '../../shared/transfers'
import type { TransactionDto } from '../../shared/types'

/** The two sides of one transfer, shown as a single row. Only the display combines them. */
export interface CombinedTransfer {
  id: string
  from: TransactionDto
  to: TransactionDto
  createdAt: string
  amountCents: number
  isTransfer: true
}

export type TxRow = TransactionDto | CombinedTransfer

export const isCombined = (row: TxRow): row is CombinedTransfer => 'from' in row

/** The list with each pair of sides replaced by one row, placed where the first of them was. */
export function combineTransfers(items: TransactionDto[]): TxRow[] {
  const pairOf = new Map<string, [TransactionDto, TransactionDto]>()
  for (const pair of pairTransfers(items)) {
    pairOf.set(pair[0].id, pair)
    pairOf.set(pair[1].id, pair)
  }
  const placed = new Set<string>()
  const rows: TxRow[] = []
  for (const tx of items) {
    const pair = pairOf.get(tx.id)
    if (!pair) {
      rows.push(tx)
    } else if (!placed.has(pair[0].id)) {
      placed.add(pair[0].id)
      const [from, to] = pair
      rows.push({ id: `transfer:${from.id}`, from, to, createdAt: tx.createdAt, amountCents: to.amountCents, isTransfer: true })
    }
  }
  return rows
}
