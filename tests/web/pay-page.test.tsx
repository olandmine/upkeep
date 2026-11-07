import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { BudgetPeriodDto } from '../../src/shared/types'
import { PayPage } from '../../src/web/components/budgets/PayPage'
import { account, example, line, period, plan, saverItem } from './pay-fixtures'

type Input = ReturnType<typeof example>

function page(over: Partial<Input> = {}, props: Partial<Parameters<typeof PayPage>[0]> = {}) {
  const input = { ...example(), ...over }
  return render(
    <PayPage
      plan={input.plan}
      accounts={input.accounts}
      goals={input.goals}
      period={input.period}
      jointPeriod={input.jointPeriod}
      jointSetUp={Boolean(input.jointPeriod)}
      person="u1"
      viewerId="u1"
      payDate="2026-10-30"
      onSetUpJoint={() => {}}
      onApply={async () => {}}
      {...props}
    />,
  )
}

test('the summary leads with Left to spend and pace', () => {
  page()
  const left = screen.getByRole('group', { name: 'Left to spend' })
  expect(left).toHaveTextContent('$462.55')
  expect(left).toHaveTextContent('of $1,160.00')
  expect(left).toHaveTextContent('On pace')
})

test('the summary shows the pay, Savers and days', () => {
  page()
  expect(screen.getByRole('group', { name: 'This pay' })).toHaveTextContent('$4,120.00')
  expect(screen.getByRole('group', { name: 'This pay' })).toHaveTextContent('Paid 30 Oct')
  expect(screen.getByRole('group', { name: 'To Savers' })).toHaveTextContent('$2,960.00')
  expect(screen.getByRole('group', { name: 'To Savers' })).toHaveTextContent('1 of 3 moved')
  expect(screen.getByRole('group', { name: 'Spent so far' })).toHaveTextContent('$697.45')
  expect(screen.getByRole('group', { name: 'Spent so far' })).toHaveTextContent('10 of 14 days')
})

test('the Total row shows what the summary shows', () => {
  page()
  const total = screen.getByTestId('spending-total')
  expect(total).toHaveTextContent('$1,160.00')
  expect(total).toHaveTextContent('$697.45 spent')
  expect(total).toHaveTextContent('$462.55 left to spend')
})

test("the pay bar shows each part's share", () => {
  page()
  expect(screen.getByRole('img', { name: 'Stays in Spending: 28% of this pay' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Your Savers: 6% of this pay' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Joint Savers: 66% of this pay' })).toBeInTheDocument()
})

test('a limit shows left, spent and a progress bar labelled as spent', () => {
  page()
  const row = screen.getByRole('link', { name: /Groceries/ })
  expect(row).toHaveTextContent('$113.60 left')
  expect(row).toHaveTextContent('$286.40 spent')
  expect(row).toHaveTextContent('$400.00')
  const meter = within(row).getByRole('meter', { name: 'Groceries spent' })
  expect(meter).toHaveAttribute('aria-valuenow', '72')
  expect(within(row).getByTestId('pace-tick')).toHaveStyle({ left: `${(10 / 14) * 100}%` })
})

describe("a shared limit's pace tick", () => {
  const joint = (over: Partial<BudgetPeriodDto>) =>
    period({
      budgetId: 'j',
      start: '2026-11-05',
      nominalEnd: '2026-11-19',
      daysElapsed: 3,
      lines: [line('shared-g', { name: 'Shared groceries', amountCents: 60_000, spentCents: 10_000 })],
      ...over,
    })
  const sharedRow = () => screen.getByRole('link', { name: /Shared groceries/ })

  test("follows the joint period's days, not the pay's", () => {
    page({ jointPeriod: joint({}) })
    expect(within(sharedRow()).getByTestId('pace-tick')).toHaveStyle({ left: `${(3 / 14) * 100}%` })
    expect(within(screen.getByRole('link', { name: /Groceries/ })).getByTestId('pace-tick')).toHaveStyle({
      left: `${(10 / 14) * 100}%`,
    })
  })

  test('is hidden when the joint period is not the current one', () => {
    page({ jointPeriod: joint({ isCurrent: false, end: '2026-11-19' }) })
    expect(within(sharedRow()).queryByTestId('pace-tick')).not.toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: /Groceries/ })).getByTestId('pace-tick')).toBeInTheDocument()
  })

  test('is hidden on a past pay, even when the joint period it falls in is still running', () => {
    page({ period: { ...example().period, isCurrent: false, end: '2026-11-13' }, jointPeriod: joint({}) })
    expect(screen.queryByTestId('pace-tick')).not.toBeInTheDocument()
  })
})

