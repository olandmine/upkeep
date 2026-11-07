import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import type { TransactionDto } from '../../src/shared/types'
import { RecentTransactions } from '../../src/web/components/overview/RecentTransactions'
import { TransactionTable } from '../../src/web/components/transactions/TransactionTable'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { combineTransfers, isCombined } from '../../src/web/lib/combine-transfers'
import { groupByDay } from '../../src/web/lib/group-by-day'

const tx = (t: Partial<TransactionDto> & { id: string }): TransactionDto => ({
  accountId: 'spending',
  accountName: 'Spending',
  status: 'SETTLED',
  amountCents: -1000,
  currency: 'AUD',
  foreignAmountCents: null,
  foreignCurrency: null,
  description: 'Woolworths',
  message: null,
  rawText: null,
  categoryId: null,
  parentCategoryId: null,
  isCategorizable: true,
  roundUpCents: null,
  cashbackCents: null,
  cardMethod: null,
  cardSuffix: null,
  transferAccountId: null,
  isTransfer: false,
  performingCustomer: null,
  performedByUserId: null,
  createdAt: '2026-11-04T01:00:00.000Z',
  settledAt: null,
  deletedAt: null,
  tags: [],
  ...t,
})

const out = (over: Partial<TransactionDto> = {}) =>
  tx({ id: 'out', amountCents: -5000, description: 'Transfer to Rainy Day', transferAccountId: 'saver', isTransfer: true, isCategorizable: false, ...over })
const inc = (over: Partial<TransactionDto> = {}) =>
  tx({ id: 'in', accountId: 'saver', accountName: 'Rainy Day', amountCents: 5000, description: 'Transfer from Spending', transferAccountId: 'spending', isTransfer: true, isCategorizable: false, ...over })

let transactions: TransactionDto[]

beforeEach(() => {
  transactions = [tx({ id: 'shop' }), out(), inc()]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/transactions') return Response.json({ items: transactions, nextCursor: null })
      if (path === '/api/me') return Response.json({ id: 'u1', displayName: 'Owner' })
      if (path === '/api/plan-template' || path === '/api/pay-schedule') return Response.json(null)
      if (path.includes('/repayment') || path.includes('/budget-line')) return Response.json(null)
      return Response.json([])
    }),
  )
})

function renderTable() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <TransactionTable filters={{}} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const TRANSFER = /Spending to Rainy Day/

test('combineTransfers puts one row where the first side was, and leaves the rest alone', () => {
  const rows = combineTransfers([tx({ id: 'a' }), inc(), tx({ id: 'b' }), out(), tx({ id: 'c' })])
  expect(rows.map((r) => r.id)).toEqual(['a', 'transfer:out', 'b', 'c'])
  const row = rows[1]
  if (!isCombined(row)) throw new Error('expected a combined row')
  expect([row.from.id, row.to.id, row.amountCents]).toEqual(['out', 'in', 5000])
})

test('combineTransfers leaves a lone side as it is', () => {
  expect(combineTransfers([out()]).map((r) => r.id)).toEqual(['out'])
})

test('a combined row counts once in its day and leaves the daily net alone', () => {
  const groups = groupByDay(combineTransfers([tx({ id: 'shop', amountCents: -1000 }), out(), inc()]), 'Australia/Sydney')
  expect(groups).toHaveLength(1)
  expect(groups[0].items).toHaveLength(2)
  expect(groups[0].netCents).toBe(-1000)
})

test('sides either side of midnight stay together on the later day', () => {
  const groups = groupByDay(
    combineTransfers([out({ createdAt: '2026-11-04T13:00:00.000Z' }), inc({ createdAt: '2026-11-04T12:59:59.000Z' })]),
    'Australia/Sydney',
  )
  expect(groups.map((g) => [g.date, g.items.length])).toEqual([['2026-11-05', 1]])
})

