import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DebtBalancePoint, DebtDto, PayoffPlanDto } from '../../src/shared/types'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { Route } from '../../src/web/routes/_app.debts.index'

// The route's data and what it shows, without a router or the page's sidebar around it.
vi.mock('@tanstack/react-router', async (actual) => ({
  ...(await actual<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (options: object) => ({ options, fullPath: '/debts' }),
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
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

const debt: DebtDto = {
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
  repaymentRules: [],
  balanceCents: 820_000,
  accruingCents: 0,
  nextChargeOn: '2026-11-15',
  firstBalance: { asOf: '2026-10-01', balanceCents: 900_000 },
  paidOffOn: null,
  projection: { payoffDate: '2028-03-01', totalInterestCents: 52_000, shortfallCents: null },
  estimated: false,
  canEdit: true,
}

const plan: PayoffPlanDto = {
  extraCents: 0,
  includeHecs: false,
  canEdit: true,
  scenarios: (['as-is', 'avalanche', 'snowball'] as const).map((strategy) => ({
    strategy,
    debtFreeMonth: '2028-03',
    totalInterestCents: 52_000,
    debts: [{ id: 'd1', name: 'Car loan', payoffMonth: '2028-03' }],
    series: [{ month: '2026-11', totalCents: 820_000 }],
  })),
  differences: [],
}

let debts: DebtDto[]
let requests: string[]
let timeline: DebtBalancePoint[]

beforeEach(() => {
  debts = [debt]
  requests = []
  timeline = [
    { date: '2026-10-01', balanceCents: 900_000 },
    { date: '2026-10-30', balanceCents: 820_000 },
  ]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const path = url.pathname + url.search
      requests.push(path)
      if (path === '/api/me') return Response.json({ id: 'u1', displayName: 'Owner' })
      if (path === '/api/debts?scope=everyone') return Response.json(debts)
      if (path.startsWith('/api/debts/timeline?scope=everyone')) return Response.json(timeline)
      if (path === '/api/payoff-plan?scope=everyone') return Response.json(plan)
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
}

test('total balance chart sits above the payoff plan', async () => {
  mount()
  const chart = await screen.findByRole('img', { name: 'Total debt balance over time' })
  const plan = await screen.findByText('Payoff plan')
  expect(chart.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('no total chart without debts', async () => {
  debts = []
  timeline = []
  mount()
  await screen.findByText(/No debts yet/)
  expect(screen.queryByRole('img', { name: 'Total debt balance over time' })).not.toBeInTheDocument()
})

test('the total chart starts at All and switches range', async () => {
  mount()
  const group = within(await screen.findByRole('group', { name: 'Range' }))
  expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(['1W', '1M', '1Y', 'FY', 'All'])
  expect(group.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  expect(requests).toContain('/api/debts/timeline?scope=everyone&range=all')

  await userEvent.click(group.getByRole('button', { name: 'FY' }))
  await waitFor(() => expect(requests).toContain('/api/debts/timeline?scope=everyone&range=fy'))
  expect(group.getByRole('button', { name: 'FY' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('img', { name: 'Total debt balance over time' })).toBeInTheDocument()
})
