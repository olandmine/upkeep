import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { DebtDto, PayoffPlanDto, UserDto } from '../../src/shared/types'
import { DebtCard } from '../../src/web/components/debts/DebtCard'
import { DebtForm, todayIso } from '../../src/web/components/debts/DebtForm'
import { parseRate, rateText } from '../../src/web/components/debts/format'
import { PayoffPlan } from '../../src/web/components/debts/PayoffPlan'

const debt = (over: Partial<DebtDto> = {}): DebtDto => ({
  id: 'd1',
  name: 'Car loan',
  kind: 'loan',
  ownerUserId: 'u1',
  ownerName: 'Owner',
  rateBp: 649,
  interest: { calc: 'on_charge', charge: 'monthly', chargeDay: 15, chargeDate: null },
  repaymentCents: 45_000,
  repaymentFrequency: 'monthly',
  fee: null,
  repaymentRules: [{ id: 'rule-1', match: 'acme car finance' }],
  balanceCents: 820_000,
  accruingCents: 0,
  nextChargeOn: '2026-11-15',
  firstBalance: { asOf: '2026-06-15', balanceCents: 1_000_000 },
  paidOffOn: null,
  projection: { payoffDate: '2028-03-01', totalInterestCents: 52_000, shortfallCents: null },
  estimated: false,
  canEdit: true,
  ...over,
})

const me: UserDto = { id: 'u1', username: 'owner', displayName: 'Owner', negativeStyle: 'minus' } as UserDto

test('debt card states', () => {
  const { rerender } = render(<DebtCard debt={debt()} />)
  expect(screen.getByText('Paid off by Mar 2028')).toBeInTheDocument()
  expect(screen.getByText('$8,200.00')).toBeInTheDocument()
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '18')
  expect(screen.getByRole('link')).toHaveAttribute('href', '/debts/d1')
  expect(screen.queryByText('Estimated')).not.toBeInTheDocument()

  rerender(
    <DebtCard
      debt={debt({ projection: { payoffDate: null, totalInterestCents: 0, shortfallCents: 2_500 } })}
    />,
  )
  expect(screen.getByText('Never')).toBeInTheDocument()
  expect(screen.getByText('Short $25.00/month')).toBeInTheDocument()

  rerender(
    <DebtCard debt={debt({ paidOffOn: '2026-10-01', balanceCents: 0, projection: null, estimated: true })} />,
  )
  expect(screen.getByText('Paid off ✓')).toBeInTheDocument()
  expect(screen.getByText('Estimated')).toBeInTheDocument()

  rerender(<DebtCard debt={debt()} showOwner />)
  expect(screen.getByText('Owner')).toBeInTheDocument()
})

test('rate helpers', () => {
  expect(parseRate('6.49')).toBe(649)
  expect(parseRate(' 0 ')).toBe(0)
  expect(parseRate('101')).toBeNull()
  expect(parseRate('abc')).toBeNull()
  expect(parseRate('')).toBeNull()
  expect(rateText(649)).toBe('6.49%')
  expect(rateText(500)).toBe('5%')
})

test('debt form hides the rate for BNPL and labels it per kind', async () => {
  const onSave = vi.fn()
  render(<DebtForm me={me} onSave={onSave} onCancel={() => {}} />)
  expect(screen.getByLabelText('Interest rate (yearly)')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Kind'), 'ato')
  expect(screen.getByLabelText('Interest rate (yearly)')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Kind'), 'hecs')
  expect(screen.getByLabelText('Indexation rate (yearly)')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Kind'), 'bnpl')
  expect(screen.queryByLabelText(/rate/i)).not.toBeInTheDocument()

  await userEvent.type(screen.getByLabelText('Name'), 'Laptop')
  await userEvent.type(screen.getByLabelText('Balance'), '1200')
  await userEvent.type(screen.getByLabelText('Usual repayment'), '100')
  await userEvent.click(screen.getByRole('button', { name: 'Add debt' }))
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Laptop',
      kind: 'bnpl',
      rateBp: 0,
      balanceCents: 120_000,
      repaymentCents: 10_000,
      ownerUserId: 'u1',
    }),
  )
})

