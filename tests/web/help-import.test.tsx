import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { HelpImportSummaryDto, UserDto } from '../../src/shared/types'
import { DebtForm } from '../../src/web/components/debts/DebtForm'
import { HelpImportCard } from '../../src/web/components/debts/HelpImport'
import { ApiError } from '../../src/web/lib/api'

const SUMMARY: HelpImportSummaryDto = {
  rows: 63,
  from: '2015-01-01',
  to: '2026-10-29',
  added: { count: 40, cents: 9_556_162 },
  credits: { count: 7, cents: 4_777_975 },
  indexationYears: 11,
  closingCents: 6_106_379,
  replayCents: 6_106_379,
  replaces: { balances: 1, rates: 1, entries: 0, edits: 0 },
}

const file = (text = 'csv text') => new File([text], 'Accounts.csv', { type: 'text/csv' })

function setup(over: Partial<Parameters<typeof HelpImportCard>[0]> = {}) {
  const props = {
    debtName: 'Hecs',
    onPreview: vi.fn().mockResolvedValue(SUMMARY),
    onImport: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    ...over,
  }
  render(<HelpImportCard {...props} />)
  return props
}

test('choosing a file previews it', async () => {
  const props = setup()
  expect(screen.getByRole('button', { name: 'Replace history' })).toBeDisabled()
  await userEvent.upload(screen.getByLabelText('ATO HELP statement (CSV)'), file('a,b'))
  expect(props.onPreview).toHaveBeenCalledWith('a,b')
  expect(screen.getByText('Accounts.csv')).toBeVisible()
  expect(await screen.findByText('63 rows from 1 Jan 2015 to 29 Oct 2026')).toBeVisible()
  expect(screen.getByText('40 added · $95,561.62')).toBeVisible()
  expect(screen.getByText('7 credits · $47,779.75')).toBeVisible()
  expect(screen.getByText('11 years of indexation')).toBeVisible()
  expect(screen.getByText('Ends at $61,063.79, matching the statement.')).toBeVisible()
  expect(
    screen.getByText("This replaces Hecs's 1 balance, 1 rate, 0 entries and 0 interest edits."),
  ).toBeVisible()
})

test('a replay that differs warns before importing', async () => {
  setup({ onPreview: vi.fn().mockResolvedValue({ ...SUMMARY, replayCents: 6_000_000 }) })
  await userEvent.upload(screen.getByLabelText('ATO HELP statement (CSV)'), file())
  expect(
    await screen.findByText(
      'Upkeep reaches $60,000.00 but the statement says $61,063.79. Check the file before importing.',
    ),
  ).toBeVisible()
})

test('Replace history imports the previewed file', async () => {
  const props = setup()
  await userEvent.upload(screen.getByLabelText('ATO HELP statement (CSV)'), file('rows'))
  await screen.findByText('63 rows from 1 Jan 2015 to 29 Oct 2026')
  await userEvent.click(screen.getByRole('button', { name: 'Replace history' }))
  expect(props.onImport).toHaveBeenCalledWith('rows')
})

test('a preview error shows in the card', async () => {
  setup({ onPreview: vi.fn().mockRejectedValue(new ApiError(400, "That isn't an ATO HELP statement.")) })
  await userEvent.upload(screen.getByLabelText('ATO HELP statement (CSV)'), file())
  expect(await screen.findByText("That isn't an ATO HELP statement.")).toBeVisible()
  expect(screen.getByRole('button', { name: 'Replace history' })).toBeDisabled()
})

test('Cancel closes the card', async () => {
  const props = setup()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(props.onCancel).toHaveBeenCalled()
})

test('the same file picked again previews again, and one row reads as one row', async () => {
  const props = setup({ onPreview: vi.fn().mockResolvedValue({ ...SUMMARY, rows: 1 }) })
  const input = screen.getByLabelText('ATO HELP statement (CSV)')
  const same = file('one')
  await userEvent.upload(input, same)
  expect(await screen.findByText('1 row from 1 Jan 2015 to 29 Oct 2026')).toBeVisible()
  await userEvent.upload(input, same)
  await vi.waitFor(() => expect(props.onPreview).toHaveBeenCalledTimes(2))
})

test('an error is announced, and a file over 500 KB is refused without reading it', async () => {
  const props = setup()
  await userEvent.upload(screen.getByLabelText('ATO HELP statement (CSV)'), file('x'.repeat(500_001)))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'That file is too big for an ATO HELP statement.',
  )
  expect(props.onPreview).not.toHaveBeenCalled()
})

