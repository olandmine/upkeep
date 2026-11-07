import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { UNCATEGORISED } from '../../src/shared/categories'
import type { BudgetDto, CategoryDto, SpendingHistoryDto } from '../../src/shared/types'
import { BucketForm } from '../../src/web/components/budgets/BucketForm'
import { PayPage } from '../../src/web/components/budgets/PayPage'
import { FilterBar } from '../../src/web/components/transactions/FilterBar'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { example } from './pay-fixtures'

const cat = (id: string, name: string, parentId: string | null): CategoryDto => ({ id, name, parentId, colorToken: 'cat-blue' })
const categories = [
  cat('home', 'Home', null),
  cat('groceries', 'Groceries', 'home'),
  cat('rent', 'Rent', 'home'),
  cat('power', 'Power', 'home'),
  cat('fun', 'Fun', null),
  cat('games', 'Games', 'fun'),
  cat('pubs', 'Pubs', 'fun'),
  cat('movies', 'Movies', 'fun'),
]
const history = (over: Partial<SpendingHistoryDto> = {}): SpendingHistoryDto => ({
  from: '2026-07-01',
  to: '2026-09-22',
  payCount: 6,
  categories: [
    { categoryId: 'groceries', perPayCents: 42_000 },
    { categoryId: 'games', perPayCents: 8_000 },
  ],
  uncategorised: { count: 0, cents: 0 },
  ...over,
})

const form = (over: Partial<Parameters<typeof BucketForm>[0]> = {}) => {
  const onSave = vi.fn()
  render(
    <BucketForm
      section="spending"
      categories={categories}
      savers={[]}
      taken={new Map()}
      history={history()}
      categoriseHref="/transactions?categoryId=uncategorised"
      onSave={onSave}
      onCancel={() => {}}
      {...over}
    />,
  )
  return onSave
}
const suggestion = (name: RegExp) => screen.getByRole('button', { name })
const suggestions = () => within(screen.getByRole('group', { name: /Top spending/ })).getAllByRole('button')
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value

test('a suggestion shows its average, says which pays, and fills an empty name and limit without saving', async () => {
  const onSave = form()
  expect(screen.getByRole('group', { name: 'Top spending in your last 6 pays' })).toBeInTheDocument()
  const groceries = suggestion(/Groceries/)
  expect(groceries).toHaveTextContent('$420 a pay')
  expect(groceries).toHaveAttribute('aria-pressed', 'false')

  await userEvent.click(groceries)
  expect(value('Name')).toBe('Groceries')
  expect(value('Limit')).toBe('420.00')
  expect(screen.getByRole('checkbox', { name: 'Groceries' })).toBeChecked()
  expect(groceries).toHaveAttribute('aria-pressed', 'true')
  expect(onSave).not.toHaveBeenCalled()
})

test('a suggestion keeps what is already typed, and adds to what is ticked', async () => {
  form()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fun money' } })
  fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '50' } })
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pubs' }))
  await userEvent.click(suggestion(/Games/))
  expect(value('Name')).toBe('Fun money')
  expect(value('Limit')).toBe('50')
  expect(screen.getByRole('checkbox', { name: 'Pubs' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Games' })).toBeChecked()
})

test('a second suggestion ticks too, and leaves the name and limit from the first', async () => {
  form()
  await userEvent.click(suggestion(/Groceries/))
  await userEvent.click(suggestion(/Games/))
  expect(value('Name')).toBe('Groceries')
  expect(value('Limit')).toBe('420.00')
  expect(screen.getByRole('checkbox', { name: 'Games' })).toBeChecked()
})

test('tapping a suggestion again unticks it', async () => {
  form()
  await userEvent.click(suggestion(/Groceries/))
  await userEvent.click(suggestion(/Groceries/))
  expect(screen.getByRole('checkbox', { name: 'Groceries' })).not.toBeChecked()
})

test('a category in another bucket, itself or through its parent, is not suggested, and the rest fill up to five', () => {
  form({
    taken: new Map([
      ['rent', 'Bills'],
      ['fun', 'Fun'],
    ]),
    history: history({
      categories: [
        { categoryId: 'rent', perPayCents: 90_000 },
        { categoryId: 'games', perPayCents: 80_000 },
        { categoryId: 'groceries', perPayCents: 70_000 },
        { categoryId: 'power', perPayCents: 60_000 },
        // Not in the list of categories, so it has no name to show.
        { categoryId: 'gone', perPayCents: 50_000 },
      ],
    }),
  })
  expect(suggestions().map((b) => b.textContent)).toEqual(['Groceries · $700 a pay', 'Power · $600 a pay'])
})

test('it suggests five at most', () => {
  form({
    history: history({
      categories: ['groceries', 'rent', 'power', 'games', 'pubs', 'movies'].map((categoryId) => ({ categoryId, perPayCents: 1_000 })),
    }),
  })
  expect(suggestions()).toHaveLength(5)
})

test('the warning gives the count and amount, and links to categorising', () => {
  form({ history: history({ uncategorised: { count: 12, cents: 34_050 } }) })
  expect(screen.getByText("12 transactions ($340.50) aren't categorised, so they're not in these suggestions.")).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Categorise' })).toHaveAttribute('href', '/transactions?categoryId=uncategorised')
})

test('the warning reads right for one transaction, and with nothing to suggest', () => {
  form({ history: history({ categories: [], uncategorised: { count: 1, cents: 500 } }) })
  expect(screen.getByText("1 transaction ($5.00) isn't categorised.")).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: /Top spending/ })).not.toBeInTheDocument()
})

