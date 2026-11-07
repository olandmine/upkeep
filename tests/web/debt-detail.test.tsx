import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { DebtDto } from '../../src/shared/types'
import { buildingUpCaption } from '../../src/web/components/debts/format'
import { RepaymentsSection } from '../../src/web/components/debts/DebtSections'
import { UpdateBalanceForm } from '../../src/web/components/debts/UpdateBalanceForm'

test('update balance asks before replacing a date', async () => {
  const onSave = vi.fn()
  render(<UpdateBalanceForm existingDates={['2026-10-01']} onSave={onSave} />)
  await userEvent.type(screen.getByLabelText('Balance'), '8000')
  const asOf = screen.getByLabelText('As of')
  await userEvent.clear(asOf)
  await userEvent.type(asOf, '2026-10-01')
  await userEvent.click(screen.getByRole('button', { name: 'Save balance' }))
  expect(screen.getByText(/Replace the balance for/)).toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Replace' }))
  expect(onSave).toHaveBeenCalledWith({ balanceCents: 800_000, asOf: '2026-10-01' })
})

test('update balance saves a new date straight away', async () => {
  const onSave = vi.fn()
  render(<UpdateBalanceForm existingDates={['2026-10-01']} onSave={onSave} />)
  await userEvent.type(screen.getByLabelText('Balance'), '8000')
  const asOf = screen.getByLabelText('As of')
  await userEvent.clear(asOf)
  await userEvent.type(asOf, '2026-10-15')
  await userEvent.click(screen.getByRole('button', { name: 'Save balance' }))
  expect(onSave).toHaveBeenCalledWith({ balanceCents: 800_000, asOf: '2026-10-15' })
})

test('no rule copy', () => {
  render(
    <RepaymentsSection
      rules={[]}
      exclusions={[]}
      hasRepayments={false}
      canEdit
      onStopMatching={() => {}}
      onUndo={() => {}}
    />,
  )
  expect(screen.getByText('No repayments matched yet. Mark one from Transactions.')).toBeInTheDocument()
})

test('no rule copy is left out when one-off repayments exist', () => {
  render(
    <RepaymentsSection
      rules={[]}
      exclusions={[]}
      hasRepayments
      canEdit
      onStopMatching={() => {}}
      onUndo={() => {}}
    />,
  )
  expect(screen.queryByText('No repayments matched yet. Mark one from Transactions.')).toBeNull()
})

test('rules and exclusions', async () => {
  const onUndo = vi.fn()
  const onStopMatching = vi.fn()
  const r = (id: string, date: string, oneOff = false, description = 'ACME CAR FINANCE') => ({
    transactionId: id,
    date,
    amountCents: 45_000,
    description,
    oneOff,
  })
  render(
    <RepaymentsSection
      rules={[
        { id: 'rule-1', match: 'acme car finance' },
        { id: 'rule-2', match: 'tax office payments' },
      ]}
      exclusions={[r('r1', '2026-09-01')]}
      hasRepayments
      canEdit
      onStopMatching={onStopMatching}
      onUndo={onUndo}
    />,
  )
  expect(screen.getByText('“acme car finance”')).toBeInTheDocument()
  expect(screen.getByText('“tax office payments”')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Stop matching “tax office payments”' }))
  expect(onStopMatching).toHaveBeenCalledWith('rule-2')
  expect(screen.queryByRole('button', { name: 'Not a repayment' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(onUndo).toHaveBeenCalledWith('r1')
})

test('building-up caption', () => {
  const d = (accruingCents: number, nextChargeOn: string | null) => ({ accruingCents, nextChargeOn }) as DebtDto
  expect(buildingUpCaption(d(9_500, '2026-11-01'))).toBe('+$95.00 interest building up · charged 1 Nov 2026')
  expect(buildingUpCaption(d(0, '2026-11-01'))).toBeNull()
  expect(buildingUpCaption(d(9_500, null))).toBeNull()
})
