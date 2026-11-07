import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { TransactionDto } from '../../src/shared/types'
import { TransactionDetail } from '../../src/web/components/transactions/TransactionDrawer'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { canMarkAsRepayment } from '../../src/web/lib/pay'

const tx = (over: Partial<TransactionDto> = {}): TransactionDto =>
  ({
    id: 'r1',
    accountId: 'acc-1',
    accountName: 'Spending',
    status: 'SETTLED',
    amountCents: -45_000,
    currency: 'AUD',
    foreignAmountCents: null,
    foreignCurrency: null,
    description: 'ACME CAR FINANCE',
    message: null,
    rawText: null,
    categoryId: null,
    parentCategoryId: null,
    isCategorizable: false,
    roundUpCents: null,
    cashbackCents: null,
    cardMethod: null,
    cardSuffix: null,
    transferAccountId: null,
    isTransfer: false,
    performingCustomer: null,
    performedByUserId: null,
    transactionType: 'Purchase',
    createdAt: '2026-10-01T00:00:00.000Z',
    settledAt: null,
    deletedAt: null,
    tags: [],
    ...over,
  }) as TransactionDto

const detail = (props: Partial<Parameters<typeof TransactionDetail>[0]>) =>
  render(
    <ToastProvider>
      <TransactionDetail
        tx={tx()}
        categories={[]}
        allTags={[]}
        spentBy={null}
        onCategory={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        {...props}
      />
    </ToastProvider>,
  )

test('canMarkAsRepayment', () => {
  expect(canMarkAsRepayment(tx())).toBe(true)
  expect(canMarkAsRepayment(tx({ transferAccountId: 'acc-2', isTransfer: true }))).toBe(false)
  expect(canMarkAsRepayment(tx({ amountCents: 45_000 }))).toBe(false)
})

test('marks a transaction as a repayment for a picked debt', async () => {
  const onMark = vi.fn()
  detail({
    repayment: {
      current: null,
      debts: [
        { id: 'd1', name: 'Car loan' },
        { id: 'd2', name: 'Tax' },
      ],
      onMark,
      onNotRepayment: vi.fn(),
    },
  })
  expect(screen.queryByRole('button', { name: 'Car loan' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'This is a repayment…' }))
  expect(screen.getByRole('checkbox', { name: 'Also count future “ACME CAR FINANCE” payments' })).toBeChecked()
  await userEvent.click(screen.getByRole('button', { name: 'Car loan' }))
  expect(onMark).toHaveBeenCalledWith('d1', true)

  // Unticked: just this one.
  await userEvent.click(screen.getByRole('button', { name: 'This is a repayment…' }))
  await userEvent.click(screen.getByRole('checkbox', { name: /Also count future/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Tax' }))
  expect(onMark).toHaveBeenLastCalledWith('d2', false)
})

test('drawer shows the repayment row', async () => {
  const onNotRepayment = vi.fn()
  const { rerender } = detail({
    repayment: {
      current: { debtId: 'd1', debtName: 'Car loan', canEdit: true },
      debts: [{ id: 'd1', name: 'Car loan' }],
      onMark: vi.fn(),
      onNotRepayment,
    },
  })
  expect(screen.getByText('Car loan')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'This is a repayment…' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Not a repayment' }))
  expect(onNotRepayment).toHaveBeenCalledWith('d1')

  rerender(
    <ToastProvider>
      <TransactionDetail
        tx={tx()}
        categories={[]}
        allTags={[]}
        spentBy={null}
        onCategory={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        repayment={{
          current: { debtId: 'd1', debtName: 'Car loan', canEdit: false },
          debts: [],
          onMark: vi.fn(),
          onNotRepayment,
        }}
      />
    </ToastProvider>,
  )
  expect(screen.getByText('Car loan')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Not a repayment' })).not.toBeInTheDocument()
})
