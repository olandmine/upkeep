import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { BudgetDto, PayChangesInput, StandardPayDto } from '../../src/shared/types'
import { PayPage } from '../../src/web/components/budgets/PayPage'
import { PayPills } from '../../src/web/components/budgets/PayPills'
import { PeriodHeader } from '../../src/web/components/budgets/PeriodHeader'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { ApiError } from '../../src/web/lib/api'
import { account, example, line, period, plan, saverItem } from './pay-fixtures'

const budget: BudgetDto = {
  id: 'b1',
  kind: 'personal',
  ownerUserId: 'u1',
  name: 'Mine',
  anchorUserId: null,
  hasPeriods: true,
  canEdit: true,
  setup: 'ready',
}

type Input = ReturnType<typeof example>
type Props = Parameters<typeof PayPage>[0]

const none = (over: Partial<PayChangesInput> = {}): PayChangesInput => ({
  payDate: '2026-10-30',
  applyTo: 'every-pay',
  savers: { set: [], remove: [] },
  limits: [],
  lines: { create: [], update: [], archive: [] },
  ...over,
})

function element(over: Partial<Input> = {}, props: Partial<Props> = {}) {
  const input = { ...example(), ...over }
  return (
    <ToastProvider>
      <PayPage
        plan={input.plan}
        accounts={input.accounts}
        goals={input.goals}
        period={input.period}
        jointPeriod={input.jointPeriod}
        jointSetUp={Boolean(input.jointPeriod)}
        budget={budget}
        person="u1"
        viewerId="u1"
        payDate="2026-10-30"
        onSetUpJoint={() => {}}
        onApply={async () => {}}
        {...props}
      />
    </ToastProvider>
  )
}

function mount(over: Partial<Input> = {}, props: Partial<Props> = {}) {
  const onApply = vi.fn<Props['onApply']>().mockResolvedValue(undefined)
  const result = render(element(over, { onApply, ...props }))
  return { onApply, ...result }
}

const edit = () => screen.getByRole('button', { name: 'Edit' })
const startEditing = async () => userEvent.click(edit())
const bar = () => screen.getByRole('region', { name: 'Editing' })
const row = (name: string) => screen.getByText(name, { selector: 'li span' }).closest('li')!
const box = (name: string) => screen.getByLabelText(`${name} amount in dollars`)
const slider = (name: string) => screen.getByLabelText(`${name} amount slider`)
const type = (name: string, value: string) => fireEvent.change(box(name), { target: { value } })
const applyAll = () => screen.getByRole('button', { name: 'Apply to every pay' })
const applyOnce = () => screen.getByRole('button', { name: 'This pay only' })

test('raising Groceries leaves Left to spend alone and lowers Other spending', async () => {
  mount()
  await startEditing()
  fireEvent.change(slider('Groceries'), { target: { value: '50000' } })
  expect(box('Groceries')).toHaveValue('500.00')
  expect(bar()).toHaveTextContent('$462.55')
  expect(row('Other spending')).toHaveTextContent('$410.00')
  expect(row('Groceries')).toHaveTextContent('Was $400.00')
  expect(row('Groceries')).toHaveTextContent('$213.60 left')
})

test('typing an amount moves the slider', async () => {
  mount()
  await startEditing()
  type('Groceries', '750')
  expect(slider('Groceries')).toHaveValue('75000')
  expect(row('Other spending')).toHaveTextContent('$160.00')
})

test('the slider moves in $5 steps up to the range', async () => {
  mount()
  await startEditing()
  expect(slider('Groceries')).toHaveAttribute('step', '500')
  expect(slider('Groceries')).toHaveAttribute('max', '80000')
  type('Groceries', '1200')
  expect(slider('Groceries')).toHaveAttribute('max', '120000')
})

test.each([
  ['empty', ''],
  ['abc', 'abc'],
])('an invalid amount (%s) shows an error and disables Apply', async (_name, value) => {
  mount()
  await startEditing()
  type('Groceries', '500')
  expect(applyAll()).toBeEnabled()
  type('Groceries', value)
  expect(box('Groceries')).toHaveAttribute('aria-invalid', 'true')
  expect(row('Groceries')).toHaveTextContent('Enter an amount like 25 or 25.50')
  expect(applyAll()).toBeDisabled()
  expect(applyOnce()).toBeDisabled()
})

