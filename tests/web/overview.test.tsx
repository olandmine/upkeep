import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { OverviewDto } from '../../src/shared/types'
import { KpiRow } from '../../src/web/components/overview/KpiRow'
import { allocationSegments } from '../../src/web/lib/allocation'
import { formatDelta } from '../../src/web/lib/delta'

test('allocation percentages sum to 100 and merge the tail', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, cents: (10 - i) * 1000, colorToken: 'cat-blue' }))
  const segments = allocationSegments(items)
  expect(segments).toHaveLength(8)
  expect(segments.at(-1)).toMatchObject({ key: 'other', label: 'Other', colorToken: 'cat-slate', cents: 3000 + 2000 + 1000 })
  expect(segments.reduce((sum, s) => sum + s.percent, 0)).toBeCloseTo(100, 2)
})

test('allocation drops zero and negative values', () => {
  const segments = allocationSegments([
    { key: 'a', label: 'A', cents: 300, colorToken: 'cat-blue' },
    { key: 'b', label: 'B', cents: 0, colorToken: 'cat-teal' },
    { key: 'c', label: 'C', cents: -50, colorToken: 'cat-rose' },
    { key: 'd', label: 'D', cents: 100, colorToken: 'cat-green' },
  ])
  expect(segments.map((s) => [s.key, s.percent])).toEqual([
    ['a', 75],
    ['d', 25],
  ])
  expect(allocationSegments([])).toEqual([])
})

test('formatDelta', () => {
  expect(formatDelta(1042, 1000)).toEqual({ text: '▲ 4.2% vs last month', direction: 'up' })
  expect(formatDelta(900, 1000)).toEqual({ text: '▼ 10.0% vs last month', direction: 'down' })
  expect(formatDelta(1000, 1000)).toEqual({ text: '0.0% vs last month', direction: 'flat' })
  expect(formatDelta(5, 0)).toBeNull()
  expect(formatDelta(-500, -1000)).toEqual({ text: '▲ 50.0% vs last month', direction: 'up' })
})

const overview = (o: Partial<OverviewDto> = {}): OverviewDto => ({
  totalBalanceCents: 29792480,
  homeLoanCents: null,
  month: { spentCents: 104200, incomeCents: 500000, netCents: 395800 },
  previousMonth: { spentCents: 100000, incomeCents: 500000, netCents: 400000 },
  balancesByAccount: [],
  spendingByParent: [],
  topCategories: [],
  monthly: [],
  recent: [],
  ...o,
})

test('KPI row shows hero total with superscript cents and spending delta as negative', () => {
  const { container } = render(<KpiRow overview={overview()} />)
  expect(screen.getByText('Total balance')).toBeInTheDocument()
  expect(container.querySelector('sup')).toHaveTextContent('.80')
  const spentDelta = screen.getByText('▲ 4.2% vs last month')
  expect(spentDelta.className).toContain('text-negative')
  expect(screen.queryByText('Home loan')).not.toBeInTheDocument()
})

test('KPI row shows a home loan when present', () => {
  render(<KpiRow overview={overview({ homeLoanCents: -40000000 })} />)
  expect(screen.getByText('Home loan')).toBeInTheDocument()
})
