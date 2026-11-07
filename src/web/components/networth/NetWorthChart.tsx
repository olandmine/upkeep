import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { formatCompact } from '../../../shared/money'
import type { NetWorthDto, NetWorthPointDto } from '../../../shared/types'
import { money, shortDate } from '../budgets/format'
import { longDate } from '../debts/DebtSections'
import { Money } from '../Money'
import { Button } from '../ui/Button'

const COLOR = '#4c8dff' // --cat-blue

/** Today's net worth, the change across the range and the "History from" caption. */
export function NetWorthHeadline({ data }: { data: NetWorthDto }) {
  const first = data.points[0]
  return (
    <div className="flex flex-col gap-1">
      <span className="type-caption text-fg-3">Net worth</span>
      <Money cents={data.todayCents} className="type-kpi-xl" />
      {first && data.points.length > 1 && (
        <span className="type-caption flex flex-wrap gap-1 text-fg-3">
          <Money cents={data.changeCents} signed />
          <span>{`since ${longDate(first.date)}`}</span>
        </span>
      )}
      {data.historyFrom && (
        <span className="type-caption text-fg-3">{`History from ${longDate(data.historyFrom)}`}</span>
      )}
    </div>
  )
}

function ChartTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const p = payload?.[0]?.payload as NetWorthPointDto | undefined
  if (!active || !p) return null
  return (
    <div className="type-caption rounded-md border border-line-2 bg-elevated px-3 py-2 shadow-float">
      <p className="mb-1 text-fg">{longDate(p.date)}</p>
      <p className="flex justify-between gap-4 text-fg-2">
        Net worth <span className="num text-fg">{money(p.netCents)}</span>
      </p>
      <p className="flex justify-between gap-4 text-fg-2">
        Up balances <span className="num text-fg">{money(p.upCents)}</span>
      </p>
      <p className="flex justify-between gap-4 text-fg-2">
        Debts <span className="num text-fg">{money(p.debtCents)}</span>
      </p>
    </div>
  )
}

/** One series, so no legend: the title names it. Table view for screen readers and exact figures. */
export function NetWorthChart({ points }: { points: NetWorthPointDto[] }) {
  const [table, setTable] = useState(false)
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <figcaption className="type-label text-fg-2">Net worth over time</figcaption>
        <Button variant="ghost" className="ml-auto" onClick={() => setTable((t) => !t)}>
          {table ? 'Show chart' : 'Show table'}
        </Button>
      </div>
      {table ? (
        <div className="max-h-96 overflow-auto">
          <table className="type-caption w-full">
            <thead>
              <tr className="text-left text-fg-3">
                <th className="py-1 font-medium">Date</th>
                <th className="py-1 text-right font-medium">Up balances</th>
                <th className="py-1 text-right font-medium">Debts</th>
                <th className="py-1 text-right font-medium">Net worth</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date} className="border-t border-line">
                  <td className="py-1 text-fg-2">{longDate(p.date)}</td>
                  <td className="num py-1 text-right text-fg">{money(p.upCents)}</td>
                  <td className="num py-1 text-right text-fg">{money(p.debtCents)}</td>
                  <td className="num py-1 text-right text-fg">{money(p.netCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-72" role="img" aria-label="Net worth over time">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="net-worth-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
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
              <Area
                type="monotone"
                dataKey="netCents"
                stroke={COLOR}
                strokeWidth={2}
                fill="url(#net-worth-fill)"
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: 'var(--bg-raised)', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
