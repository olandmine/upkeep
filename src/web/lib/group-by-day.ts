import type { TransactionDto } from '../../shared/types'

type Dated = Pick<TransactionDto, 'createdAt' | 'amountCents' | 'isTransfer'>

export interface DayGroup<T extends Dated = TransactionDto> {
  date: string // YYYY-MM-DD in the local timezone
  label: string // 'Thu 29 Oct'
  netCents: number // transfers between our own accounts excluded
  items: T[]
}

export function groupByDay<T extends Dated>(items: T[], tz?: string): DayGroup<T>[] {
  const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  const labelFmt = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })
  const groups: DayGroup<T>[] = []
  for (const tx of items) {
    const when = new Date(tx.createdAt)
    const date = dateFmt.format(when)
    let group = groups.at(-1)
    if (!group || group.date !== date) {
      const label = labelFmt
        .formatToParts(when)
        .filter((p) => p.type !== 'literal')
        .map((p) => p.value)
        .join(' ')
      group = { date, label, netCents: 0, items: [] }
      groups.push(group)
    }
    group.items.push(tx)
    if (!tx.isTransfer) group.netCents += tx.amountCents
  }
  return groups
}
