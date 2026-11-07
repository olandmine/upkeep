import type { OverviewDto } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { formatDelta } from '../../lib/delta'
import { Money } from '../Money'
import { Card } from '../ui/Card'

/** `upIsGood`: income/net rising is good, spending rising is not. Colour always comes with an arrow and text. */
function Delta({ current, previous, upIsGood }: { current: number; previous: number; upIsGood: boolean }) {
  const d = formatDelta(current, previous)
  if (!d) return null
  const good = d.direction === 'flat' ? null : (d.direction === 'up') === upIsGood
  return (
    <span className={cn('type-caption num', good === null ? 'text-fg-3' : good ? 'text-positive' : 'text-negative')}>{d.text}</span>
  )
}

function Stat({ label, children, delta }: { label: string; children: React.ReactNode; delta?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-0 py-4 first:pt-0 sm:px-6 sm:py-0 sm:first:pl-0">
      <span className="type-caption text-fg-3">{label}</span>
      {children}
      {delta}
    </div>
  )
}

/** `balancesOnly`: just the balance, for someone who shares no spending. */
export function KpiRow({ overview, balancesOnly = false }: { overview: OverviewDto; balancesOnly?: boolean }) {
  const { month, previousMonth } = overview
  const balance = (
    <Stat label="Total balance">
      <Money cents={overview.totalBalanceCents} hero className="type-kpi-xl" />
      {overview.homeLoanCents !== null && (
        <span className="type-caption flex gap-1 text-fg-3">
          Home loan <Money cents={overview.homeLoanCents} />
        </span>
      )}
    </Stat>
  )
  if (balancesOnly) return <Card>{balance}</Card>
  return (
    <Card className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x [&>*:nth-child(n+3)]:sm:mt-6 lg:[&>*:nth-child(n+3)]:mt-0">
      {balance}
      <Stat label="Spent this month" delta={<Delta current={month.spentCents} previous={previousMonth.spentCents} upIsGood={false} />}>
        <Money cents={month.spentCents} className="type-kpi" />
      </Stat>
      <Stat label="Income this month" delta={<Delta current={month.incomeCents} previous={previousMonth.incomeCents} upIsGood />}>
        <Money cents={month.incomeCents} className="type-kpi" />
      </Stat>
      <Stat label="Net this month" delta={<Delta current={month.netCents} previous={previousMonth.netCents} upIsGood />}>
        <Money cents={month.netCents} signed className="type-kpi" />
      </Stat>
    </Card>
  )
}
