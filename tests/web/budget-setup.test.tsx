import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type {
  AccountDto,
  BudgetDto,
  CategoryDto,
  LineStatusDto,
  PayCandidateDto,
  PayEventDto,
  PayScheduleDto,
  TransactionDto,
  UserDto,
} from '../../src/shared/types'
import { SetupWizard } from '../../src/web/components/budgets/SetupWizard'
import { ThisPeriodCard } from '../../src/web/components/overview/ThisPeriodCard'
import { PayCard } from '../../src/web/components/settings/PayCard'
import { TransactionDetail } from '../../src/web/components/transactions/TransactionDrawer'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { canMarkAsPay } from '../../src/web/lib/pay'

const tx = (over: Partial<TransactionDto> = {}): TransactionDto =>
  ({
    id: 't1',
    accountId: 'acc-1',
    accountName: 'Spending',
    status: 'SETTLED',
    amountCents: 400000,
    currency: 'AUD',
    foreignAmountCents: null,
    foreignCurrency: null,
    description: 'ACME PAY',
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
    transactionType: null,
    createdAt: '2026-10-29T22:00:00.000Z',
    settledAt: null,
    deletedAt: null,
    tags: [],
    ...over,
  }) as TransactionDto

const account = (over: Partial<AccountDto> = {}): AccountDto => ({
  id: 'acc-1',
  displayName: 'Spending',
  accountType: 'TRANSACTIONAL',
  ownership: 'INDIVIDUAL',
  ownerUserId: 'u1',
  ownerName: 'Owner',
  balanceCents: 0,
  currency: 'AUD',
  colorIndex: 0,
  ...over,
})
const saver = (id: string, name: string, over: Partial<AccountDto> = {}) =>
  account({ id, displayName: name, accountType: 'SAVER', ...over })

const budget = (over: Partial<BudgetDto> = {}): BudgetDto => ({
  id: 'b1',
  kind: 'personal',
  ownerUserId: 'u1',
  name: 'Mine',
  anchorUserId: null,
  hasPeriods: false,
  canEdit: true,
  setup: 'needs-pay',
  ...over,
})
const users: UserDto[] = [
  { id: 'u1', username: 'owner', displayName: 'Owner', upDisplayName: null, negativeStyle: 'minus', accent: 'amber', sharingLevel: 'full', connectUpAnswered: true, gettingStartedHidden: true },
  { id: 'u2', username: 'partner', displayName: 'Partner', upDisplayName: null, negativeStyle: 'minus', accent: 'amber', sharingLevel: 'full', connectUpAnswered: true, gettingStartedHidden: true },
]
const categories: CategoryDto[] = [
  { id: 'home', name: 'Home', parentId: null, colorToken: 'cat-blue' },
  { id: 'groceries', name: 'Groceries', parentId: 'home', colorToken: 'cat-blue' },
]
const candidates: PayCandidateDto[] = [
  { transaction: tx({ id: 'pay', description: 'ACME PAY' }), sameDescriptionCount: 5 },
  { transaction: tx({ id: 'tax', description: 'Tax refund', amountCents: 900000 }), sameDescriptionCount: 1 },
]

const wizard = (over: Partial<Parameters<typeof SetupWizard>[0]> = {}) => {
  const props = {
    budget: budget(),
    users,
    candidates,
    savers: [saver('s1', 'Rent'), saver('s2', 'Food')],
    categories,
    proposal: null,
    onMarkPay: vi.fn().mockResolvedValue({ count: 8, since: '2026-01-01' }),
    onSetAnchor: vi.fn().mockResolvedValue(undefined),
    onCreateLines: vi.fn().mockResolvedValue(undefined),
    onSavePlan: vi.fn().mockResolvedValue(undefined),
    onDone: vi.fn(),
    ...over,
  }
  render(<SetupWizard {...props} />)
  return props
}

test('wizard step 1: pick the recurring deposit', async () => {
  const props = wizard()
  const options = screen.getAllByRole('button', { name: /This is my pay/ })
  expect(options[0]).toHaveAccessibleName(/ACME PAY/)
  await userEvent.click(options[0])
  expect(props.onMarkPay).toHaveBeenCalledWith('pay')
  expect(await screen.findByText('Found 8 paydays since Jan 2026')).toBeInTheDocument()
})