test('Apply is off until something changes', async () => {
  mount()
  await startEditing()
  expect(applyAll()).toBeDisabled()
  expect(bar()).toHaveTextContent('Nothing is saved until you apply')
  type('Groceries', '500')
  expect(bar()).toHaveTextContent('1 change, not saved yet')
})

test('Other spending has no slider', async () => {
  mount()
  await startEditing()
  expect(screen.queryByLabelText('Other spending amount slider')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Other spending amount in dollars')).not.toBeInTheDocument()
})

test('going over shows Over your pay only then', async () => {
  mount()
  await startEditing()
  expect(within(bar()).queryByText(/Over your pay/)).not.toBeInTheDocument()
  type('rainy Saver', '850')
  expect(within(bar()).getByText('Over your pay by $90.00')).toBeInTheDocument()
  type('rainy Saver', '250')
  expect(within(bar()).queryByText(/Over your pay/)).not.toBeInTheDocument()
})

test('Discard restores the amounts and clears the draft', async () => {
  mount()
  await startEditing()
  type('Groceries', '500')
  expect(sessionStorage.length).toBeGreaterThan(0)
  await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
  expect(screen.queryByRole('region', { name: 'Editing' })).not.toBeInTheDocument()
  expect(row('Groceries')).toHaveTextContent('$400.00')
  expect(sessionStorage.length).toBe(0)
  await startEditing()
  expect(box('Groceries')).toHaveValue('400.00')
})

test('Apply to every pay sends only the changed rows', async () => {
  const { onApply } = mount()
  await startEditing()
  type('Groceries', '500')
  type('rainy Saver', '300.50')
  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledTimes(1)
  expect(onApply).toHaveBeenCalledWith(
    none({
      savers: { set: [{ saverAccountId: 'rainy', amountCents: 30_050 }], remove: [] },
      limits: [{ lineId: 'groceries', amountCents: 50_000 }],
    }),
  )
  // Leaves Edit mode and forgets the draft.
  expect(screen.queryByRole('region', { name: 'Editing' })).not.toBeInTheDocument()
  expect(sessionStorage.length).toBe(0)
})

test('This pay only sends applyTo this-pay', async () => {
  const { onApply } = mount()
  await startEditing()
  type('Groceries', '500')
  await userEvent.click(applyOnce())
  expect(onApply).toHaveBeenCalledWith(
    none({ applyTo: 'this-pay', limits: [{ lineId: 'groceries', amountCents: 50_000 }] }),
  )
})

test('a failed Apply keeps Edit mode and the draft, and shows the error', async () => {
  const { onApply } = mount()
  onApply.mockRejectedValueOnce(new ApiError(409, 'Your pay has changed. Reload the page.'))
  await startEditing()
  type('Groceries', '500')
  await userEvent.click(applyAll())
  expect(await screen.findByText('Your pay has changed. Reload the page.')).toBeInTheDocument()
  expect(bar()).toBeInTheDocument()
  expect(box('Groceries')).toHaveValue('500')
  expect(applyAll()).toBeEnabled()
  expect(sessionStorage.length).toBeGreaterThan(0)
})

test('a draft survives a remount', async () => {
  const first = mount()
  await startEditing()
  type('Groceries', '500')
  first.unmount()
  mount()
  expect(bar()).toBeInTheDocument()
  expect(box('Groceries')).toHaveValue('500')
  expect(row('Groceries')).toHaveTextContent('Was $400.00')
})

test('a draft from an earlier pay is ignored', async () => {
  const first = mount()
  await startEditing()
  type('Groceries', '500')
  first.unmount()
  mount({}, { payDate: '2026-11-13' })
  expect(screen.queryByRole('region', { name: 'Editing' })).not.toBeInTheDocument()
})

test('a saved draft for a bucket that has gone neither crashes nor gets sent', async () => {
  sessionStorage.setItem(
    'upkeep:draft:budgets:u1:2026-10-30',
    JSON.stringify({
      baseline: { 'line:groceries': 40_000, 'line:gone': 1_000, 'saver:gone': 5_000 },
      amounts: { 'line:groceries': 50_000, 'line:gone': 9_000, 'saver:gone': 8_000 },
      texts: {},
      creates: [],
      updates: { gone: { name: 'Renamed' } },
      removals: ['line:gone', 'saver:gone'],
    }),
  )
  const { onApply } = mount()
  expect(bar()).toHaveTextContent('1 change, not saved yet')
  expect(applyOnce()).toBeEnabled()
  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledWith(none({ limits: [{ lineId: 'groceries', amountCents: 50_000 }] }))
})

test('the period control is disabled while editing, and the page says when editing starts and stops', async () => {
  const onEditingChange = vi.fn()
  mount({}, { onEditingChange })
  await startEditing()
  expect(onEditingChange).toHaveBeenLastCalledWith(true)
  await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
  expect(onEditingChange).toHaveBeenLastCalledWith(false)

  const { unmount } = render(
    <PeriodHeader
      period={period({ prevDate: '2026-10-16', nextDate: '2026-11-13' })}
      onPrev={() => {}}
      onNext={() => {}}
      disabled
    />,
  )
  expect(screen.getByRole('button', { name: 'Previous period' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled()
  unmount()

  const onSelect = vi.fn()
  const pills = [
    { id: 'u1', label: 'Your pay' },
    { id: 'u2', label: "Sam's pay" },
  ]
  const { rerender } = render(<PayPills pills={pills} person="u1" onSelect={onSelect} />)
  expect(screen.getByRole('button', { name: "Sam's pay" })).toBeEnabled()
  rerender(<PayPills pills={pills} person="u1" disabled onSelect={onSelect} />)
  expect(screen.getByRole('button', { name: "Sam's pay" })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Your pay' })).toBeDisabled()
})

test('moved status and row links are hidden while editing', async () => {
  mount()
  expect(screen.getAllByRole('link').length).toBeGreaterThan(0)
  expect(row('rainy Saver')).toHaveTextContent('Moved ✓')
  await startEditing()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  for (const name of ['rainy Saver', 'house Saver', 'holiday Saver'])
    expect(row(name)).not.toHaveTextContent(/moved/i)
})

test('a $37.25 amount is not changed by opening Edit', async () => {
  const { onApply } = mount({
    period: period({
      lines: [
        line('groceries', { name: 'Groceries', amountCents: 40_000, spentCents: 28_640 }),
        line('eating', { name: 'Eating out', amountCents: 3_725, spentCents: 1_000 }),
      ],
    }),
  })
  await startEditing()
  expect(box('Eating out')).toHaveValue('37.25')
  expect(bar()).toHaveTextContent('Nothing is saved until you apply')
  type('Groceries', '450')
  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledWith(none({ limits: [{ lineId: 'groceries', amountCents: 45_000 }] }))
})

test('a refetch during an edit keeps the draft and baselines', async () => {
  const { rerender } = mount()
  await startEditing()
  type('Groceries', '500')
  const fresh = example()
  rerender(
    element(
      {
        plan: plan([
          saverItem('rainy', 25_000, 'done', 25_000),
          saverItem('house', 200_000, 'done', 200_000),
          saverItem('holiday', 71_000, 'partial', 20_000),
          fresh.plan.items[3],
        ]),
        period: period({
          lines: [
            line('groceries', {
              name: 'Groceries',
              amountCents: 40_000,
              spentCents: 28_640,
              categoryIds: ['food'],
              state: 'ok',
            }),
            line('eating', { name: 'Eating out', amountCents: 26_000, spentCents: 21_275 }),
          ],
          notBudgetedCents: 19_830,
        }),
      },
      {},
    ),
  )
  expect(box('Groceries')).toHaveValue('500')
  expect(row('Groceries')).toHaveTextContent('Was $400.00')
  // The untouched row shows what is saved now, and is not counted as a change.
  expect(box('Eating out')).toHaveValue('260.00')
  expect(row('Eating out')).not.toHaveTextContent('Was')
  expect(bar()).toHaveTextContent('1 change, not saved yet')
})

test('pressing Apply twice sends one request', async () => {
  const { onApply } = mount()
  onApply.mockReturnValue(new Promise(() => {}))
  await startEditing()
  type('Groceries', '500')
  await userEvent.click(applyAll())
  expect(applyAll()).toBeDisabled()
  expect(applyOnce()).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled()
  fireEvent.click(applyAll())
  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledTimes(1)
})

test('This pay only is off when the draft adds, removes or renames, and says why', async () => {
  sessionStorage.setItem(
    'upkeep:draft:budgets:u1:2026-10-30',
    JSON.stringify({
      baseline: { 'line:groceries': 40_000 },
      amounts: {},
      texts: {},
      creates: [],
      updates: { groceries: { name: 'Food' } },
      removals: [],
    }),
  )
  mount()
  expect(applyOnce()).toBeDisabled()
  expect(bar()).toHaveTextContent('Adding, removing or renaming applies to every pay')
  expect(applyAll()).toBeEnabled()
})

test("the partner's pay and past pays offer no Edit button", () => {
  const { unmount } = mount({}, { person: 'u2' })
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  unmount()
  const past = mount({ period: { ...example().period, isCurrent: false, end: '2026-11-13' } })
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  past.unmount()
  mount({}, { budget: { ...budget, canEdit: false } })
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
})

test("the viewer's own current pay offers Edit", () => {
  mount()
  expect(edit()).toBeInTheDocument()
})

test('while the plan loads there is no Edit button and no plan is assumed', () => {
  mount({}, { planState: 'loading' })
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  expect(screen.getByText('Loading this pay…')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Your Savers' })).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'To Savers' })).not.toBeInTheDocument()
})

test('a plan that fails to load shows an error instead of the sections, with no Edit button', () => {
  mount({}, { planState: 'error' })
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this pay.")
  expect(screen.queryByRole('region', { name: 'Stays in Spending' })).not.toBeInTheDocument()
})

test('a plan that loaded empty still shows the page, without Saver rows', () => {
  mount({ plan: plan([]), accounts: [account('rainy', 'INDIVIDUAL')] })
  expect(edit()).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Your Savers' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Stays in Spending' })).toBeInTheDocument()
})

const withLines = (lines: ReturnType<typeof line>[]) => ({
  period: period({ lines, notBudgetedCents: 19_830 }),
})
const groceries = (amountCents = 40_000) =>
  line('groceries', { name: 'Groceries', amountCents, spentCents: 28_640 })
const eating = (amountCents: number) =>
  line('eating', { name: 'Eating out', amountCents, spentCents: 21_275 })

test('typing into a row whose saved amount changed after a refetch is compared with the new saved amount', async () => {
  const { rerender, onApply } = mount(withLines([groceries(), eating(25_000)]))
  await startEditing()
  type('Groceries', '450')
  rerender(element(withLines([groceries(), eating(26_000)]), { onApply }))
  expect(row('Eating out')).not.toHaveTextContent('Was')
  expect(bar()).toHaveTextContent('1 change, not saved yet')

  type('Eating out', '300')
  expect(row('Eating out')).toHaveTextContent('Was $260.00')
  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledWith(
    none({
      limits: [
        { lineId: 'groceries', amountCents: 45_000 },
        { lineId: 'eating', amountCents: 30_000 },
      ],
    }),
  )
})

test('typing a row back to its saved amount sends nothing and shows no Was', async () => {
  const { rerender, onApply } = mount(withLines([groceries(), eating(25_000)]))
  await startEditing()
  type('Eating out', '250')
  rerender(element(withLines([groceries(), eating(26_000)]), { onApply }))
  expect(row('Eating out')).toHaveTextContent('Was $260.00')
  type('Eating out', '260')
  expect(row('Eating out')).not.toHaveTextContent('Was')
  expect(bar()).toHaveTextContent('Nothing is saved until you apply')
  expect(applyAll()).toBeDisabled()
  type('Groceries', '450')
  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledWith(none({ limits: [{ lineId: 'groceries', amountCents: 45_000 }] }))
})

test('a row added after Edit began can be changed and is sent', async () => {
  const { rerender, onApply } = mount(withLines([groceries()]))
  await startEditing()
  const pets = line('pets', { name: 'Pets', amountCents: 5_000, spentCents: 0 })
  rerender(element(withLines([groceries(), pets]), { onApply }))
  type('Pets', '90')
  expect(row('Pets')).toHaveTextContent('Was $50.00')
  expect(bar()).toHaveTextContent('1 change, not saved yet')
  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledWith(none({ limits: [{ lineId: 'pets', amountCents: 9_000 }] }))
})

test('an Apply that finishes after the page has gone still clears the draft', async () => {
  let finish!: () => void
  const { onApply, unmount } = mount()
  onApply.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
  await startEditing()
  type('Groceries', '500')
  await userEvent.click(applyAll())
  unmount()
  finish()
  await vi.waitFor(() => expect(sessionStorage.length).toBe(0))
})

test('Edit goes in the header slot when there is one, not on a row of its own', () => {
  const slot = document.createElement('div')
  document.body.appendChild(slot)
  mount({}, { actionsSlot: slot })
  expect(within(slot).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  slot.remove()
})

test('Add bucket comes before the Total row in Stays in Spending', async () => {
  mount()
  await startEditing()
  const spending = screen.getByRole('region', { name: 'Stays in Spending' })
  const add = within(spending).getByRole('button', { name: 'Add bucket' })
  const total = screen.getByTestId('spending-total')
  expect(add.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

// Standard pay: what a normal pay usually leaves, built from the pays counted rather than the current one.
const standardOf = (over: Partial<StandardPayDto> = {}): StandardPayDto => {
  const input = example()
  return {
    plan: input.plan,
    period: { ...input.period, isCurrent: false, start: '2026-09-04', end: '2026-10-30' },
    jointPeriod: null,
    payCount: 5,
    hasUsual: true,
    jointHasUsual: true,
    payIsMedian: true,
    ...over,
  }
}
const standardPage = (standardOver: Partial<StandardPayDto> = {}, props: Partial<Props> = {}) => {
  const standard = standardOf(standardOver)
  return mount({ period: standard.period }, { standard, ...props })
}
const STANDARD_KEY = 'upkeep:draft:budgets-standard:u1:2026-10-30'
const PAY_KEY = 'upkeep:draft:budgets:u1:2026-10-30'

test("Standard pay offers Edit on your own pay, though its period isn't current", () => {
  standardPage()
  expect(edit()).toBeInTheDocument()
})

test("Standard pay offers no Edit on a partner's", () => {
  standardPage({}, { person: 'u2' })
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
})

test('Standard pay offers only Apply to every pay, which sends the payDate prop', async () => {
  const { onApply } = standardPage()
  await startEditing()
  fireEvent.change(slider('Groceries'), { target: { value: '50000' } })
  expect(screen.queryByRole('button', { name: 'This pay only' })).toBeNull()
  expect(screen.queryByText('Adding, removing or renaming applies to every pay')).toBeNull()
  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledTimes(1)
  expect(onApply.mock.calls[0][0]).toMatchObject({ applyTo: 'every-pay', payDate: '2026-10-30' })
})

test('the edit bar shows Usually left over, and it moves when a Saver is raised', async () => {
  standardPage()
  await startEditing()
  expect(bar()).toHaveTextContent('Usually left over')
  expect(bar()).not.toHaveTextContent('Left to spend')
  expect(bar()).toHaveTextContent('$462.55')
  fireEvent.change(slider('rainy Saver'), { target: { value: '30000' } })
  expect(bar()).toHaveTextContent('$412.55')
})

test('the edit bar says Left after limits without usual figures', async () => {
  standardPage({ hasUsual: false })
  await startEditing()
  expect(bar()).toHaveTextContent('Left after limits')
  expect(bar()).toHaveTextContent('$510.00')
})

test('Was compares against the every-pay amount', async () => {
  // The route passes Standard pay's own plan and period, so its rows hold the every-pay amounts.
  standardPage()
  await startEditing()
  expect(box('Groceries')).toHaveValue('400.00')
  expect(row('Groceries')).not.toHaveTextContent('Was')
  type('Groceries', '450')
  expect(row('Groceries')).toHaveTextContent('Was $400.00')
})

test("drafts don't mix between This pay and Standard pay", async () => {
  sessionStorage.clear()
  const standard = standardOf()
  const first = mount({ period: standard.period }, { standard })
  await startEditing()
  type('Groceries', '450')
  expect(sessionStorage.getItem(STANDARD_KEY)).not.toBeNull()
  expect(sessionStorage.getItem(PAY_KEY)).toBeNull()
  first.unmount()

  // Remounting as This pay finds no draft, and leaves the Standard one alone.
  const second = mount()
  expect(screen.queryByRole('region', { name: 'Editing' })).toBeNull()
  expect(sessionStorage.getItem(STANDARD_KEY)).not.toBeNull()
  second.unmount()

  // And the Standard draft comes back in Standard pay.
  const third = mount({ period: standard.period }, { standard })
  expect(box('Groceries')).toHaveValue('450')
  third.unmount()

  // The other way round.
  sessionStorage.clear()
  const fourth = mount()
  await startEditing()
  type('Groceries', '420')
  expect(sessionStorage.getItem(PAY_KEY)).not.toBeNull()
  fourth.unmount()
  mount({ period: standard.period }, { standard })
  expect(screen.queryByRole('region', { name: 'Editing' })).toBeNull()
  expect(sessionStorage.getItem(PAY_KEY)).not.toBeNull()
})

test('the joint date note is hidden in Standard pay', () => {
  const shared = period({
    budgetId: 'j',
    start: '2026-10-28',
    nominalEnd: '2026-11-11',
    lines: [line('shared-g', { name: 'Shared groceries', amountCents: 60_000 })],
  })
  standardPage({ jointPeriod: shared }, { jointPeriod: shared, jointSetUp: true })
  expect(screen.getByText('Shared groceries')).toBeInTheDocument()
  expect(screen.queryByText(/Joint pay/)).toBeNull()
})

test('Total row uses the Standard wording', () => {
  const { unmount } = standardPage()
  const total = screen.getByTestId('spending-total')
  expect(total).toHaveTextContent('$462.55 usually left over')
  expect(total).toHaveTextContent('$697.45 usually spent')
  unmount()
  standardPage({ hasUsual: false })
  const bare = screen.getByTestId('spending-total')
  expect(bare).toHaveTextContent('$510.00 left after limits')
  expect(bare).not.toHaveTextContent('spent')
})

test('the Total row moved-back note reads usually includes', () => {
  const standard = standardOf()
  standardPage({ period: { ...standard.period, movedBackCents: 5_000 } })
  expect(screen.getByTestId('spending-total')).toHaveTextContent('usually includes $50.00 moved back from Savers')
})

test('shared rows use jointHasUsual, personal rows hasUsual', () => {
  const shared = period({
    budgetId: 'j',
    lines: [line('shared-g', { name: 'Shared groceries', amountCents: 60_000, spentCents: 50_000 })],
  })
  standardPage({ hasUsual: true, jointHasUsual: false, jointPeriod: shared }, { jointPeriod: shared, jointSetUp: true })
  expect(screen.getByText('Groceries').closest('li')).toHaveTextContent('Usually')
  expect(screen.getByText('Shared groceries').closest('li')).not.toHaveTextContent('Usually')
})

test('row links span the pays counted', () => {
  standardPage()
  const link = screen.getByRole('link', { name: /Groceries/ })
  const href = new URL(link.getAttribute('href')!, 'http://x')
  expect(href.searchParams.get('from')).toBe('2026-09-04')
  expect(href.searchParams.get('to')).toBe('2026-10-29')
})

test('a limit added in Standard pay shows no usual figure until applied', async () => {
  standardPage({}, { categories: [{ id: 'pets', name: 'Pet care', parentId: null, colorToken: 'cat-blue' }] })
  await startEditing()
  const spending = screen.getByRole('region', { name: 'Stays in Spending' })
  await userEvent.click(within(spending).getByRole('button', { name: 'Add bucket' }))
  const form = screen.getByRole('form', { name: 'Add bucket' })
  await userEvent.type(within(form).getByLabelText('Name'), 'Pets')
  await userEvent.type(within(form).getByLabelText('Limit'), '50')
  await userEvent.click(within(form).getByLabelText('Pet care'))
  await userEvent.click(within(form).getByRole('button', { name: 'Add' }))
  expect(row('Pets')).not.toHaveTextContent(/Usually|spare|over/)
  expect(box('Pets')).toHaveValue('50.00')
  expect(row('Groceries')).toHaveTextContent('Usually')
})

describe('a Saver only in this pay', () => {
  const withCar = () => {
    const input = example()
    return { accounts: [...input.accounts, account('car', 'INDIVIDUAL')] }
  }
  const sectionOf = (name: string) => screen.getByRole('region', { name })

  test("is unavailable for a limit in Standard pay, saying it is in this pay's plan", async () => {
    const standard = standardOf()
    mount({ ...withCar(), period: standard.period }, { standard, thisPaySaverIds: ['car'] })
    await startEditing()
    await userEvent.click(screen.getByRole('button', { name: 'More about Groceries' }))
    expect(screen.getByRole('option', { name: "car Saver (In this pay's plan)" })).toBeDisabled()
  })

  test('stays choosable when adding to Your Savers', async () => {
    const standard = standardOf()
    mount({ ...withCar(), period: standard.period }, { standard, thisPaySaverIds: ['car'] })
    await startEditing()
    await userEvent.click(within(sectionOf('Your Savers')).getByRole('button', { name: 'Add bucket' }))
    expect(screen.getByRole('option', { name: 'car Saver' })).toBeEnabled()
  })
})
