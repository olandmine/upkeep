import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { BudgetPeriodDto } from '../../src/shared/types'
import { PeriodHeader } from '../../src/web/components/budgets/PeriodHeader'

const period = (over: Partial<BudgetPeriodDto> = {}): BudgetPeriodDto => ({
  budgetId: 'b1',
  start: '2026-10-30',
  end: null,
  nominalEnd: '2026-11-13',
  isCurrent: true,
  prevDate: '2026-10-16',
  nextDate: null,
  source: 'detected',
  payNotSeen: false,
  daysTotal: 14,
  daysElapsed: 8,
  incomeCents: 400000,
  movedBackCents: 0,
  lines: [],
  notBudgetedCents: 0,
  totals: { limitCents: 0, spentCents: 0 },
  beforeSetup: false,
  ...over,
})

test('period header', async () => {
  const onPrev = vi.fn()
  const { rerender } = render(<PeriodHeader period={period()} onPrev={onPrev} onNext={() => {}} />)
  expect(screen.getByText('30 Oct – 12 Nov')).toBeInTheDocument()
  expect(screen.getByText('6 days left')).toBeInTheDocument()
  expect(screen.queryByText('Pay not seen')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Previous period' }))
  expect(onPrev).toHaveBeenCalledOnce()

  rerender(
    <PeriodHeader
      period={period({ source: 'scheduled', payNotSeen: true, isCurrent: false, end: '2026-11-13', nextDate: '2026-11-13' })}
      onPrev={() => {}}
      onNext={() => {}}
    />,
  )
  expect(screen.getByText('Pay not seen')).toBeInTheDocument()
  expect(screen.queryByText(/days left/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next period' })).toBeEnabled()
})