test('only the latest pick is previewed', async () => {
  let resolveFirst: (s: HelpImportSummaryDto) => void = () => {}
  const onPreview = vi
    .fn()
    .mockImplementationOnce(() => new Promise<HelpImportSummaryDto>((r) => (resolveFirst = r)))
    .mockResolvedValueOnce({ ...SUMMARY, rows: 2 })
  setup({ onPreview })
  const input = screen.getByLabelText('ATO HELP statement (CSV)')
  expect(screen.queryByText('Reading the statement…')).toBeNull()
  await userEvent.upload(input, file('first'))
  expect(screen.getByText('Reading the statement…')).toBeVisible()
  await userEvent.upload(input, file('second'))
  expect(await screen.findByText(/^2 rows from/)).toBeVisible()
  resolveFirst(SUMMARY)
  await new Promise((r) => setTimeout(r, 0))
  expect(screen.queryByText(/^63 rows from/)).toBeNull()
})

const me = { id: 'u1', username: 'owner', displayName: 'Owner', negativeStyle: 'minus' } as UserDto

function addForm() {
  const props = {
    onSave: vi.fn(),
    onPreviewStatement: vi.fn().mockResolvedValue(SUMMARY),
    onSaveStatement: vi.fn().mockResolvedValue(undefined),
  }
  render(<DebtForm me={me} {...props} onCancel={() => {}} />)
  return props
}

test('a new HECS debt starts from a statement instead of a balance', async () => {
  const props = addForm()
  expect(screen.queryByLabelText('ATO HELP statement (CSV)')).toBeNull()
  await userEvent.selectOptions(screen.getByLabelText('Kind'), 'hecs')
  expect(screen.getByLabelText('ATO statement')).toBeChecked()
  expect(screen.queryByLabelText('Balance')).toBeNull()
  expect(screen.queryByLabelText('As of')).toBeNull()
  await userEvent.type(screen.getByLabelText('Name'), 'Hecs')
  expect(screen.getByRole('button', { name: 'Add debt' })).toBeDisabled()

  await userEvent.upload(screen.getByLabelText('ATO HELP statement (CSV)'), file('rows'))
  expect(await screen.findByText('Ends at $61,063.79, matching the statement.')).toBeVisible()
  // Nothing to replace yet, and the statement gives the rate.
  expect(screen.queryByText(/^This replaces/)).toBeNull()
  expect(screen.queryByLabelText('Indexation rate (yearly)')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Add debt' }))
  expect(props.onSaveStatement).toHaveBeenCalledWith({
    name: 'Hecs',
    ownerUserId: 'u1',
    repaymentCents: 0,
    repaymentFrequency: 'monthly',
    rateBp: 0,
    csv: 'rows',
  })
  expect(props.onSave).not.toHaveBeenCalled()
})

test('a statement without indexation asks for the rate', async () => {
  const props = addForm()
  props.onPreviewStatement.mockResolvedValue({ ...SUMMARY, indexationYears: 0 })
  await userEvent.selectOptions(screen.getByLabelText('Kind'), 'hecs')
  await userEvent.type(screen.getByLabelText('Name'), 'Hecs')
  await userEvent.upload(screen.getByLabelText('ATO HELP statement (CSV)'), file('rows'))
  const rate = await screen.findByLabelText('Indexation rate (yearly)')
  expect(screen.getByRole('button', { name: 'Add debt' })).toBeDisabled()
  await userEvent.type(rate, '3.2')
  await userEvent.click(screen.getByRole('button', { name: 'Add debt' }))
  expect(props.onSaveStatement).toHaveBeenCalledWith(expect.objectContaining({ rateBp: 320 }))
})

test('a new HECS debt can still start from a balance', async () => {
  const props = addForm()
  await userEvent.selectOptions(screen.getByLabelText('Kind'), 'hecs')
  await userEvent.click(screen.getByLabelText('A balance'))
  expect(screen.queryByLabelText('ATO HELP statement (CSV)')).toBeNull()
  await userEvent.type(screen.getByLabelText('Name'), 'Hecs')
  await userEvent.type(screen.getByLabelText('Balance'), '100')
  await userEvent.type(screen.getByLabelText('Indexation rate (yearly)'), '3')
  await userEvent.click(screen.getByRole('button', { name: 'Add debt' }))
  expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: 'hecs', balanceCents: 10_000 }))
  expect(props.onSaveStatement).not.toHaveBeenCalled()
})