test('a limit over its amount says how far over, and the bar stops at full', () => {
  page({
    period: period({
      lines: [line('eating', { name: 'Eating out', amountCents: 10_000, spentCents: 12_500 })],
    }),
    plan: plan([]),
  })
  const row = screen.getByRole('link', { name: /Eating out/ })
  expect(row).toHaveTextContent('Over by $25.00')
  expect(within(row).getByRole('meter')).toHaveAttribute('aria-valuenow', '100')
})

test('a limit row links to its transactions; a Saver row links to its account', () => {
  page()
  const limit = screen.getByRole('link', { name: /Groceries/ })
  const href = new URL(limit.getAttribute('href')!, 'http://x')
  expect(href.pathname).toBe('/transactions')
  expect(href.searchParams.get('scope')).toBe('me')
  expect(href.searchParams.get('categoryIds')).toBe('food')
  expect(href.searchParams.get('from')).toBe('2026-10-30')
  expect(screen.getByRole('link', { name: /rainy Saver/ })).toHaveAttribute('href', '/accounts/rainy')
})

test('a Saver row shows its moved status', () => {
  page()
  expect(screen.getByRole('link', { name: /rainy Saver/ })).toHaveTextContent('Moved ✓')
  expect(screen.getByRole('link', { name: /holiday Saver/ })).toHaveTextContent('$200.00 of $710.00 moved')
  expect(screen.getByRole('link', { name: /house Saver/ })).toHaveTextContent('Not moved yet')
})

test('a Saver of $0 shows no moved status', () => {
  page({ plan: plan([saverItem('rainy', 0, 'pending', 0)]) })
  const row = screen.getByRole('link', { name: /rainy Saver/ })
  expect(row).not.toHaveTextContent('moved')
  expect(row).not.toHaveTextContent('Moved')
})

test('moved back shows on the Total row only when above $0', () => {
  const { unmount } = page()
  expect(screen.getByTestId('spending-total')).not.toHaveTextContent('moved back')
  unmount()
  page({ period: { ...example().period, movedBackCents: 5_000 } })
  expect(screen.getByTestId('spending-total')).toHaveTextContent('includes $50.00 moved back from Savers')
})

test('Other spending has the caption Whatever is left of your pay', () => {
  page()
  const row = screen.getByRole('link', { name: /Other spending/ })
  expect(row).toHaveTextContent('Whatever is left of your pay')
  expect(row).toHaveTextContent('$510.00')
  expect(row).toHaveTextContent('$311.70 left')
})

test('shared Other spending shows spent only', () => {
  page({
    jointPeriod: period({
      budgetId: 'j',
      lines: [line('shared-g', { name: 'Shared groceries', amountCents: 60_000, spentCents: 31_260 })],
      notBudgetedCents: 8_420,
    }),
  })
  const shared = screen.getByRole('region', { name: 'Shared spending limits' })
  const row = within(shared).getByRole('link', { name: /Other spending/ })
  expect(row).toHaveTextContent('$84.20 spent')
  expect(row).not.toHaveTextContent('left')
  expect(row).not.toHaveTextContent('Over by')
  expect(within(row).queryByRole('meter')).not.toBeInTheDocument()
  expect(new URL(row.getAttribute('href')!, 'http://x').searchParams.get('scope')).toBe('joint')
})

