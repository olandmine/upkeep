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
import type { GoalDetailDto, GoalRange } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { money, shortDate } from '../budgets/format'
import { longDate } from '../debts/DebtSections'
import { monthLabel } from '../debts/format'
import { Button } from '../ui/Button'
import {
  chartDomain,
  chartRows,
  GOAL_RANGES,
  plotRows,
  singleValued,
  targetName,
  type GoalChartRow,
} from './goal-chart'

// Validated with the dataviz palette script against --bg-raised. The target stays the neutral it is on the sparkline,
// so it reads as the line being chased; the legend names it, and the dashes set the paths apart without colour.
const SAVED = '#4c8dff' // --cat-blue
const TARGET = 'var(--text-tertiary)'
const EXPECTED = '#e0620c' // --cat-orange, stepped down as in PayoffChart
const EXPECTED_DASH = '3 3'
const RATE_DASH = '6 4'

/** Past this the axis names months with their years, since the range no longer fits inside one year. */
const MONTHS_AXIS_MS = 300 * 24 * 60 * 60 * 1000

interface Series {
  label: string
  value: (r: GoalChartRow) => number | null
  color: string
  dash?: string
}

/** What the legend, table and tooltip list. A debt's path sits under its name, as where that same balance is heading. */
function seriesOf(d: GoalDetailDto, rows: GoalChartRow[]): Series[] {
  const series: Series[] = [{ label: 'Saved', value: (r) => r.saved, color: SAVED }]
  if (rows.some((r) => r.target !== null)) {
    series.push({ label: targetName(d), value: (r) => r.target ?? r.debtAtThisRate, color: TARGET })
  }
  if (d.expected)
    series.push({ label: 'Expected', value: (r) => r.expected, color: EXPECTED, dash: EXPECTED_DASH })
  if (d.projected)
    series.push({ label: 'At this rate', value: (r) => r.atThisRate, color: SAVED, dash: RATE_DASH })
  return series
}

function ChartTooltip({
  active,
  payload,
  series,
}: TooltipContentProps<ValueType, NameType> & { series: Series[] }) {
  const row = payload?.[0]?.payload as GoalChartRow | undefined
  if (!active || !row) return null
  return (
    <div className="type-caption rounded-md border border-line-2 bg-elevated px-3 py-2 shadow-float">
      <p className="mb-1 text-fg">{longDate(row.date)}</p>
      {series.map((s) => {
        const value = s.value(row)
        if (value === null) return null
        return (
          <p key={s.label} className="flex justify-between gap-4 text-fg-2">
            {s.label} <span className="num text-fg">{money(value)}</span>
          </p>
        )
      })}
    </div>
  )
}

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Legend">
      {series.map((s) => (
        <li key={s.label} className="type-caption flex items-center gap-1.5 text-fg-2">
          <svg aria-hidden width="16" height="4" className="shrink-0">
            <line x1="0" y1="2" x2="16" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  )
}

function RangeGroup({ range, onRange }: { range: GoalRange; onRange: (range: GoalRange) => void }) {
  return (
    <div role="group" aria-label="Range" className="flex gap-1">
      {GOAL_RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          aria-pressed={r.value === range}
          onClick={() => onRange(r.value)}
          className={cn(
            'type-label h-7 rounded-full border px-3 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            r.value === range
              ? 'border-accent/40 bg-accent-muted text-accent'
              : 'border-line-2 text-fg-2 hover:bg-elevated hover:text-fg',
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

/** The Saver's balance against its target, with the dashed paths ahead of it, and a table as the text alternative. */
export function GoalChart({
  detail,
  range,
  onRange,
}: {
  detail: GoalDetailDto
  range: GoalRange
  onRange: (range: GoalRange) => void
}) {
  const [table, setTable] = useState(false)
  const rows = chartRows(detail)
  const series = seriesOf(detail, rows)
  const name = detail.goal.goal?.name ?? detail.goal.saverName ?? 'Saver'
  const label = targetName(detail)
  const domain = chartDomain(detail)
  const spansYears = domain[1] - domain[0] > MONTHS_AXIS_MS
  const tick = (t: number) => {
    const date = new Date(t).toISOString().slice(0, 10)
    return spansYears ? monthLabel(date) : shortDate(date)
  }
  // A line with a single value draws nothing without a dot: a new Saver, or a debt's target that began only now.
  const single = singleValued(rows)
  const dotFor = (key: 'saved' | 'target') => (single.includes(key) ? { r: 3 } : false)
  const shared = {
    type: 'linear',
    strokeWidth: 2,
    isAnimationActive: false,
    activeDot: { r: 4, stroke: 'var(--bg-raised)', strokeWidth: 2 },
  } as const

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <figcaption className="type-label text-fg-2">Balance over time</figcaption>
        {series.length > 1 && <Legend series={series} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <RangeGroup range={range} onRange={onRange} />
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
                {series.map((s) => (
                  <th key={s.label} className="py-1 pl-2 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-t border-line">
                  <td className="py-1 text-fg-2">{longDate(r.date)}</td>
                  {series.map((s) => {
                    const value = s.value(r)
                    return (
                      <td key={s.label} className="num py-1 pl-2 text-right text-fg">
                        {value === null ? '—' : money(value)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-64" role="img" aria-label={`${name} balance over time`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={plotRows(detail)} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
              <XAxis
                type="number"
                dataKey="t"
                domain={domain}
                tickFormatter={tick}
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
              <Tooltip
                content={(props) => <ChartTooltip {...props} series={series} />}
                cursor={{ stroke: 'var(--border-strong)' }}
              />
              <Line {...shared} dataKey="saved" name="Saved" stroke={SAVED} dot={dotFor('saved')} />
              {/* No connectNulls: a debt's null is before it began, and the line starts when the debt does. */}
              <Line {...shared} dataKey="target" name={label} stroke={TARGET} dot={dotFor('target')} />
              <Line
                {...shared}
                dataKey="expected"
                name="Expected"
                stroke={EXPECTED}
                strokeDasharray={EXPECTED_DASH}
                dot={false}
                connectNulls
              />
              <Line
                {...shared}
                dataKey="atThisRate"
                name="At this rate"
                stroke={SAVED}
                strokeDasharray={RATE_DASH}
                dot={false}
                connectNulls
              />
              <Line
                {...shared}
                dataKey="debtAtThisRate"
                name={label}
                stroke={TARGET}
                strokeDasharray={RATE_DASH}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