test('the table shows a transfer as one row, closed', async () => {
  renderTable()
  const table = await screen.findByRole('table')
  const toggle = within(table).getByRole('button', { name: TRANSFER })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(within(table).queryByText('Transfer to Rainy Day')).not.toBeInTheDocument()
  expect(within(table).queryByText('Transfer from Spending')).not.toBeInTheDocument()
  expect(toggle.closest('tr')).toHaveTextContent('$50.00')
  expect(toggle.closest('tr')).toHaveTextContent('Transfer')
  expect(toggle.closest('tr')).not.toHaveTextContent('Uncategorised')
})

test('pressing the row once opens it, showing both sides with their signs, and again closes it', async () => {
  renderTable()
  const user = userEvent.setup()
  const table = await screen.findByRole('table')
  const toggle = within(table).getByRole('button', { name: TRANSFER })

  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const from = within(table).getByRole('button', { name: /Transfer to Rainy Day/ }).closest('tr')!
  const to = within(table).getByRole('button', { name: /Transfer from Spending/ }).closest('tr')!
  expect(from).toHaveTextContent('−$50.00')
  expect(to).toHaveTextContent('+$50.00')

  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(within(table).queryByText('Transfer to Rainy Day')).not.toBeInTheDocument()
})

test('clicking elsewhere on the row toggles it too', async () => {
  renderTable()
  const user = userEvent.setup()
  const table = await screen.findByRole('table')
  const toggle = within(table).getByRole('button', { name: TRANSFER })
  await user.click(within(toggle.closest('tr')!).getByText('Transfer'))
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
})

test('clicking a side opens its details and leaves the row open', async () => {
  renderTable()
  const user = userEvent.setup()
  const table = await screen.findByRole('table')
  const toggle = within(table).getByRole('button', { name: TRANSFER })
  await user.click(toggle)
  await user.click(within(table).getByRole('button', { name: /Transfer to Rainy Day/ }))

  expect(await screen.findByRole('dialog')).toHaveTextContent('Transfer to Rainy Day')
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
})

test('an ordinary row still opens its details straight away', async () => {
  renderTable()
  const user = userEvent.setup()
  const table = await screen.findByRole('table')
  await user.click(within(table).getByRole('button', { name: /Woolworths/ }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('Woolworths')
})

test('a lone side, like a Round Up, stays an ordinary row', async () => {
  transactions = [inc({ id: 'round-up', description: 'Round Up', amountCents: 40 })]
  renderTable()
  const table = await screen.findByRole('table')
  expect(within(table).getByRole('button', { name: /Round Up/ })).not.toHaveAttribute('aria-expanded')
})

test('a transfer with a pending side shows as Pending', async () => {
  transactions = [out({ status: 'HELD' }), inc()]
  renderTable()
  const table = await screen.findByRole('table')
  expect(within(table).getByRole('button', { name: TRANSFER }).closest('tr')).toHaveTextContent('Pending')
})

test('a note on either side shows on the combined row', async () => {
  transactions = [out(), inc({ message: 'For the holiday' })]
  renderTable()
  const table = await screen.findByRole('table')
  expect(within(table).getByRole('button', { name: TRANSFER })).toHaveTextContent('For the holiday')
})

test('the phone list combines and opens the same way', async () => {
  renderTable()
  const user = userEvent.setup()
  await screen.findByRole('table')
  const list = screen.getAllByRole('list').find((l) => within(l).queryByRole('button', { name: TRANSFER }))!
  const toggle = within(list).getByRole('button', { name: TRANSFER })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await user.click(within(list).getByRole('button', { name: /Transfer from Spending/ }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('Transfer from Spending')
})

test('Overview shows one row for a transfer, with no dropdown', () => {
  render(<RecentTransactions items={[tx({ id: 'shop' }), out(), inc()]} categories={[]} />)
  const rows = screen.getAllByRole('listitem')
  expect(rows).toHaveLength(2)
  expect(rows[1]).toHaveTextContent('$50.00')
  expect(within(rows[1]).getByText('Spending')).toBeInTheDocument()
  expect(within(rows[1]).getByText('Rainy Day')).toBeInTheDocument()
  expect(within(rows[1]).queryByRole('button')).not.toBeInTheDocument()
  expect(rows[1]).not.toHaveTextContent('Uncategorised')
})
