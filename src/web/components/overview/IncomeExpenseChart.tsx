import { useSyncExternalStore } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { formatCompact } from '../../../shared/money'
import type { OverviewDto } from '../../../shared/types'
import { Money } from '../Money'
import { Dot } from '../ui/Badge'

const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-AU', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`))

const SERIES = [
  { key: 'incomeCents', label: 'Income', token: 'positive' },
  { key: 'spentCents', label: 'Spending', token: 'cat-orange' },
] as const

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const subscribe = () => () => {}

function ChartTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null
  return (
    <div className="type-caption rounded-md border border-line-2 bg-elevated px-3 py-2 shadow-float">
      <p className="mb-1 text-fg">{monthName(String(label))}</p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center gap-2 text-fg-2">
          <Dot token={s.token} />
          {s.label}
          <Money cents={Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0)} className="ml-auto pl-4 text-fg" />
        </p>
      ))}
    </div>
  )
}

/** Bars: income vs spending per month; current month full opacity, past months 60%. */
export function IncomeExpenseChart({ monthly }: { monthly: OverviewDto['monthly'] }) {
  const animate = !useSyncExternalStore(subscribe, reducedMotion, () => true)
  const last = monthly.length - 1
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex gap-4">
        {SERIES.map((s) => (
          <span key={s.key} className="type-caption flex items-center gap-1.5 text-fg-2">
            <Dot token={s.token} />
            {s.label}
          </span>
        ))}
      </figcaption>
      <div className="h-56" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthly} barGap={4} barCategoryGap="30%" margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
            <XAxis
              dataKey="month"
              tickFormatter={monthName}
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
            />
            <YAxis
              tickFormatter={(v: number) => formatCompact(v)}
              axisLine={false}
              tickLine={false}
              width={56}
              tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
            />
            <Tooltip content={ChartTooltip} cursor={{ fill: 'var(--bg-elevated)', opacity: 0.6 }} />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} maxBarSize={10} radius={[2, 2, 0, 0]} fill={`var(--${s.token})`} isAnimationActive={animate}>
                {monthly.map((m, i) => (
                  <Cell key={m.month} fillOpacity={i === last ? 1 : 0.6} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Table view of the same data for screen readers (dataviz a11y pass). */}
      <table className="sr-only">
        <caption>Income and spending by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Income</th>
            <th scope="col">Spending</th>
          </tr>
        </thead>
        <tbody>
          {monthly.map((m) => (
            <tr key={m.month}>
              <th scope="row">{monthName(m.month)}</th>
              <td>
                <Money cents={m.incomeCents} />
              </td>
              <td>
                <Money cents={m.spentCents} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
