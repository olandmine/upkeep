import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { BudgetDto, BudgetPeriodDto, PayScheduleDto } from '../../src/shared/types'
import { SetupWizard } from '../../src/web/components/budgets/SetupWizard'
import { PayCard } from '../../src/web/components/settings/PayCard'
import { canEditPeriod } from '../../src/web/lib/budget-lines'
import { invalidateAfterTransactionEdit } from '../../src/web/lib/queries'

test('only the current period can be edited', () => {
  const budget = { canEdit: true, setup: 'ready' } as BudgetDto
  expect(canEditPeriod(budget, { isCurrent: true } as BudgetPeriodDto)).toBe(true)
  expect(canEditPeriod(budget, { isCurrent: false } as BudgetPeriodDto)).toBe(false)
  expect(canEditPeriod({ ...budget, canEdit: false }, { isCurrent: true } as BudgetPeriodDto)).toBe(false)
  expect(canEditPeriod(budget, undefined)).toBe(false)
})

test('wizard says "You haven\'t" for your own unconnected budget', () => {
  render(
    <SetupWizard
      budget={{
        id: 'b1',
        kind: 'personal',
        ownerUserId: 'u1',
        name: 'Mine',
        anchorUserId: null,
        hasPeriods: false,
        canEdit: true,
        setup: 'partner-not-connected',
      }}
      users={[]}
      candidates={[]}
      savers={[]}
      categories={[]}
      proposal={null}
      onMarkPay={vi.fn()}
      onSetAnchor={vi.fn()}
      onCreateLines={vi.fn()}
      onSavePlan={vi.fn()}
      onDone={vi.fn()}
    />,
  )
  expect(screen.getByText("You haven't connected Up yet")).toBeInTheDocument()
})

test('pay card can stop using the pay schedule after confirming', async () => {
  const schedule: PayScheduleDto = {
    userId: 'u1',
    accountId: 'a',
    accountName: 'Spending',
    accountMissing: false,
    descriptionMatch: 'acme pay',
    minAmountCents: 200000,
    frequencyDays: 14,
  }
  const onDelete = vi.fn()
  render(
    <PayCard
      schedule={schedule}
      events={[]}
      exclusions={[]}
      onSave={vi.fn()}
      onUndo={vi.fn()}
      onNotMyPay={vi.fn()}
      onDelete={onDelete}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Stop detecting pay' }))
  expect(onDelete).not.toHaveBeenCalled()
  expect(await screen.findByText(/Budgets lose their pay periods/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
  expect(onDelete).toHaveBeenCalledOnce()
})

test('editing a transaction refreshes its Budget row and the budget figures', async () => {
  const qc = new QueryClient()
  qc.setQueryData(['budget-line', 't1'], { budgetName: 'Mine', lineName: null })
  qc.setQueryData(['budget-period', 'b1', 'current'], {})
  qc.setQueryData(['budget-line', 't2'], null)
  await invalidateAfterTransactionEdit(qc, 't1')
  expect(qc.getQueryState(['budget-line', 't1'])?.isInvalidated).toBe(true)
  expect(qc.getQueryState(['budget-period', 'b1', 'current'])?.isInvalidated).toBe(true)
  expect(qc.getQueryState(['budget-line', 't2'])?.isInvalidated).toBe(false)
})
