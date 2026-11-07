import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CategoryDto, TransactionDto } from '../../src/shared/types'
import { TagEditor } from '../../src/web/components/transactions/TagEditor'
import { TransactionDetail } from '../../src/web/components/transactions/TransactionDrawer'
import { TxBadges } from '../../src/web/components/transactions/TransactionRow'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { ApiError } from '../../src/web/lib/api'
import { groupByDay } from '../../src/web/lib/group-by-day'

const tx = (t: Partial<TransactionDto>): TransactionDto => ({
  id: 't1',
  accountId: 'acc-1',
  accountName: 'Spending',
  status: 'SETTLED',
  amountCents: -1000,
  currency: 'AUD',
  foreignAmountCents: null,
  foreignCurrency: null,
  description: 'Woolworths',
  message: null,
  rawText: null,
  categoryId: 'groceries',
  parentCategoryId: 'home',
  isCategorizable: true,
  roundUpCents: null,
  cashbackCents: null,
  cardMethod: null,
  cardSuffix: null,
  transferAccountId: null,
  isTransfer: false,
  performingCustomer: null,
  performedByUserId: null,
  createdAt: '2026-10-28T03:00:00.000Z',
  settledAt: null,
  deletedAt: null,
  tags: [],
  ...t,
})

const categories: CategoryDto[] = [
  { id: 'home', name: 'Home', parentId: null, colorToken: 'cat-blue' },
  { id: 'groceries', name: 'Groceries', parentId: 'home', colorToken: 'cat-blue' },
  { id: 'good-life', name: 'Good Life', parentId: null, colorToken: 'cat-orange' },
  { id: 'takeaway', name: 'Takeaway', parentId: 'good-life', colorToken: 'cat-orange' },
]

test('groupByDay uses local dates and daily net', () => {
  const groups = groupByDay(
    [
      tx({ id: 'a', createdAt: '2026-10-28T14:00:00.000Z', amountCents: -1000 }),
      tx({ id: 'b', createdAt: '2026-10-28T13:30:00.000Z', amountCents: 250 }),
      tx({ id: 'x', createdAt: '2026-10-28T13:10:00.000Z', amountCents: -5000, isTransfer: true }),
      tx({ id: 'c', createdAt: '2026-10-28T12:00:00.000Z', amountCents: -300 }),
    ],
    'Australia/Sydney',
  )
  expect(groups.map((g) => [g.date, g.label, g.netCents, g.items.map((i) => i.id)])).toEqual([
    ['2026-10-29', 'Thu 29 Oct', -750, ['a', 'b', 'x']],
    ['2026-10-28', 'Wed 28 Oct', -300, ['c']],
  ])
})

test('held shows Pending, transfer shows Transfer', () => {
  const { rerender } = render(<TxBadges tx={tx({ status: 'HELD' })} />)
  expect(screen.getByText('Pending')).toBeInTheDocument()
  rerender(<TxBadges tx={tx({ isTransfer: true })} />)
  expect(screen.getByText('Transfer')).toBeInTheDocument()
  rerender(<TxBadges tx={tx({})} />)
  expect(screen.queryByText('Pending')).not.toBeInTheDocument()
})

const detail = (t: TransactionDto, onCategory = vi.fn().mockResolvedValue(undefined)) =>
  render(
    <ToastProvider>
      <TransactionDetail
        tx={t}
        categories={categories}
        allTags={['bali']}
        spentBy={null}
        onCategory={onCategory}
        onAddTag={vi.fn().mockResolvedValue(undefined)}
        onRemoveTag={vi.fn().mockResolvedValue(undefined)}
      />
    </ToastProvider>,
  )

test('category picker disabled when not categorisable', () => {
  detail(tx({ isCategorizable: false, categoryId: null, parentCategoryId: null }))
  expect(screen.getByLabelText('Category')).toBeDisabled()
  expect(screen.getByText("Up doesn't allow this transaction to be categorised.")).toBeInTheDocument()
})

test('tag editor blocks a 7th tag', () => {
  render(<TagEditor tags={['a', 'b', 'c', 'd', 'e', 'f']} suggestions={[]} onAdd={vi.fn()} onRemove={vi.fn()} />)
  expect(screen.getByLabelText('Add tag')).toBeDisabled()
  expect(screen.getByText('Up allows up to 6 tags per transaction.')).toBeInTheDocument()
})

test('tag editor adds and removes tags', async () => {
  const onAdd = vi.fn()
  const onRemove = vi.fn()
  render(<TagEditor tags={['bali']} suggestions={['bali', 'trip']} onAdd={onAdd} onRemove={onRemove} />)
  await userEvent.type(screen.getByLabelText('Add tag'), 'trip{Enter}')
  expect(onAdd).toHaveBeenCalledWith('trip')
  await userEvent.click(screen.getByRole('button', { name: 'Remove tag bali' }))
  expect(onRemove).toHaveBeenCalledWith('bali')
})

test('failed recategorise rolls back and toasts', async () => {
  const onCategory = vi.fn().mockRejectedValue(new ApiError(502, "Couldn't update Up", 'Nope'))
  detail(tx({}), onCategory)
  const select = screen.getByLabelText('Category')
  expect(select).toHaveValue('groceries')
  await userEvent.selectOptions(select, 'takeaway')
  expect(onCategory).toHaveBeenCalledWith('takeaway')
  expect(await screen.findByText("Couldn't update Up: Nope")).toBeInTheDocument()
  expect(select).toHaveValue('groceries')
})