test('with everything categorised there is no warning', () => {
  form()
  expect(screen.queryByRole('link', { name: 'Categorise' })).not.toBeInTheDocument()
})

test('without a history the form works as it did', () => {
  form({ history: undefined })
  expect(screen.queryByRole('group', { name: /Top spending/ })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Name')).toBeInTheDocument()
})

test('a Saver bucket, which has no categories, shows neither', () => {
  form({ section: 'yours', history: history({ uncategorised: { count: 2, cents: 500 } }) })
  expect(screen.queryByRole('group', { name: /Top spending/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Categorise' })).not.toBeInTheDocument()
})

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

function mount(spendingHistory: Parameters<typeof PayPage>[0]['spendingHistory']) {
  const input = example()
  render(
    <ToastProvider>
      <PayPage
        plan={input.plan}
        accounts={input.accounts}
        goals={input.goals}
        categories={categories}
        period={input.period}
        jointPeriod={input.jointPeriod}
        jointSetUp
        budget={budget}
        person="u1"
        viewerId="u1"
        payDate="2026-10-30"
        spendingHistory={spendingHistory}
        onSetUpJoint={() => {}}
        onApply={vi.fn()}
      />
    </ToastProvider>,
  )
}
const addTo = async (label: string) => {
  await userEvent.click(within(screen.getByRole('region', { name: label })).getByRole('button', { name: 'Add bucket' }))
}

test('each section suggests from its own budget and links to the same dates and scope', async () => {
  mount({
    personal: history({ uncategorised: { count: 2, cents: 500 } }),
    joint: history({
      from: '2026-07-08',
      to: '2026-09-29',
      categories: [{ categoryId: 'pubs', perPayCents: 3_000 }],
      uncategorised: { count: 3, cents: 900 },
    }),
  })
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

  await addTo('Stays in Spending')
  expect(suggestion(/Games/)).toBeInTheDocument()
  const mine = new URL(screen.getByRole('link', { name: 'Categorise' }).getAttribute('href')!, 'http://x')
  expect(Object.fromEntries(mine.searchParams)).toEqual({ scope: 'me', categoryId: UNCATEGORISED, from: '2026-07-01', to: '2026-09-22' })
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  await addTo('Shared spending limits')
  expect(suggestion(/Pubs/)).toBeInTheDocument()
  const ours = new URL(screen.getByRole('link', { name: 'Categorise' }).getAttribute('href')!, 'http://x')
  expect(Object.fromEntries(ours.searchParams)).toEqual({ scope: 'joint', categoryId: UNCATEGORISED, from: '2026-07-08', to: '2026-09-29' })
})

test('changing a bucket shows no suggestions', async () => {
  const bucket = { key: 'k', name: 'Bills', kind: 'limit', lineKind: 'spending', categoryIds: [], amountCents: 100 } as unknown as NonNullable<Parameters<typeof BucketForm>[0]['bucket']>
  form({ bucket })
  expect(screen.queryByRole('group', { name: /Top spending/ })).not.toBeInTheDocument()
})

test('Transactions can filter to uncategorised spending', async () => {
  const onChange = vi.fn()
  render(<FilterBar value={{}} onChange={onChange} accounts={[]} categories={categories} tags={[]} />)
  await userEvent.selectOptions(screen.getByLabelText('Category'), 'Uncategorised spending')
  expect(onChange).toHaveBeenCalledWith({ categoryId: UNCATEGORISED })
})