test('a past pay says Left over, with no pace', () => {
  page({ period: { ...example().period, isCurrent: false, end: '2026-11-13' } })
  const left = screen.getByRole('group', { name: 'Left over' })
  expect(left).toHaveTextContent('$462.55')
  expect(screen.queryByRole('group', { name: 'Left to spend' })).not.toBeInTheDocument()
  expect(screen.queryByText(/On pace|Spending fast|Over plan/)).not.toBeInTheDocument()
  expect(screen.queryByTestId('pace-tick')).not.toBeInTheDocument()
  expect(screen.getByTestId('spending-total')).toHaveTextContent('$462.55 left over')
})

test('an expected pay is labelled Expected', () => {
  page({ plan: { ...example().plan, incomeIsExpected: true } })
  expect(screen.getByRole('group', { name: 'This pay' })).toHaveTextContent('Expected 30 Oct')
})

test('shared limits show their own dates when they differ', () => {
  const shared = (over: Partial<BudgetPeriodDto>) =>
    period({
      budgetId: 'j',
      lines: [line('shared-g', { name: 'Shared groceries', amountCents: 60_000 })],
      ...over,
    })
  const { unmount } = page({ jointPeriod: shared({}) })
  expect(screen.getByRole('region', { name: 'Shared spending limits' })).not.toHaveTextContent('Joint pay')
  unmount()
  page({ jointPeriod: shared({ start: '2026-10-28', nominalEnd: '2026-11-11' }) })
  expect(screen.getByRole('region', { name: 'Shared spending limits' })).toHaveTextContent(
    'Joint pay 28 Oct – 10 Nov',
  )
})

test('section headers say per pay, and a shared one says a fortnight', () => {
  page({
    jointPeriod: period({
      budgetId: 'j',
      lines: [line('shared-g', { name: 'Shared groceries', amountCents: 60_000 })],
    }),
  })
  const header = (name: string) =>
    within(screen.getByRole('region', { name })).getAllByRole('heading')[0].closest('header')!
  expect(header('Stays in Spending')).toHaveTextContent('$1,160.00 per pay')
  expect(header('Your Savers')).toHaveTextContent('per pay')
  expect(header('Joint Savers you pay into')).toHaveTextContent('per pay')
  expect(header('Shared spending limits')).toHaveTextContent('$600.00 a fortnight')
})

test('a shared section with no limits shows no total', () => {
  page({ jointPeriod: period({ budgetId: 'j', lines: [], notBudgetedCents: 8_420 }) })
  const shared = screen.getByRole('region', { name: 'Shared spending limits' })
  expect(shared).not.toHaveTextContent('$0.00')
  expect(shared).not.toHaveTextContent('a fortnight')
})

test('a Saver caption starts with Balance', () => {
  page()
  expect(screen.getByRole('link', { name: /rainy/ })).toHaveTextContent(/Balance \$/)
})

test('a Joint that is not set up offers to set it up', () => {
  page({ jointPeriod: null })
  const region = screen.getByRole('region', { name: 'Shared spending limits' })
  expect(within(region).getByRole('button', { name: 'Set up Joint' })).toBeInTheDocument()
})

test('a missing Saver says Saver not found', () => {
  page({ accounts: [account('house', 'JOINT'), account('holiday', 'JOINT')] })
  expect(screen.getByRole('link', { name: /rainy/ })).toHaveTextContent('Saver not found')
})

test('the bar hides Stays in Spending when Savers total more than the pay', () => {
  page({ plan: plan([saverItem('house', 500_000, 'pending', 0)]) })
  expect(screen.queryByRole('img', { name: /Stays in Spending/ })).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Joint Savers: 100% of this pay' })).toBeInTheDocument()
})

test('over your pay warns in words', () => {
  page({ plan: plan([saverItem('house', 356_000, 'pending', 0)]) })
  expect(screen.getByText('Over your pay by $90.00')).toBeInTheDocument()
})
