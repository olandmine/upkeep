import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType, ReactNode } from 'react'
import { act } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { BudgetDto, StandardPayDto } from '../../src/shared/types'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { Route } from '../../src/web/routes/_app.budgets'
import { account, example, item, line, period, plan, saverItem } from './pay-fixtures'

const search = vi.hoisted(() => ({ current: {} as { person?: string; date?: string; view?: 'standard' } }))
const navigate = vi.hoisted(() => vi.fn())

// The route's data and what it shows, without a router or the page's sidebar around it.
vi.mock('@tanstack/react-router', async (actual) => ({
  ...(await actual<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (options: object) => ({ options, fullPath: '/budgets', useSearch: () => search.current }),
  useNavigate: () => navigate,
  Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
}))
vi.mock('../../src/web/components/shell/PageHeader', () => ({
  Page: ({ actions, children }: { actions?: ReactNode; children: ReactNode }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
}))

const budgets: BudgetDto[] = [
  { id: 'b1', kind: 'personal', ownerUserId: 'u1', name: 'Mine', anchorUserId: null, hasPeriods: true, canEdit: true, setup: 'ready' },
  { id: 'j1', kind: 'joint', ownerUserId: null, name: 'Joint', anchorUserId: 'u2', hasPeriods: true, canEdit: true, setup: 'ready' },
]
const jointPeriod = period({ budgetId: 'j1', start: '2026-11-02', nominalEnd: '2026-11-16', lines: [line('shop', { name: 'Shop', amountCents: 30_000 })] })

/** Every-pay amounts that differ from This pay's, so the two views can be told apart. */
const standardPay = (over: Partial<StandardPayDto> = {}): StandardPayDto => ({
  plan: plan([item({ id: 'item-g', targetKind: 'line', lineId: 'groceries', amountCents: 40_000 })]),
  period: period({ isCurrent: false, lines: [line('groceries', { name: 'Groceries', amountCents: 40_000, spentCents: 30_000 })] }),
  jointPeriod: null,
  payCount: 6,
  hasUsual: true,
  jointHasUsual: false,
  payIsMedian: true,
  ...over,
})

let requests: string[]
let personalPeriod: () => Response
let standardResponse: () => Response | Promise<Response>
let planResponse: () => Response
let accountsResponse: () => Response
let budgetsResponse: () => Response

beforeEach(() => {
  search.current = {}
  navigate.mockClear()
  requests = []
  personalPeriod = () => Response.json(example().period)
  standardResponse = () => Response.json(standardPay())
  planResponse = () => Response.json(plan([]))
  accountsResponse = () => Response.json([])
  budgetsResponse = () => Response.json(budgets)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const path = url.pathname + url.search
      requests.push(path)
      if (path === '/api/me') return Response.json({ id: 'u1', displayName: 'Owner' })
      if (path === '/api/budgets') return budgetsResponse()
      if (path.startsWith('/api/accounts')) return accountsResponse()
      if (path.startsWith('/api/budgets/b1/period')) return personalPeriod()
      if (path.startsWith('/api/budgets/j1/period')) return Response.json(jointPeriod)
      if (path === '/api/budgets/standard-pay/u1') return standardResponse()
      if (path.startsWith('/api/plans/')) return planResponse()
      return Response.json([])
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  const Page = Route.options.component as ComponentType
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Page />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

const jointRequests = () => requests.filter((r) => r.startsWith('/api/budgets/j1/period'))

test('on the current pay, Shared limits load the joint period running today', async () => {
  mount()
  expect(await screen.findByRole('region', { name: 'Shared spending limits' })).toHaveTextContent('Shop')
  expect(jointRequests()).toEqual(['/api/budgets/j1/period'])
})

test("on a past pay, Shared limits load the joint period containing that pay's start, read-only", async () => {
  search.current = { date: '2026-10-20' }
  personalPeriod = () =>
    Response.json(period({ ...example().period, start: '2026-10-16', nominalEnd: '2026-10-30', end: '2026-10-30', isCurrent: false }))
  mount()
  expect(await screen.findByRole('region', { name: 'Shared spending limits' })).toHaveTextContent('Shop')
  expect(jointRequests()).toEqual(['/api/budgets/j1/period?date=2026-10-16'])
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
})

test('a pay with no period says there are none yet', async () => {
  personalPeriod = () => Response.json({ error: 'No pay periods yet' }, { status: 404 })
  mount()
  expect(await screen.findByText('No pay periods yet.')).toBeInTheDocument()
})

test('a failed refetch keeps the pay on screen and never says there are no pay periods', async () => {
  const queryClient = mount()
  const summary = await screen.findByRole('group', { name: 'Left to spend' })
  personalPeriod = () => Response.json({ error: 'Down' }, { status: 500 })
  await act(() => queryClient.invalidateQueries({ queryKey: ['budget-period', 'b1'] }))
  await waitFor(() => expect(queryClient.getQueryState(['budget-period', 'b1', 'current'])?.status).toBe('error'))
  expect(summary).toBeInTheDocument()
  expect(screen.queryByText('No pay periods yet.')).not.toBeInTheDocument()
})

const toggle = () => screen.queryByRole('group', { name: 'Which pay to show' })

test('view=standard shows Standard pay and hides the period arrows', async () => {
  search.current = { view: 'standard' }
  mount()
  expect(await screen.findByText('Based on your last 6 finished pays')).toBeInTheDocument()
  expect(await screen.findByText('Usually left over')).toBeInTheDocument()
  expect(within(toggle()!).getByRole('button', { name: 'Standard pay' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: 'Previous period' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Next period' })).not.toBeInTheDocument()
})

test("Standard pay shows every-pay amounts, not this pay's", async () => {
  search.current = { view: 'standard' }
  personalPeriod = () =>
    Response.json(period({ lines: [line('groceries', { name: 'Groceries', amountCents: 50_000, spentCents: 10_000 })] }))
  mount()
  const row = (await screen.findByText('Groceries')).closest('a')!
  expect(row).toHaveTextContent('$400.00')
  expect(row).not.toHaveTextContent('$500.00')
  expect(screen.queryByText(/Was/)).not.toBeInTheDocument()
})

test('no toggle when the endpoint returns null', async () => {
  standardResponse = () => Response.json(null)
  mount()
  await screen.findByRole('group', { name: 'Left to spend' })
  expect(toggle()).not.toBeInTheDocument()
})

test('view=standard then shows This pay', async () => {
  search.current = { view: 'standard' }
  standardResponse = () => Response.json(null)
  mount()
  expect(await screen.findByRole('group', { name: 'Left to spend' })).toBeInTheDocument()
  expect(toggle()).not.toBeInTheDocument()
  expect(screen.queryByText('Usually left over')).not.toBeInTheDocument()
})

test('the toggle is plain text while editing', async () => {
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  const group = toggle()!
  expect(within(group).queryByRole('button')).not.toBeInTheDocument()
  expect(group).toHaveTextContent('This pay')
})

test('loading shows the loading message', async () => {
  search.current = { view: 'standard' }
  standardResponse = () => new Promise<Response>(() => {})
  mount()
  expect(await screen.findByText('Loading this pay…')).toBeInTheDocument()
})

test('a failed request shows the error card', async () => {
  search.current = { view: 'standard' }
  standardResponse = () => Response.json({ error: 'Down' }, { status: 500 })
  mount()
  expect(await screen.findByText(/Couldn't load this pay/)).toBeInTheDocument()
})

test('an invalid view value is ignored', () => {
  const validate = Route.options.validateSearch as (s: Record<string, unknown>) => Record<string, unknown>
  expect(validate({ view: 'x' }).view).toBeUndefined()
  expect(validate({ view: 'standard' }).view).toBe('standard')
})

test('date stays in the search when switching', () => {
  const validate = Route.options.validateSearch as (s: Record<string, unknown>) => Record<string, unknown>
  expect(validate({ view: 'standard', date: '2026-10-01' })).toMatchObject({ view: 'standard', date: '2026-10-01' })
})

test('applying refreshes Standard pay', async () => {
  search.current = { view: 'standard' }
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  const amount = await screen.findByLabelText('Groceries amount in dollars')
  await user.clear(amount)
  await user.type(amount, '450')
  const before = requests.filter((r) => r.startsWith('/api/budgets/standard-pay')).length
  await user.click(screen.getByRole('button', { name: 'Apply to every pay' }))
  await waitFor(() => expect(requests.filter((r) => r.startsWith('/api/budgets/standard-pay')).length).toBeGreaterThan(before))
})

/** What the last navigate call turns the current search into. */
const navigatedTo = (prev: object) => (navigate.mock.lastCall![0] as { search: (p: object) => object }).search(prev)

test('a failed Standard pay request still offers This pay', async () => {
  search.current = { view: 'standard', date: '2026-10-01' }
  standardResponse = () => Response.json({ error: 'Down' }, { status: 500 })
  mount()
  expect(await screen.findByText(/Couldn't load this pay/)).toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(within(toggle()!).getByRole('button', { name: 'This pay' }))
  expect(navigatedTo({ view: 'standard', date: '2026-10-01' })).toEqual({ view: undefined, date: '2026-10-01' })
})

test('pressing Standard pay sets view and keeps date', async () => {
  search.current = { date: '2026-10-01' }
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Standard pay' }))
  expect(navigatedTo({ date: '2026-10-01' })).toEqual({ view: 'standard', date: '2026-10-01' })
})

test("a Saver only in this pay's plan is unavailable for a limit in Standard pay", async () => {
  search.current = { view: 'standard' }
  accountsResponse = () => Response.json([account('car', 'INDIVIDUAL')])
  planResponse = () => Response.json(plan([saverItem('car', 5_000)]))
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.click(await screen.findByRole('button', { name: 'More about Groceries' }))
  expect(await screen.findByRole('option', { name: "car Saver (In this pay's plan)" })).toBeDisabled()
})

test('the Standard pay caption is hidden while the Joint wizard is open', async () => {
  search.current = { view: 'standard' }
  budgetsResponse = () => Response.json(budgets.map((b) => (b.kind === 'joint' ? { ...b, setup: 'needs-pay' } : b)))
  mount()
  const user = userEvent.setup()
  expect(await screen.findByText('Based on your last 6 finished pays')).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Set up Joint' }))
  await waitFor(() => expect(screen.queryByText('Based on your last 6 finished pays')).not.toBeInTheDocument())
})

test("a failed This pay plan doesn't replace a loaded Standard pay", async () => {
  search.current = { view: 'standard' }
  planResponse = () => Response.json({ error: 'Down' }, { status: 500 })
  mount()
  expect(await screen.findByText('Usually left over')).toBeInTheDocument()
  expect(screen.queryByText(/Couldn't load this pay/)).not.toBeInTheDocument()
})