test('wizard step 2: Savers default to Saving, can become Spending, can be skipped', async () => {
  const props = wizard()
  await userEvent.click(screen.getAllByRole('button', { name: /This is my pay/ })[0])
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))

  expect(screen.getByLabelText('Kind for Rent')).toHaveValue('fund')
  expect(screen.getAllByRole('option', { name: 'Saving' }).length).toBeGreaterThan(0)
  expect(screen.queryByRole('option', { name: 'Fund' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Category for Rent')).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Kind for Food'), 'spending')
  expect(screen.getByLabelText('Category for Food')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Category for Food'), 'groceries')
  await userEvent.type(screen.getByLabelText('Amount for Food'), '600')
  await userEvent.type(screen.getByLabelText('Amount for Rent'), '800')

  await userEvent.click(screen.getByRole('button', { name: 'Add a spending bucket' }))
  await userEvent.type(screen.getByLabelText('Name for new bucket'), 'Fuel')
  await userEvent.click(screen.getByRole('button', { name: 'Skip Fuel' }))
  await userEvent.click(screen.getByRole('button', { name: 'Create buckets' }))
  expect(props.onCreateLines).toHaveBeenCalledWith([
    { kind: 'fund', name: 'Rent', amountCents: 80000, categoryIds: [], saverAccountId: 's1' },
    { kind: 'spending', name: 'Food', amountCents: 60000, categoryIds: ['groceries'], saverAccountId: 's2' },
  ])
})

test('wizard step 2: Savers that load after the wizard opens are listed, and keep what was typed', async () => {
  const props = {
    budget: budget(),
    users,
    candidates,
    categories,
    proposal: null,
    onMarkPay: vi.fn().mockResolvedValue({ count: 8, since: '2026-01-01' }),
    onSetAnchor: vi.fn().mockResolvedValue(undefined),
    onCreateLines: vi.fn().mockResolvedValue(undefined),
    onSavePlan: vi.fn().mockResolvedValue(undefined),
    onDone: vi.fn(),
  }
  const { rerender } = render(<SetupWizard {...props} savers={[]} />)
  await userEvent.click(screen.getAllByRole('button', { name: /This is my pay/ })[0])
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))

  rerender(<SetupWizard {...props} savers={[saver('s1', 'Rent')]} />)
  await userEvent.type(screen.getByLabelText('Amount for Rent'), '800')
  rerender(<SetupWizard {...props} savers={[saver('s1', 'Rent'), saver('s2', 'Food')]} />)

  expect(screen.getByLabelText('Amount for Rent')).toHaveValue('800')
  expect(screen.getByLabelText('Amount for Food')).toBeInTheDocument()
})

test('wizard step 2: says what Create buckets needs while it is disabled', async () => {
  wizard()
  await userEvent.click(screen.getAllByRole('button', { name: /This is my pay/ })[0])
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))

  const hint = 'A bucket needs a name and an amount before it can be created.'
  expect(screen.getByRole('button', { name: 'Create buckets' })).toBeDisabled()
  expect(screen.getByText(hint)).toBeInTheDocument()

  await userEvent.type(screen.getByLabelText('Amount for Rent'), '800')
  expect(screen.getByRole('button', { name: 'Create buckets' })).toBeEnabled()
  expect(screen.queryByText(hint)).not.toBeInTheDocument()
})

test('wizard step 3: save the proposed plan or skip', async () => {
  const props = wizard({
    proposal: {
      expectedIncomeCents: 400000,
      items: [{ targetKind: 'saver', lineId: null, saverAccountId: 's1', amountCents: 80000, targetName: 'Rent' }],
    },
  })
  await userEvent.click(screen.getAllByRole('button', { name: /This is my pay/ })[0])
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))
  await userEvent.click(screen.getByRole('button', { name: 'Skip this step' }))
  expect(screen.getByText('Rent')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Save as my plan' }))
  expect(props.onSavePlan).toHaveBeenCalledWith({
    expectedIncomeCents: 400000,
    items: [{ targetKind: 'saver', lineId: null, saverAccountId: 's1', amountCents: 80000 }],
  })
})

