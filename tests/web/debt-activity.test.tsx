import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { DebtActivityDto } from '../../src/shared/types'
import { AddEntryForm, AddEntryMenu } from '../../src/web/components/debts/AddEntryForm'
import { DebtActivity } from '../../src/web/components/debts/DebtActivity'
import { todayIso } from '../../src/web/components/debts/DebtForm'
import { activityLabel } from '../../src/web/components/debts/format'

const interest = (over: Partial<Extract<DebtActivityDto, { kind: 'interest' }>> = {}): DebtActivityDto => ({
  key: 'interest:2026-10-01',
  kind: 'interest',
  date: '2026-10-01',
  chargeDate: '2026-10-01',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  calculatedCents: 11_706,
  edited: false,
  amountCents: 11_706,
  balanceAfterCents: 861_706,
  ...over,
})

const ROWS: DebtActivityDto[] = [
  interest(),
  {
    key: 'repayment:t1',
    kind: 'repayment',
    date: '2026-09-28',
    transactionId: 't1',
    description: 'ACME CAR FINANCE',
    oneOff: true,
    amountCents: -45_000,
    balanceAfterCents: 750_000,
  },
  { key: 'assumed:2026-09-20', kind: 'assumed', date: '2026-09-20', amountCents: -45_000, balanceAfterCents: 795_000 },
  {
    key: 'entry:e1',
    kind: 'added',
    date: '2026-09-15',
    entryId: 'e1',
    note: null,
    amountCents: 20_000,
    balanceAfterCents: 840_000,
  },
  {
    key: 'entry:e2',
    kind: 'payment',
    date: '2026-09-10',
    entryId: 'e2',
    note: 'Cash from mum',
    amountCents: -10_000,
    balanceAfterCents: 820_000,
  },
  {
    key: 'check:b2',
    kind: 'check',
    date: '2026-09-05',
    balanceId: 'b2',
    correctionCents: 4_210,
    amountCents: 4_210,
    balanceAfterCents: 830_000,
  },
  {
    key: 'rate:r2',
    kind: 'rate',
    date: '2026-08-01',
    rateId: 'r2',
    rateBp: 700,
    amountCents: 0,
    balanceAfterCents: 825_790,
  },
  {
    key: 'rate:r1',
    kind: 'rate',
    date: '2026-06-15',
    rateId: 'r1',
    rateBp: 649,
    amountCents: 0,
    balanceAfterCents: 1_000_000,
  },
]

const handlers = () => ({
  onEditInterest: vi.fn(),
  onSaveEntry: vi.fn(),
  onDeleteEntry: vi.fn(),
  onRemoveCheck: vi.fn(),
  onRemoveRate: vi.fn(),
  onNotRepayment: vi.fn(),
})

const renderActivity = (rows = ROWS, over: Partial<Parameters<typeof DebtActivity>[0]> = {}) => {
  const h = handlers()
  render(<DebtActivity rows={rows} charge="monthly" canEdit canRemoveCheck canRemoveRate {...h} {...over} />)
  return h
}

test('labels and amounts', () => {
  renderActivity()
  for (const name of ['Date', 'Description', 'Amount', 'Balance']) {
    expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
  }
  expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1)
  expect(screen.getByText('Interest 1 Sep – 30 Sep')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit interest for 1 Sep – 30 Sep' })).toHaveTextContent(
    '+$117.06',
  )
  expect(screen.getByRole('link', { name: 'ACME CAR FINANCE' })).toHaveAttribute(
    'href',
    '/transactions?q=ACME%20CAR%20FINANCE',
  )
  expect(screen.getByText('One-off')).toBeInTheDocument()
  expect(screen.getByText('Usual repayment (assumed)')).toBeInTheDocument()
  expect(screen.getByText('Added to debt')).toBeInTheDocument()
  expect(screen.getByText('Cash from mum')).toBeInTheDocument()
  expect(screen.getByText('Balance check')).toBeInTheDocument()
  expect(screen.getByText('+$42.10 vs calculated')).toBeInTheDocument()
  expect(screen.getByText('Rate changed to 7%')).toBeInTheDocument()
  expect(screen.getByText('Rate 6.49%')).toBeInTheDocument()
  expect(screen.getByText('+$200.00')).toBeInTheDocument()
  expect(screen.getByText('−$100.00')).toBeInTheDocument()
})

test('labels follow how interest is charged', () => {
  expect(activityLabel(interest(), 'monthly')).toBe('Interest 1 Sep – 30 Sep')
  expect(activityLabel(interest(), 'daily')).toBe('Interest Sep 2026')
  expect(activityLabel(ROWS[6]!, 'monthly')).toBe('Rate changed to 7%')
  expect(activityLabel(ROWS[7]!, 'monthly', true)).toBe('Rate 6.49%')
})

