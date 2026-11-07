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
import type { PayoffScenarioDto, PayoffStrategy } from '../../../shared/types'
import { money } from '../budgets/format'
import { Button } from '../ui/Button'
import { monthLabel } from './format'

/**
 * Fixed categorical order, validated for the dark surface with the dataviz palette script
 * (orange stepped down from --cat-orange to sit in the dark lightness band).
 */
export const SCENARIO_SERIES: { strategy: PayoffStrategy; label: string; color: string }[] = [
  { strategy: 'as-is', label: 'As is', color: '#4c8dff' },
  { strategy: 'avalanche', label: 'Avalanche', color: '#e0620c' },
  { strategy: 'snowball', label: 'Snowball', color: '#8b7cf6' },
]

type Row = { month: string } & Partial<Record<PayoffStrategy, number>>

function rows(scenarios: PayoffScenarioDto[]): Row[] {
  const byMonth = new Map<string, Row>()
  for (const s of scenarios) {
    for (const p of s.series) {
      const row = byMonth.get(p.month) ?? { month: p.month }
      row[s.strategy] = p.totalCents
      byMonth.set(p.month, row)
    }
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
}

function ChartTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null
  return (
    <div className="type-caption rounded-md border border-line-2 bg-elevated px-3 py-2 shadow-float">
      <p className="mb-1 text-fg">{monthLabel(String(label))}</p>
      {SCENARIO_SERIES.map((s) => {
        const value = payload.find((p) => p.dataKey === s.strategy)?.value
        if (value === undefined) return null
        return (
          <p key={s.strategy} className="flex items-center gap-2 text-fg-2">
            <span
              aria-hidden
              className="inline-block h-0.5 w-3 rounded-full"
              style={{ background: s.color }}
            />
            {s.label}
            <span className="num ml-auto pl-4 text-fg">{money(Number(value))}</span>
          </p>
        )
      })}
    </div>
  )
}

/** Total debt by month, one line per scenario, with a legend and a table view. */
export function PayoffChart({ scenarios }: { scenarios: PayoffScenarioDto[] }) {
  const [table, setTable] = useState(false)
  const data = rows(scenarios)
  if (data.length === 0) return null
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <figcaption className="type-label text-fg-2">Total debt by month</figcaption>
        <ul className="flex flex-wrap gap-x-3" aria-label="Legend">
          {SCENARIO_SERIES.map((s) => (
            <li key={s.strategy} className="type-caption flex items-center gap-1.5 text-fg-2">
              <span
                aria-hidden
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
            </li>
          ))}
        </ul>
        <Button variant="ghost" className="ml-auto" onClick={() => setTable((t) => !t)}>
          {table ? 'Show chart' : 'Show table'}
        </Button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="type-caption w-full">
            <thead>
              <tr className="text-left text-fg-3">
                <th className="py-1 font-medium">Month</th>
                {SCENARIO_SERIES.map((s) => (
                  <th key={s.strategy} className="py-1 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.month} className="border-t border-line">
                  <td className="py-1 text-fg-2">{monthLabel(r.month)}</td>
                  {SCENARIO_SERIES.map((s) => (
                    <td key={s.strategy} className="num py-1 text-right text-fg">
                      {r[s.strategy] === undefined ? '—' : money(r[s.strategy]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-60" role="img" aria-label="Total debt by month for As is, Avalanche and Snowball">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
              <XAxis
                dataKey="month"
                tickFormatter={monthLabel}
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
              {SCENARIO_SERIES.map((s) => (
                <Line
                  key={s.strategy}
                  type="monotone"
                  dataKey={s.strategy}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, stroke: 'var(--bg-raised)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
