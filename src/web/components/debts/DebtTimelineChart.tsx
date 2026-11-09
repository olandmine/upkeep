import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { formatCompact } from '../../../shared/money'
import type { DebtBalancePoint, DebtDetailDto, DebtRange } from '../../../shared/types'
import { money, shortDate } from '../budgets/format'
import { Button } from '../ui/Button'
import { RangeGroup } from '../ui/RangeGroup'
import { longDate } from './DebtSections'

const COLOR = '#4c8dff' // --cat-blue

export const DEBT_RANGES: { value: DebtRange; label: string }[] = [
  { value: 'week', label: '1W' },
  { value: 'month', label: '1M' },
  { value: 'year', label: '1Y' },
  { value: 'fy', label: 'FY' },
  { value: 'all', label: 'All' },
]

type Row = { date: string; balanceCents: number; entered: boolean }

function ChartTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const row = payload?.[0]?.payload as Row | undefined
  if (!active || !row) return null
  return (
    <div className="type-caption rounded-md border border-line-2 bg-elevated px-3 py-2 shadow-float">
      <p className="mb-1 text-fg">{longDate(row.date)}</p>
      <p className="num text-fg">{money(row.balanceCents)}</p>
      {row.entered && <p className="text-fg-3">Balance you entered</p>}
    </div>
  )
}

/** Balance since the first starting point, with entered balances marked. */
export function DebtTimelineChart({
  timeline,
  balances = [],
  label = 'Debt balance over time',
  range,
}: {
  timeline: DebtBalancePoint[]
  balances?: DebtDetailDto['balances']
  label?: string
  /** Shows range buttons when given. */
  range?: { value: DebtRange; onChange: (range: DebtRange) => void }
}) {
  const [table, setTable] = useState(false)
  const byDate = new Map<string, Row>(timeline.map((p) => [p.date, { ...p, entered: false }]))
  for (const b of balances) byDate.set(b.asOf, { date: b.asOf, balanceCents: b.balanceCents, entered: true })
  const data = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  // One point that isn't an entered balance has no line and no dot to draw.
  const lone = data.length === 1 && !data[0]!.entered ? data[0] : null

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <figcaption className="type-label text-fg-2">Balance over time</figcaption>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {range && <RangeGroup options={DEBT_RANGES} value={range.value} onChange={range.onChange} />}
          <Button variant="ghost" onClick={() => setTable((t) => !t)}>
            {table ? 'Show chart' : 'Show table'}
          </Button>
        </div>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="type-caption w-full">
            <thead>
              <tr className="text-left text-fg-3">
                <th className="py-1 font-medium">Date</th>
                <th className="py-1 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.date} className="border-t border-line">
                  <td className="py-1 text-fg-2">{`${longDate(r.date)}${r.entered ? ' (entered)' : ''}`}</td>
                  <td className="num py-1 text-right text-fg">{money(r.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : lone ? (
        <p className="type-body text-fg-3">
          {`${money(lone.balanceCents)} on ${longDate(lone.date)}. The line starts once there’s more than a day to show.`}
        </p>
      ) : (
        <div className="h-56" role="img" aria-label={label}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
                tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
              />
              <YAxis
                tickFormatter={(v: number) => formatCompact(v)}
                axisLine={false}
                tickLine={false}
                width={56}
                tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
              />
              <Tooltip content={ChartTooltip} cursor={{ stroke: 'var(--border-strong)' }} />
              <Line
                type="linear"
                dataKey="balanceCents"
                stroke={COLOR}
                strokeWidth={2}
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: 'var(--bg-raised)', strokeWidth: 2 }}
                dot={(props: { cx?: number; cy?: number; payload?: Row; index?: number }) =>
                  props.payload?.entered ? (
                    <circle
                      key={props.index}
                      cx={props.cx}
                      cy={props.cy}
                      r={4}
                      fill={COLOR}
                      stroke="var(--bg-raised)"
                      strokeWidth={2}
                    />
                  ) : (
                    <g key={props.index} />
                  )
                }
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
