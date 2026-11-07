import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { StandardPayDto } from '../../src/shared/types'
import { BucketRow } from '../../src/web/components/budgets/BucketRow'
import { PaySummary } from '../../src/web/components/budgets/PaySummary'
import { buildPayView, type Bucket } from '../../src/web/lib/pay-view'
import { example, period } from './pay-fixtures'

function bucketFor(key: string, over: Partial<Bucket> = {}): Bucket {
  const input = example()
  const v = buildPayView({ ...input, period: { ...input.period, isCurrent: false } })
  const b = v.sections.flatMap((s) => s.buckets).find((x) => x.key === key)!
  return { ...b, ...over }
}

const row = (b: Bucket, usual?: 'shown' | 'hidden') =>
  render(
    <ul>
      <BucketRow bucket={b} href={null} pacePercent={null} usual={usual} />
    </ul>,
  )

const under: Partial<Bucket> = { amountCents: 40_000, spentCents: 37_500, leftCents: 2_500, state: 'ok', percent: 93 }

describe('BucketRow with usual figures', () => {
  test('under the limit shows Usually and spare', () => {
    row(bucketFor('line:groceries', under), 'shown')
    expect(screen.getByText('Usually $375.00')).toBeInTheDocument()
    expect(screen.getByText('$25.00 spare')).toBeInTheDocument()
    expect(screen.queryByText(/spent/)).toBeNull()
    expect(screen.queryByText(/left/)).toBeNull()
    expect(screen.queryByTestId('pace-tick')).toBeNull()
  })

  test('over the limit warns rather than reading as overspent', () => {
    const { container } = row(
      bucketFor('line:groceries', { amountCents: 40_000, spentCents: 42_000, leftCents: -2_000, state: 'over', percent: 105 }),
      'shown',
    )
    expect(screen.getByText('$20.00 over')).toHaveClass('text-warning')
    expect(container.querySelector('.text-negative')).toBeNull()
    expect(container.querySelector('.bg-negative')).toBeNull()
    expect(container.querySelector('[role="meter"] .bg-warning')).not.toBeNull()
  })

  test('shared Other spending shows only the usual figure', () => {
    row(
      bucketFor('other', { key: 'shared-other', kind: 'shared-other', amountCents: null, spentCents: 9_000, leftCents: null, state: null }),
      'shown',
    )
    expect(screen.getByText('Usually $90.00')).toBeInTheDocument()
    expect(screen.queryByText(/spare|over/)).toBeNull()
  })

  test('the meter reads as a usual figure, not actual spending', () => {
    row(bucketFor('line:groceries', under), 'shown')
    expect(screen.getByRole('meter', { name: 'Groceries usually spent' })).toBeInTheDocument()
  })

  test('hidden shows the amount only', () => {
    row(bucketFor('line:groceries', under), 'hidden')
    expect(screen.queryByText(/Usually|spare|spent|left/)).toBeNull()
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByText('$400.00')).toBeInTheDocument()
  })

  test('without the prop the row is This pay', () => {
    row(bucketFor('line:groceries', { ...under, state: 'warning' }))
    expect(screen.getByText('$25.00 left')).toBeInTheDocument()
    expect(screen.getByText('$375.00 spent')).toBeInTheDocument()
  })
})

describe('PaySummary as a Standard pay', () => {
  const standardPay = (over: Partial<StandardPayDto> = {}): StandardPayDto => ({
    plan: example().plan,
    period: period({ isCurrent: false }),
    jointPeriod: null,
    payCount: 5,
    hasUsual: true,
    jointHasUsual: true,
    payIsMedian: true,
    ...over,
  })
  const summary = (standard: StandardPayDto | null) => {
    const input = example()
    const p = { ...input.period, isCurrent: !standard }
    const view = buildPayView({ ...input, period: p, standard: standard && { hasUsual: standard.hasUsual } })
    render(<PaySummary view={view} period={p} payDate="2026-10-30" standard={standard} />)
    return view
  }

  test('with usual figures', () => {
    const view = summary(standardPay())
    const head = screen.getByRole('group', { name: 'Usually left over' })
    expect(head).toHaveTextContent('of $1,160.00')
    expect(head).not.toHaveTextContent(/On pace|fast|Over plan/)
    expect(screen.getByRole('group', { name: 'Usual pay' })).toHaveTextContent('Median of recent pays')
    expect(screen.getByRole('group', { name: 'To Savers' })).toHaveTextContent('Every pay')
    expect(screen.getByRole('group', { name: 'Usually spent' })).toHaveTextContent('Per pay')
    expect(screen.getByRole('group', { name: 'Usually spent' })).toHaveTextContent('$697.45')
    expect(view.pace).toBeNull()
    expect(
      screen.getByText(
        "Uses the median of your last 5 finished pays. A bill that only lands now and then, like yearly car insurance, won't show here unless you set money aside for it in a Saver.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Your Savers: 6% of a standard pay' })).toBeInTheDocument()
  })

  test('without usual figures', () => {
    summary(standardPay({ hasUsual: false, payIsMedian: false }))
    expect(screen.getByRole('group', { name: 'Left after limits' })).toHaveTextContent('$510.00')
    expect(screen.getByRole('group', { name: 'Usual pay' })).toHaveTextContent('Expected')
    expect(screen.queryByRole('group', { name: 'Usually spent' })).toBeNull()
    expect(screen.getByText('Usual spending appears once you have 3 finished pays.')).toBeInTheDocument()
  })

  test('without the prop the text is unchanged', () => {
    summary(null)
    expect(screen.getByRole('group', { name: 'Left to spend' })).toHaveTextContent('On pace')
    expect(within(screen.getByRole('group', { name: 'This pay' })).getByText('Paid 30 Oct')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Spent so far' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Your Savers: 6% of this pay' })).toBeInTheDocument()
    expect(screen.queryByText(/finished pays/)).toBeNull()
  })
})
