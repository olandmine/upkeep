import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { BudgetDto, CategoryDto, PayChangesInput, UserDto } from '../../src/shared/types'
import { BucketForm } from '../../src/web/components/budgets/BucketForm'
import { PayPage } from '../../src/web/components/budgets/PayPage'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { account, example, line, period } from './pay-fixtures'

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
const categories: CategoryDto[] = [
  { id: 'food', name: 'Food', parentId: null, colorToken: 'cat-blue' },
  { id: 'pets', name: 'Pets', parentId: null, colorToken: 'cat-blue' },
  { id: 'vet', name: 'Vet', parentId: 'pets', colorToken: 'cat-blue' },
]
const users: UserDto[] = [
  { id: 'u1', username: 'a', displayName: 'Alex', upDisplayName: null, negativeStyle: 'minus', accent: 'amber', sharingLevel: 'full', connectUpAnswered: true, gettingStartedHidden: true },
  { id: 'u2', username: 's', displayName: 'Sam', upDisplayName: null, negativeStyle: 'minus', accent: 'amber', sharingLevel: 'full', connectUpAnswered: true, gettingStartedHidden: true },
]

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

const spare = account('spare', 'INDIVIDUAL')
const cabin = account('cabin', 'JOINT')
const theirs = { ...account('theirs', 'INDIVIDUAL'), ownerUserId: 'u2' }

function mount(over: Partial<Input> = {}, props: Partial<Props> = {}) {
  const input = { ...example(), ...over }
  const onApply = vi.fn<Props['onApply']>().mockResolvedValue(undefined)
  render(
    <ToastProvider>
      <PayPage
        plan={input.plan}
        accounts={[...input.accounts, spare, cabin, theirs]}
        goals={input.goals}
        categories={categories}
        period={input.period}
        jointPeriod={input.jointPeriod}
        jointSetUp={Boolean(input.jointPeriod)}
        budget={budget}
        person="u1"
        viewerId="u1"
        payDate="2026-10-30"
        onSetUpJoint={() => {}}
        onApply={onApply}
        {...props}
      />
    </ToastProvider>,
  )
  return { onApply }
}

const startEditing = () => userEvent.click(screen.getByRole('button', { name: 'Edit' }))
const bar = () => screen.getByRole('region', { name: 'Editing' })
const row = (name: string) => screen.getByText(name, { selector: 'li span' }).closest('li')!
const section = (name: string) => screen.getByRole('region', { name })
const addBucket = (name: string) => userEvent.click(within(section(name)).getByRole('button', { name: 'Add bucket' }))
const more = (name: string) => userEvent.click(screen.getByRole('button', { name: `More about ${name}` }))
const applyAll = () => screen.getByRole('button', { name: 'Apply to every pay' })
const applyOnce = () => screen.getByRole('button', { name: 'This pay only' })
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const options = (label = 'Saver') => within(screen.getByLabelText(label)).getAllByRole('option')

const form = (over: Partial<Parameters<typeof BucketForm>[0]> = {}) => {
  const onSave = vi.fn()
  render(
    <BucketForm section="spending" categories={categories} savers={[]} taken={new Map()} onSave={onSave} onCancel={() => {}} {...over} />,
  )
  return onSave
}

test('Stays in Spending asks for a name, limit and categories', async () => {
  const onSave = form()
  const add = screen.getByRole('button', { name: 'Add' })
  expect(add).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Name'), 'Pets')
  await userEvent.type(screen.getByLabelText('Limit'), '$50')
  // No category yet.
  expect(add).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pets' }))
  expect(add).toBeEnabled()
  await userEvent.click(add)
  expect(onSave).toHaveBeenCalledWith({
    name: 'Pets',
    amountCents: 5_000,
    categoryIds: ['pets'],
    saverAccountId: null,
  })
})

test('categories in another bucket are disabled and name it', () => {
  form({ taken: new Map([['food', 'Groceries']]) })
  const box = screen.getByRole('checkbox', { name: /Food/ })
  expect(box).toBeDisabled()
  expect(within(box.closest('label')!).getByText('in Groceries')).toBeInTheDocument()
  // Child categories sit under their parent.
  expect(screen.getByRole('checkbox', { name: 'Vet' })).toBeEnabled()
})