test('row actions', async () => {
  const h = renderActivity()
  await userEvent.click(screen.getByRole('button', { name: 'Not a repayment' }))
  expect(h.onNotRepayment).toHaveBeenCalledWith('t1')
  await userEvent.click(screen.getByRole('button', { name: /^Delete Cash from mum/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(h.onDeleteEntry).toHaveBeenCalledWith('e2')
  await userEvent.click(screen.getByRole('button', { name: /^Remove balance check/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(h.onRemoveCheck).toHaveBeenCalledWith('b2')
  await userEvent.click(screen.getAllByRole('button', { name: /^Remove rate/ })[0]!)
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(h.onRemoveRate).toHaveBeenCalledWith('r2')
})

test('editing an entry opens its form inline, in the table', async () => {
  const h = renderActivity()
  await userEvent.click(screen.getByRole('button', { name: /^Edit Cash from mum/ }))
  const table = screen.getByRole('table')
  const amount = within(table).getByLabelText('Amount')
  expect(amount).toHaveValue('100.00')
  expect(within(table).getByLabelText('Note')).toHaveValue('Cash from mum')
  // The row's own content is replaced by the form.
  expect(within(table).queryByRole('button', { name: /^Delete Cash from mum/ })).toBeNull()
  await userEvent.clear(amount)
  await userEvent.type(amount, '120')
  await userEvent.click(within(table).getByRole('button', { name: 'Save' }))
  expect(h.onSaveEntry).toHaveBeenCalledWith('e2', {
    kind: 'payment',
    date: '2026-09-10',
    amountCents: 12_000,
    note: 'Cash from mum',
  })
  expect(within(table).queryByLabelText('Amount')).toBeNull()
})

test('a failed save keeps the inline form open', async () => {
  const onSaveEntry = vi.fn().mockRejectedValue(new Error('nope'))
  renderActivity(ROWS, { onSaveEntry })
  await userEvent.click(screen.getByRole('button', { name: /^Edit Added to debt/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSaveEntry).toHaveBeenCalled()
  expect(screen.getByLabelText('Amount')).toBeInTheDocument()
})

test('cancelling an inline edit restores the row', async () => {
  renderActivity()
  await userEvent.click(screen.getByRole('button', { name: /^Edit Added to debt/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('Added to debt')).toBeInTheDocument()
  expect(screen.queryByLabelText('Amount')).toBeNull()
})

test('check rows show the correction once, with no amount', () => {
  renderActivity()
  const row = screen.getByText('Balance check').closest('tr')!
  const cells = within(row).getAllByRole('cell')
  expect(cells[2]).toBeEmptyDOMElement()
  expect(within(row).getAllByText(/\$42\.10/)).toHaveLength(1)
})

test('read-only users get no actions', () => {
  renderActivity(ROWS, { canEdit: false })
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByText('+$117.06')).toBeInTheDocument()
})

test('the only check or rate has no remove button', () => {
  renderActivity(ROWS, { canRemoveCheck: false, canRemoveRate: false })
  expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
})

test('edit interest inline', async () => {
  const h = renderActivity()
  await userEvent.click(screen.getByRole('button', { name: 'Edit interest for 1 Sep – 30 Sep' }))
  const input = screen.getByLabelText('Interest for 1 Sep – 30 Sep')
  await userEvent.clear(input)
  await userEvent.type(input, '0')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(h.onEditInterest).toHaveBeenCalledWith('2026-10-01', 0)
  expect(screen.queryByLabelText('Interest for 1 Sep – 30 Sep')).toBeNull()
})

test('cancel leaves the interest alone', async () => {
  const h = renderActivity()
  await userEvent.click(screen.getByRole('button', { name: 'Edit interest for 1 Sep – 30 Sep' }))
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(h.onEditInterest).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Edit interest for 1 Sep – 30 Sep' })).toBeInTheDocument()
})

// jsdom has no layout, so the phone-width placement of the editor (its own full-width line) can't be asserted here.
test('the interest editor opens in the row with the current amount, and focus returns when it closes', async () => {
  renderActivity()
  const open = screen.getByRole('button', { name: 'Edit interest for 1 Sep – 30 Sep' })
  await userEvent.click(open)
  const input = screen.getByLabelText('Interest for 1 Sep – 30 Sep')
  expect(input).toHaveValue('117.06')
  expect(input.closest('tr')).toHaveTextContent('Interest 1 Sep – 30 Sep')
  expect(input).toHaveFocus()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('button', { name: 'Edit interest for 1 Sep – 30 Sep' })).toHaveFocus()
})

test('focus returns to Edit when an inline entry edit is cancelled', async () => {
  renderActivity()
  await userEvent.click(screen.getByRole('button', { name: /^Edit Added to debt/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('button', { name: /^Edit Added to debt/ })).toHaveFocus()
})

test('an edited interest row can be reset', async () => {
  const h = renderActivity([interest({ edited: true, amountCents: 0 })])
  expect(screen.getByText('Edited')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(h.onEditInterest).toHaveBeenCalledWith('2026-10-01', null)
})

test('show all', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ ...ROWS[2]!, key: `assumed:${i}` })) as DebtActivityDto[]
  renderActivity(many)
  expect(screen.getAllByRole('row')).toHaveLength(51)
  await userEvent.click(screen.getByRole('button', { name: 'Show all' }))
  expect(screen.getAllByRole('row')).toHaveLength(61)
  expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull()
})

test('no activity yet', () => {
  renderActivity([])
  expect(screen.getByText('No activity yet.')).toBeInTheDocument()
})

test('Add… offers each kind', async () => {
  const onPick = vi.fn()
  render(<AddEntryMenu onPick={onPick} />)
  await userEvent.click(screen.getByRole('button', { name: 'Add…' }))
  expect(screen.getByRole('menuitem', { name: 'Added to debt' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Rate change' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('menuitem', { name: 'Payment outside Up' }))
  expect(onPick).toHaveBeenCalledWith('payment')
})

test('Added to debt saves an entry', async () => {
  const onSave = vi.fn()
  render(<AddEntryForm kind="added" onSave={onSave} onCancel={() => {}} />)
  expect(screen.getByLabelText('Date')).toHaveValue(todayIso())
  await userEvent.type(screen.getByLabelText('Amount'), '4500')
  await userEvent.type(screen.getByLabelText('Note'), 'Tax return')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith({ kind: 'added', date: todayIso(), amountCents: 450_000, note: 'Tax return' })
})

test('Payment outside Up saves with no note as null', async () => {
  const onSave = vi.fn()
  render(<AddEntryForm kind="payment" onSave={onSave} onCancel={() => {}} />)
  await userEvent.type(screen.getByLabelText('Amount'), '100')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith({ kind: 'payment', date: todayIso(), amountCents: 10_000, note: null })
})

test('Rate change saves a rate from a date', async () => {
  const onSave = vi.fn()
  render(<AddEntryForm kind="rate" onSave={onSave} onCancel={() => {}} />)
  expect(screen.queryByLabelText('Note')).toBeNull()
  await userEvent.type(screen.getByLabelText('Rate'), '7.25')
  const date = screen.getByLabelText('Date')
  await userEvent.clear(date)
  await userEvent.type(date, '2027-01-01')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith({ kind: 'rate', fromDate: '2027-01-01', rateBp: 725 })
})

test('the form needs an amount, and an edit starts from the entry', async () => {
  const onSave = vi.fn()
  const { rerender } = render(<AddEntryForm kind="added" onSave={onSave} onCancel={() => {}} />)
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  rerender(
    <AddEntryForm
      key="edit"
      kind="payment"
      initial={{ date: '2026-09-10', amountCents: 10_050, note: 'Cash' }}
      onSave={onSave}
      onCancel={() => {}}
    />,
  )
  expect(screen.getByLabelText('Amount')).toHaveValue('100.50')
  expect(screen.getByLabelText('Note')).toHaveValue('Cash')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith({ kind: 'payment', date: '2026-09-10', amountCents: 10_050, note: 'Cash' })
})

test('a charge dated in the future is plain text, not editable', () => {
  renderActivity([interest({ date: '2999-12-31', chargeDate: '2999-12-31', periodEnd: '2999-12-15' })])
  expect(screen.queryByRole('button', { name: /^Edit interest/ })).toBeNull()
  expect(screen.getByText('+$117.06')).toBeInTheDocument()
})

test('a charge dated today is editable', () => {
  renderActivity([interest({ date: todayIso(), chargeDate: todayIso() })])
  expect(screen.getByRole('button', { name: /^Edit interest/ })).toBeInTheDocument()
})

test('Add… leaves out Rate change for a debt that charges no interest', async () => {
  render(<AddEntryMenu allowRate={false} onPick={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Add…' }))
  expect(screen.getByRole('menuitem', { name: 'Added to debt' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'Rate change' })).toBeNull()
})
