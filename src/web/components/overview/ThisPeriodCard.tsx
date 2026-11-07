import type { LineStatusDto } from '../../../shared/types'
import { PlainLink, type LinkLike } from '../AppLink'
import { money } from '../budgets/format'
import { Dot } from '../ui/Badge'
import { Card, CardHeader } from '../ui/Card'
import { cn } from '../../lib/cn'

const SHOWN = 3

/** Overview: the Spending lines closest to (or past) their limit this period, across Mine and Joint. */
export function ThisPeriodCard({
  items,
  LinkComponent = PlainLink,
}: {
  items: { budgetName: string; line: LineStatusDto }[]
  LinkComponent?: LinkLike
}) {
  const top = items
    .filter((i) => i.line.kind === 'spending' && i.line.spentRatio !== null)
    .sort((a, b) => (b.line.spentRatio ?? 0) - (a.line.spentRatio ?? 0))
    .slice(0, SHOWN)
  if (top.length === 0) return null

  return (
    <Card>
      <CardHeader
        title="This period"
        action={
          <LinkComponent to="/budgets" className="type-label text-fg-2 hover:text-fg">
            View budgets ›
          </LinkComponent>
        }
      />
      <ul className="flex flex-col divide-y divide-line">
        {top.map(({ budgetName, line }) => (
          <li key={`${budgetName}-${line.lineId}`} className="flex items-center gap-3 py-2">
            <Dot token={line.colorToken} />
            <span className="min-w-0 flex-1">
              <span data-testid="period-line-name" className="block truncate text-fg">
                {line.name}
              </span>
              <span className="type-caption text-fg-3">{budgetName}</span>
            </span>
            <span
              className={cn(
                'num text-right',
                line.state === 'over' ? 'text-negative' : line.state === 'warning' ? 'text-warning' : 'text-fg',
              )}
            >
              {`${money(line.spentCents)} / ${money(line.amountCents)}`}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