test('a Saver bucket asks for a Saver and an amount, and a disabled Saver says why', async () => {
  const onSave = form({
    section: 'yours',
    savers: [
      { id: 'a', name: 'Rainy', disabledReason: 'Already in your plan' },
      { id: 'b', name: 'Spare', disabledReason: null },
    ],
  })
  expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Rainy (Already in your plan)' })).toBeDisabled()
  const add = screen.getByRole('button', { name: 'Add' })
  expect(add).toBeDisabled()
  await userEvent.selectOptions(screen.getByLabelText('Saver'), 'b')
  await userEvent.type(screen.getByLabelText('Amount'), '25.50')
  await userEvent.click(add)
  expect(onSave).toHaveBeenCalledWith({
    name: 'Spare',
    amountCents: 2_550,
    categoryIds: [],
    saverAccountId: 'b',
  })
})

test('Your Savers lists your Savers, with those in the plan disabled and saying so', async () => {
  mount()
  await startEditing()
  await addBucket('Your Savers')
  expect(options().map((o) => o.textContent)).toEqual(['Choose a Saver', 'rainy Saver (Already in your plan)', 'spare Saver'])
  expect(screen.getByRole('option', { name: /rainy Saver/ })).toBeDisabled()
  expect(screen.getByRole('option', { name: 'spare Saver' })).toBeEnabled()
})

test('Joint Savers lists joint Savers', async () => {
  mount()
  await startEditing()
  await addBucket('Joint Savers you pay into')
  expect(options().map((o) => o.textContent)).toEqual([
    'Choose a Saver',
    'cabin Saver',
    'holiday Saver (Already in your plan)',
    'house Saver (Already in your plan)',
  ])
})

test("a partner's personal Savers are never listed", async () => {
  mount()
  await startEditing()
  await addBucket('Your Savers')
  expect(screen.queryByRole('option', { name: /theirs/ })).not.toBeInTheDocument()
})

test('a Saver linked to a limit says Used by that limit, and is disabled', async () => {
  const input = example()
  mount({
    period: {
      ...input.period,
      lines: [...input.period.lines, line('trip', { name: 'groceries', amountCents: 1_000, saverAccountId: 'spare' })],
    },
  })
  await startEditing()
  await addBucket('Your Savers')
  expect(screen.getByRole('option', { name: 'spare Saver (Used by groceries)' })).toBeDisabled()
})

test('a new bucket counts in the totals straight away', async () => {
  mount()
  await startEditing()
  expect(bar()).toHaveTextContent('$462.55')
  await addBucket('Your Savers')
  await userEvent.selectOptions(screen.getByLabelText('Saver'), 'spare')
  fill('Amount', '100')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(bar()).toHaveTextContent('$362.55')
  expect(bar()).toHaveTextContent('1 change, not saved yet')
  expect(screen.getByLabelText('spare Saver amount in dollars')).toHaveValue('100.00')
})

test('removing a bucket takes it out of the totals and asks first', async () => {
  mount()
  await startEditing()
  await more('rainy Saver')
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  // Asked, and nothing has changed yet.
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  // The page behind the question is hidden from the accessibility tree.
  expect(screen.getByRole('region', { name: 'Editing', hidden: true })).toHaveTextContent('$462.55')
  await userEvent.click(screen.getByRole('button', { name: 'Remove bucket' }))
  expect(bar()).toHaveTextContent('$712.55')
  expect(screen.queryByLabelText('rainy Saver amount in dollars')).not.toBeInTheDocument()
})

test('cancelling the question keeps the bucket', async () => {
  mount()
  await startEditing()
  await more('rainy Saver')
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
  expect(bar()).toHaveTextContent('$462.55')
  expect(bar()).toHaveTextContent('Nothing is saved until you apply')
})

test('structural changes disable This pay only and say why', async () => {
  mount()
  await startEditing()
  expect(applyOnce()).toBeDisabled()
  await addBucket('Your Savers')
  await userEvent.selectOptions(screen.getByLabelText('Saver'), 'spare')
  fill('Amount', '100')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(applyOnce()).toBeDisabled()
  expect(bar()).toHaveTextContent('Adding, removing or renaming applies to every pay')
  expect(applyAll()).toBeEnabled()
})

test('taking back a bucket added in the draft stops it counting as a change', async () => {
  mount()
  await startEditing()
  await addBucket('Your Savers')
  await userEvent.selectOptions(screen.getByLabelText('Saver'), 'spare')
  fill('Amount', '100')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  await more('spare Saver')
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await userEvent.click(screen.getByRole('button', { name: 'Remove bucket' }))
  expect(bar()).toHaveTextContent('Nothing is saved until you apply')
  expect(bar()).not.toHaveTextContent('Adding, removing or renaming')
  fireEvent.change(screen.getByLabelText('Groceries amount in dollars'), { target: { value: '500' } })
  expect(applyOnce()).toBeEnabled()
})