test('joint wizard follows the anchor and has no pay step', async () => {
  const props = wizard({
    budget: budget({ kind: 'joint', ownerUserId: null, name: 'Joint', anchorUserId: 'u1' }),
    savers: [saver('j1', 'Bills', { ownership: 'JOINT', ownerUserId: null })],
  })
  expect(screen.getByText("Joint budgets follow Owner's paydays")).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /This is my pay/ })).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Joint budgets follow'), 'u2')
  expect(props.onSetAnchor).toHaveBeenCalledWith('u2')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByLabelText('Kind for Bills')).toHaveValue('fund')
})

test('partner not connected shows a message instead of the wizard', () => {
  wizard({ budget: budget({ ownerUserId: 'u2', name: 'Partner', canEdit: false, setup: 'partner-not-connected' }) })
  expect(screen.getByText("Partner hasn't connected Up yet")).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /This is my pay/ })).not.toBeInTheDocument()
})

const schedule: PayScheduleDto = {
  userId: 'u1',
  accountId: 'acc-1',
  accountName: 'Spending',
  accountMissing: false,
  descriptionMatch: 'acme pay',
  minAmountCents: 200000,
  frequencyDays: 14,
}
const events: PayEventDto[] = [
  { payDate: '2026-10-30', source: 'scheduled', transactionId: null, amountCents: null, extraCents: 0, payNotSeen: true },
  { payDate: '2026-10-16', source: 'detected', transactionId: 'p1', amountCents: 400000, extraCents: 0, payNotSeen: false },
]

test('pay card', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onUndo = vi.fn()
  const onNotMyPay = vi.fn()
  const { rerender } = render(
    <PayCard
      schedule={schedule}
      events={events}
      exclusions={[tx({ id: 'x1', description: 'ACME PAY BONUS' })]}
      onSave={onSave}
      onUndo={onUndo}
      onNotMyPay={onNotMyPay}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByLabelText('Pay description')).toHaveValue('acme pay')
  expect(screen.getByLabelText('Minimum amount')).toHaveValue('2000.00')
  const [placeholder, detected] = screen.getAllByRole('listitem').slice(0, 2)
  expect(within(placeholder).getByText('Pay not seen')).toBeInTheDocument()
  expect(within(placeholder).queryByRole('button', { name: 'Not my pay' })).not.toBeInTheDocument()
  await userEvent.click(within(detected).getByRole('button', { name: 'Not my pay' }))
  expect(onNotMyPay).toHaveBeenCalledWith('2026-10-16')
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(onUndo).toHaveBeenCalledWith('x1')

  await userEvent.clear(screen.getByLabelText('Minimum amount'))
  await userEvent.type(screen.getByLabelText('Minimum amount'), '2500')
  await userEvent.click(screen.getByRole('button', { name: 'Save pay settings' }))
  expect(onSave).toHaveBeenCalledWith({ descriptionMatch: 'acme pay', minAmountCents: 250000 })

  rerender(
    <PayCard
      schedule={{ ...schedule, accountMissing: true, accountName: null }}
      events={[]}
      exclusions={[]}
      onSave={onSave}
      onUndo={onUndo}
      onNotMyPay={onNotMyPay}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByText('Account not found')).toBeInTheDocument()
})

test('"This is my pay" only for your own positive non-transfer individual deposits', () => {
  const accounts = [account(), account({ id: 'joint', ownership: 'JOINT', ownerUserId: null })]
  expect(canMarkAsPay(tx(), accounts, 'u1')).toBe(true)
  expect(canMarkAsPay(tx({ amountCents: -500 }), accounts, 'u1')).toBe(false)
  expect(canMarkAsPay(tx({ isTransfer: true }), accounts, 'u1')).toBe(false)
  expect(canMarkAsPay(tx({ accountId: 'joint' }), accounts, 'u1')).toBe(false)
  expect(canMarkAsPay(tx(), accounts, 'u2')).toBe(false)
})