const plan = (over: Partial<PayoffPlanDto> = {}): PayoffPlanDto => ({
  extraCents: 10_000,
  includeHecs: false,
  canEdit: true,
  scenarios: [
    {
      strategy: 'as-is',
      debtFreeMonth: '2029-01',
      totalInterestCents: 90_000,
      debts: [{ id: 'd1', name: 'Car loan', payoffMonth: '2029-01' }],
      series: [{ month: '2026-11', totalCents: 800_000 }],
    },
    {
      strategy: 'avalanche',
      debtFreeMonth: '2028-03',
      totalInterestCents: 60_000,
      debts: [{ id: 'd1', name: 'Car loan', payoffMonth: '2028-03' }],
      series: [{ month: '2026-11', totalCents: 790_000 }],
    },
    {
      strategy: 'snowball',
      debtFreeMonth: null,
      totalInterestCents: 60_000,
      debts: [{ id: 'd1', name: 'Car loan', payoffMonth: null }],
      series: [{ month: '2026-11', totalCents: 790_000 }],
    },
  ],
  differences: ['Avalanche: debt-free 10 months sooner and $300.00 less interest than As is.'],
  ...over,
})

test('payoff plan shows scenarios and differences', async () => {
  const onChange = vi.fn()
  const { rerender } = render(<PayoffPlan plan={plan()} onChange={onChange} />)
  for (const heading of ['As is', 'Avalanche', 'Snowball'])
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  expect(screen.getByText('Debt-free Mar 2028')).toBeInTheDocument()
  expect(screen.getAllByText('Never').length).toBeGreaterThan(0)
  expect(
    screen.getByText('Avalanche: debt-free 10 months sooner and $300.00 less interest than As is.'),
  ).toBeInTheDocument()

  expect(screen.getByText('Each debt gets only its usual repayment.')).toBeInTheDocument()
  expect(screen.getByText(/highest-rate debt first/)).toBeInTheDocument()
  expect(screen.getByText(/smallest balance first/)).toBeInTheDocument()
  expect(screen.getByText('Added on top of your repayments in Avalanche and Snowball.')).toBeInTheDocument()

  await userEvent.click(screen.getByLabelText('Include HECS'))
  expect(onChange).toHaveBeenCalledWith({ extraCents: 10_000, includeHecs: true })

  rerender(<PayoffPlan plan={plan({ canEdit: false })} onChange={onChange} />)
  expect(screen.getByLabelText('Extra per month')).toBeDisabled()
})

test('empty plan says nothing to pay off, not never', () => {
  const empty = plan({
    includeHecs: false,
    differences: [],
    scenarios: (['as-is', 'avalanche', 'snowball'] as const).map((strategy) => ({
      strategy,
      debtFreeMonth: null,
      totalInterestCents: 0,
      debts: [],
      series: [],
    })),
  })
  render(<PayoffPlan plan={empty} onChange={() => {}} />)
  expect(screen.getByText(/Nothing to pay off/)).toBeInTheDocument()
  expect(screen.getByText(/Include HECS/, { selector: 'p' })).toBeInTheDocument()
  expect(screen.queryByText('Never')).not.toBeInTheDocument()
})