test('Cancel closes the form and changes nothing', async () => {
  mount()
  await startEditing()
  await addBucket('Your Savers')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByLabelText('Saver')).not.toBeInTheDocument()
  expect(bar()).toHaveTextContent('Nothing is saved until you apply')
})

test('Apply sends creates, updates and archives together', async () => {
  const { onApply } = mount()
  await startEditing()

  await addBucket('Your Savers')
  await userEvent.selectOptions(screen.getByLabelText('Saver'), 'spare')
  fill('Amount', '100')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))

  await addBucket('Stays in Spending')
  await userEvent.type(screen.getByLabelText('Name'), 'Pets')
  fill('Limit', '50')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pets' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))

  await more('Groceries')
  await userEvent.clear(screen.getByLabelText('Name'))
  await userEvent.type(screen.getByLabelText('Name'), 'Food')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))

  await more('Eating out')
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await userEvent.click(screen.getByRole('button', { name: 'Remove bucket' }))

  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledTimes(1)
  expect(onApply).toHaveBeenCalledWith(
    none({
      savers: { set: [{ saverAccountId: 'spare', amountCents: 10_000 }], remove: [] },
      lines: {
        create: [
          {
            budget: 'personal',
            kind: 'spending',
            name: 'Pets',
            amountCents: 5_000,
            categoryIds: ['pets'],
            saverAccountId: null,
          },
        ],
        update: [{ lineId: 'groceries', name: 'Food' }],
        archive: ['eating'],
      },
    }),
  )
})

test('a change that leaves the name and categories as they were is not a change', async () => {
  mount()
  await startEditing()
  await more('Groceries')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(bar()).toHaveTextContent('Nothing is saved until you apply')
})

test('a shared limit can be backed by a joint Saver, which may be one you pay into', async () => {
  const jointPeriod = period({
    budgetId: 'j1',
    lines: [line('food', { name: 'Shared food', amountCents: 30_000, categoryIds: ['pets'] })],
  })
  const { onApply } = mount({ jointPeriod })
  await startEditing()
  await more('Shared food')
  expect(screen.getByRole('option', { name: 'house Saver' })).toBeEnabled()
  await userEvent.selectOptions(screen.getByLabelText('Saver'), 'house')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledWith(none({ lines: { create: [], update: [{ lineId: 'food', saverAccountId: 'house' }], archive: [] } }))
})

test('a joint Saver backing a shared limit can be taken out and added back', async () => {
  const jointPeriod = period({
    budgetId: 'j1',
    lines: [line('food', { name: 'Shared food', amountCents: 30_000, categoryIds: ['pets'], saverAccountId: 'house' })],
  })
  const { onApply } = mount({ jointPeriod })
  await startEditing()
  await more('house Saver')
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await userEvent.click(screen.getByRole('button', { name: 'Remove bucket' }))
  await addBucket('Joint Savers you pay into')
  expect(screen.getByRole('option', { name: 'house Saver' })).toBeEnabled()
  await userEvent.selectOptions(screen.getByLabelText('Saver'), 'house')
  fill('Amount', '1500')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  await userEvent.click(applyAll())
  // Put back, it is just a new amount: the shared limit behind it is left alone.
  expect(onApply).toHaveBeenCalledWith(none({ savers: { set: [{ saverAccountId: 'house', amountCents: 150_000 }], remove: [] } }))
})

test('the Joint anchor picker appears under Shared limits in Edit mode and saves as soon as it changes', async () => {
  const onSetAnchor = vi.fn().mockResolvedValue(undefined)
  const jointPeriod = period({ budgetId: 'j1' })
  mount(
    { jointPeriod },
    {
      users,
      jointBudget: { ...budget, id: 'j1', kind: 'joint', ownerUserId: null, anchorUserId: 'u1' },
      onSetAnchor,
    },
  )
  expect(screen.queryByLabelText('Joint budgets follow')).not.toBeInTheDocument()
  await startEditing()
  const picker = within(section('Shared spending limits')).getByLabelText('Joint budgets follow')
  expect(picker).toHaveValue('u1')
  await userEvent.selectOptions(picker, 'u2')
  expect(onSetAnchor).toHaveBeenCalledWith('u2')
  // It is not an amount being tried out, so the draft has nothing in it.
  expect(bar()).toHaveTextContent('Nothing is saved until you apply')
})

test('without Joint set up there is no shared section to add to', async () => {
  mount()
  await startEditing()
  expect(screen.getAllByRole('region', { name: 'Shared spending limits' })).toHaveLength(1)
  expect(
    within(screen.getByRole('region', { name: 'Shared spending limits' })).queryByRole('button', {
      name: 'Add bucket',
    }),
  ).not.toBeInTheDocument()
})