const detail = (props: Partial<Parameters<typeof TransactionDetail>[0]>) =>
  render(
    <ToastProvider>
      <TransactionDetail
        tx={tx()}
        categories={categories}
        allTags={[]}
        spentBy={null}
        onCategory={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        {...props}
      />
    </ToastProvider>,
  )

test('drawer: This is my pay and the Budget row', async () => {
  const onMarkPay = vi.fn()
  detail({ pay: { hasSchedule: false, onMark: onMarkPay }, budgetLine: { budgetName: 'Joint', lineName: 'Groceries' } })
  expect(screen.getByText('Joint · Groceries')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'This is my pay' }))
  expect(onMarkPay).toHaveBeenCalledOnce()
})

test('drawer: replacing a schedule asks first; unbudgeted spending says so', async () => {
  const onMarkPay = vi.fn()
  detail({ pay: { hasSchedule: true, onMark: onMarkPay }, budgetLine: { budgetName: 'Mine', lineName: null } })
  expect(screen.getByText('Other spending')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'This is my pay' }))
  expect(onMarkPay).not.toHaveBeenCalled()
  expect(await screen.findByText('Replace your pay schedule?')).toBeInTheDocument()
})

const line = (name: string, spentRatio: number, kind: LineStatusDto['kind'] = 'spending'): LineStatusDto => ({
  lineId: name,
  kind,
  name,
  amountCents: 10000,
  categoryIds: [],
  colorToken: 'cat-blue',
  saverAccountId: null,
  saverName: null,
  saverBalanceCents: null,
  saverMissing: false,
  spentCents: Math.round(spentRatio * 10000),
  remainingCents: 10000 - Math.round(spentRatio * 10000),
  spentRatio: kind === 'spending' ? spentRatio : null,
  state: spentRatio > 1 ? 'over' : spentRatio >= 0.85 ? 'warning' : 'ok',
  coverage: null,
  contributedCents: null,
  withdrawnCents: null,
  contribution: null,
  goal: null,
})

test('overview card shows the three most-spent lines', () => {
  const { container, rerender } = render(
    <ThisPeriodCard
      items={[
        { budgetName: 'Mine', line: line('Fuel', 0.2) },
        { budgetName: 'Joint', line: line('Groceries', 0.9) },
        { budgetName: 'Mine', line: line('Fun', 1.2) },
        { budgetName: 'Joint', line: line('Rent', 5, 'fund') },
        { budgetName: 'Mine', line: line('Coffee', 0.5) },
      ]}
    />,
  )
  const names = screen.getAllByTestId('period-line-name').map((n) => n.textContent)
  expect(names).toEqual(['Fun', 'Groceries', 'Coffee'])
  expect(screen.getByText('Joint')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View budgets ›' })).toHaveAttribute('href', '/budgets')
  rerender(<ThisPeriodCard items={[]} />)
  expect(container).toBeEmptyDOMElement()
})

test('joint wizard ends by pointing at the anchor when their pay is not marked yet', async () => {
  const props = wizard({
    budget: budget({ kind: 'joint', ownerUserId: null, name: 'Joint', anchorUserId: 'u1' }),
    savers: [saver('j1', 'Bills', { ownership: 'JOINT', ownerUserId: null })],
  })
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await userEvent.click(screen.getByRole('button', { name: 'Skip this step' }))
  expect(screen.getByText("Joint periods start once Owner's pay is marked on their budget tab.")).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Create buckets' })).not.toBeInTheDocument()
  expect(props.onDone).toHaveBeenCalledOnce()
})

test('joint anchored to a partner without Up keeps the anchor picker', async () => {
  const props = wizard({
    budget: budget({ kind: 'joint', ownerUserId: null, name: 'Joint', anchorUserId: 'u2', setup: 'partner-not-connected' }),
  })
  expect(screen.getByText("Partner hasn't connected Up yet")).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Joint budgets follow'), 'u1')
  expect(props.onSetAnchor).toHaveBeenCalledWith('u1')
})