test('editing a debt corrects its latest balance: its amount, or its date', async () => {
  const onSave = vi.fn()
  const balance = { id: 'b1', asOf: '2026-10-30', balanceCents: 4_400_000 }
  const { unmount } = render(<DebtForm debt={debt()} balance={balance} me={me} onSave={onSave} onCancel={() => {}} />)
  expect(screen.getByLabelText('Balance')).toHaveValue('44000.00')
  expect(screen.getByLabelText('As of')).toHaveValue('2026-10-30')

  // Untouched: only the details are saved.
  await userEvent.click(screen.getByRole('button', { name: 'Save debt' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Car loan' }), null, null)

  await userEvent.clear(screen.getByLabelText('Balance'))
  await userEvent.type(screen.getByLabelText('Balance'), '15084.6')
  await userEvent.click(screen.getByRole('button', { name: 'Save debt' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Car loan' }), {
    balanceCents: 1_508_460,
    asOf: '2026-10-30',
    replacesId: null,
  }, null)

  // A new date moves this balance there, rather than adding a second one.
  fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-05-14' } })
  await userEvent.click(screen.getByRole('button', { name: 'Save debt' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Car loan' }), {
    balanceCents: 1_508_460,
    asOf: '2026-05-14',
    replacesId: 'b1',
  }, null)
  unmount()

  // A debt with no balance on record still saves.
  render(<DebtForm debt={debt()} me={me} onSave={onSave} onCancel={() => {}} />)
  expect(screen.getByLabelText('Balance')).toHaveValue('')
  await userEvent.click(screen.getByRole('button', { name: 'Save debt' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Car loan' }), null, null)
})

test('kind sets interest defaults', async () => {
  render(<DebtForm me={me} onSave={vi.fn()} onCancel={() => {}} />)
  await userEvent.selectOptions(screen.getByLabelText('Kind'), 'ato')
  expect(screen.getByLabelText('Calculated')).toHaveDisplayValue('Daily')
  expect(screen.getByLabelText('Charged')).toHaveDisplayValue('Monthly')
  expect(screen.getByLabelText('Day')).toHaveValue(1)

  await userEvent.selectOptions(screen.getByLabelText('Kind'), 'hecs')
  expect(screen.getByLabelText('Calculated')).toHaveDisplayValue('On the balance when charged')
  expect(screen.getByLabelText('Charged')).toHaveDisplayValue('Yearly')
  expect(screen.getByLabelText('Date')).toHaveDisplayValue('1')
  expect(screen.getByLabelText('Month')).toHaveDisplayValue('June')
  expect(screen.queryByLabelText('Day')).not.toBeInTheDocument()

  // A loan is charged on the day of its first balance.
  await userEvent.selectOptions(screen.getByLabelText('Kind'), 'loan')
  fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-06-17' } })
  expect(screen.getByLabelText('Day')).toHaveValue(17)
})

test('add sends interest', async () => {
  const onSave = vi.fn()
  render(<DebtForm me={me} onSave={onSave} onCancel={() => {}} />)
  await userEvent.selectOptions(screen.getByLabelText('Kind'), 'ato')
  await userEvent.type(screen.getByLabelText('Name'), 'Tax debt')
  await userEvent.type(screen.getByLabelText('Balance'), '500')
  await userEvent.type(screen.getByLabelText('Interest rate (yearly)'), '11.17')
  await userEvent.click(screen.getByRole('button', { name: 'Add debt' }))
  expect(onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: 'ato',
      rateBp: 1117,
      interest: { calc: 'daily', charge: 'monthly', chargeDay: 1, chargeDate: null },
    }),
  )

  // Switching to yearly sends a date, not a day.
  await userEvent.selectOptions(screen.getByLabelText('Charged'), 'yearly')
  await userEvent.selectOptions(screen.getByLabelText('Month'), 'February')
  await userEvent.selectOptions(screen.getByLabelText('Date'), '29')
  await userEvent.click(screen.getByRole('button', { name: 'Add debt' }))
  expect(onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ interest: { calc: 'daily', charge: 'yearly', chargeDay: null, chargeDate: '02-29' } }),
  )

  // A monthly day outside 1-31 blocks saving.
  await userEvent.selectOptions(screen.getByLabelText('Charged'), 'monthly')
  fireEvent.change(screen.getByLabelText('Day'), { target: { value: '32' } })
  expect(screen.getByText('Pick a day from 1 to 31.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add debt' })).toBeDisabled()
})

test('changing the rate asks from when', async () => {
  const onSave = vi.fn()
  render(<DebtForm debt={debt()} me={me} onSave={onSave} onCancel={() => {}} />)
  expect(screen.getByLabelText('Calculated')).toHaveDisplayValue('On the balance when charged')
  expect(screen.getByLabelText('Day')).toHaveValue(15)
  expect(screen.queryByLabelText('From')).not.toBeInTheDocument()

  // An unchanged rate saves without a rate change.
  await userEvent.click(screen.getByRole('button', { name: 'Save debt' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Car loan' }), null, null)

  await userEvent.clear(screen.getByLabelText('Interest rate (yearly)'))
  await userEvent.type(screen.getByLabelText('Interest rate (yearly)'), '11.17')
  expect(screen.getByLabelText('From')).toHaveValue(todayIso())
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
  await userEvent.click(screen.getByRole('button', { name: 'Save debt' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Car loan' }), null, {
    fromDate: '2026-10-01',
    rateBp: 1117,
  })
  expect(onSave.mock.calls.at(-1)![0]).not.toHaveProperty('rateBp')
  expect(onSave.mock.calls.at(-1)![0]).toHaveProperty('interest', debt().interest)

  // Back to today's rate: nothing to date.
  await userEvent.clear(screen.getByLabelText('Interest rate (yearly)'))
  await userEvent.type(screen.getByLabelText('Interest rate (yearly)'), '6.49')
  expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
})

test('rate history lists and removes', async () => {
  const onRemoveRate = vi.fn()
  const rates = [
    { id: 'r2', fromDate: '2026-09-01', rateBp: 749 },
    { id: 'r1', fromDate: '2026-06-15', rateBp: 649 },
  ]
  const { rerender } = render(
    <DebtForm debt={debt()} rates={rates} onRemoveRate={onRemoveRate} me={me} onSave={vi.fn()} onCancel={() => {}} />,
  )
  const items = screen.getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(items[0]).toHaveTextContent('7.49%')
  expect(items[1]).toHaveTextContent('6.49%')
  const remove = screen.getAllByRole('button', { name: /^Remove/ })
  expect(remove).toHaveLength(2)

  await userEvent.click(remove[0]!)
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
  expect(onRemoveRate).toHaveBeenCalledWith('r2')

  rerender(
    <DebtForm debt={debt()} rates={rates.slice(1)} onRemoveRate={onRemoveRate} me={me} onSave={vi.fn()} onCancel={() => {}} />,
  )
  expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
})

test('debt card shows interest building up', () => {
  const { rerender } = render(<DebtCard debt={debt({ accruingCents: 9_500, nextChargeOn: '2026-11-01' })} />)
  expect(screen.getByText('+$95.00 interest building up · charged 1 Nov 2026')).toBeInTheDocument()
  rerender(<DebtCard debt={debt({ accruingCents: 0 })} />)
  expect(screen.queryByText(/interest building up/)).toBeNull()
})

test('an account fee is optional, and saved with how often and from when', async () => {
  const onSave = vi.fn()
  render(<DebtForm me={me} onSave={onSave} onCancel={() => {}} />)
  await userEvent.type(screen.getByLabelText('Name'), 'Zip')
  await userEvent.type(screen.getByLabelText('Balance'), '100')
  await userEvent.type(screen.getByLabelText('Interest rate (yearly)'), '25.9')
  expect(screen.queryByLabelText('Fee from')).toBeNull()
  await userEvent.type(screen.getByLabelText('Account fee'), '9.95')
  await userEvent.selectOptions(screen.getByLabelText('Fee how often'), 'yearly')
  fireEvent.change(screen.getByLabelText('Fee from'), { target: { value: '2026-10-05' } })
  await userEvent.click(screen.getByRole('button', { name: 'Add debt' }))
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ fee: { amountCents: 995, frequency: 'yearly', from: '2026-10-05' } }),
  )
})

test('editing clears the fee when its amount is emptied', async () => {
  const onSave = vi.fn()
  render(
    <DebtForm
      debt={debt({ fee: { amountCents: 995, frequency: 'monthly', from: '2026-10-05' } })}
      me={me}
      onSave={onSave}
      onCancel={() => {}}
    />,
  )
  expect(screen.getByLabelText('Account fee')).toHaveValue('9.95')
  expect(screen.getByLabelText('Fee from')).toHaveValue('2026-10-05')
  await userEvent.clear(screen.getByLabelText('Account fee'))
  await userEvent.click(screen.getByRole('button', { name: 'Save debt' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fee: null }), null, null)
})