test('a personal limit offers a Saver, with a joint Saver disabled and saying where to add it', async () => {
  mount()
  await startEditing()
  await more('Groceries')
  expect(screen.getByRole('option', { name: 'cabin Saver (Add on Shared limits)' })).toBeDisabled()
  expect(screen.getByRole('option', { name: 'rainy Saver (Already in your plan)' })).toBeDisabled()
  expect(screen.getByRole('option', { name: 'spare Saver' })).toBeEnabled()
  expect(screen.getByRole('option', { name: 'No Saver' })).toBeEnabled()
})

test('linking a personal limit to a Saver shows where it is paid from and sends the link', async () => {
  const { onApply } = mount()
  await startEditing()
  await more('Groceries')
  await userEvent.selectOptions(screen.getByLabelText('Saver'), 'spare')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(row('Groceries')).toHaveTextContent('Paid from spare Saver')
  // Its $400.00 plan item will go to the Saver, so Left to spend already says so.
  expect(bar()).toHaveTextContent('$62.55')
  await more('Groceries')
  await userEvent.selectOptions(screen.getByLabelText('Saver'), '')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(row('Groceries')).not.toHaveTextContent('Paid from')
  expect(bar()).toHaveTextContent('$462.55')
  expect(bar()).toHaveTextContent('Nothing is saved until you apply')
  await more('Groceries')
  await userEvent.selectOptions(screen.getByLabelText('Saver'), 'spare')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledWith(
    none({ lines: { create: [], update: [{ lineId: 'groceries', saverAccountId: 'spare' }], archive: [] } }),
  )
})

test('Stays in Spending can add a limit paid from a Saver', async () => {
  const { onApply } = mount()
  await startEditing()
  await addBucket('Stays in Spending')
  await userEvent.type(screen.getByLabelText('Name'), 'Rent')
  fill('Limit', '800')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pets' }))
  await userEvent.selectOptions(screen.getByLabelText('Saver'), 'spare')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(row('Rent')).toHaveTextContent('Paid from spare Saver')
  await userEvent.click(applyAll())
  expect(onApply).toHaveBeenCalledWith(
    none({
      lines: {
        create: [
          { budget: 'personal', kind: 'spending', name: 'Rent', amountCents: 80_000, categoryIds: ['pets'], saverAccountId: 'spare' },
        ],
        update: [],
        archive: [],
      },
    }),
  )
})

test('removing a Saver that backs a limit says the limit goes too', async () => {
  const input = example()
  mount({
    period: {
      ...input.period,
      lines: [...input.period.lines, line('trip', { name: 'Trip', amountCents: 3_000, saverAccountId: 'rainy' })],
    },
  })
  await startEditing()
  await more('rainy Saver')
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('remove its limit')
})

describe('a limit paid from a Saver', () => {
  const rentInput = () => {
    const input = example()
    return {
      period: {
        ...input.period,
        lines: [
          ...input.period.lines,
          line('rent', { name: 'Rent', amountCents: 80_000, spentCents: 10_000, categoryIds: ['pets'], saverAccountId: 'spare' }),
        ],
      },
    }
  }

  test('shows what is spent against the limit, and its ⋯ form changes the limit, name and Saver', async () => {
    const { onApply } = mount(rentInput())
    expect(row('spare Saver')).toHaveTextContent('$100.00 of $800.00 spent')
    await startEditing()
    await more('spare Saver')
    expect(screen.getByLabelText('Name')).toHaveValue('Rent')
    expect(screen.getByLabelText('Limit')).toHaveValue('800.00')
    expect(screen.getByRole('option', { name: 'spare Saver' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'cabin Saver (Add on Shared limits)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    fill('Limit', '900')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(applyAll())
    // Its amount is a limit, not a Saver amount.
    expect(onApply).toHaveBeenCalledWith(none({ limits: [{ lineId: 'rent', amountCents: 90_000 }] }))
  })

  test('clearing its Saver sends the link as cleared', async () => {
    const { onApply } = mount(rentInput())
    await startEditing()
    await more('spare Saver')
    // $4,120.00 pay, $2,960.00 + $800.00 to Savers, $797.45 spent.
    expect(bar()).toHaveTextContent('$437.45')
    await userEvent.selectOptions(screen.getByLabelText('Saver'), '')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    // The $800.00 stays in Spending again, as a limit.
    expect(bar()).toHaveTextContent('$362.55')
    await userEvent.click(applyAll())
    expect(onApply).toHaveBeenCalledWith(none({ lines: { create: [], update: [{ lineId: 'rent', saverAccountId: null }], archive: [] } }))
  })
})
