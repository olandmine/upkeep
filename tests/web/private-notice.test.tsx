import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SharedData, SharingLevel } from '../../src/shared/sharing'
import type { AccountDto, BudgetDto, DebtDetailDto, OverviewDto, Scope, UserDto } from '../../src/shared/types'
import { PrivateNotice } from '../../src/web/components/sharing/PrivateNotice'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { sharingMessage } from '../../src/web/lib/sharing'
import { Route as AccountRoute } from '../../src/web/routes/_app.accounts.$accountId'
import { Route as AccountsRoute } from '../../src/web/routes/_app.accounts.index'
import { Route as BudgetsRoute } from '../../src/web/routes/_app.budgets'
import { Route as DebtRoute } from '../../src/web/routes/_app.debts.$debtId'
import { Route as DebtsRoute } from '../../src/web/routes/_app.debts.index'
import { Route as GoalsRoute } from '../../src/web/routes/_app.goals.index'
import { Route as OverviewRoute } from '../../src/web/routes/_app.index'
import { Route as NetWorthRoute } from '../../src/web/routes/_app.net-worth'
import { Route as TransactionsRoute } from '../../src/web/routes/_app.transactions'

const router = vi.hoisted(() => ({ search: {} as Record<string, unknown>, params: {} as Record<string, string> }))

// The routes' data and what they show, without a router or the page's sidebar around them.
vi.mock('@tanstack/react-router', async (actual) => ({
  ...(await actual<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (options: object) => ({
    options,
    fullPath: '/x',
    useSearch: () => router.search,
    useParams: () => router.params,
  }),
  useSearch: () => router.search,
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
vi.mock('../../src/web/components/payflow/PayFlowCard', () => ({ PayFlowCard: () => <p>Pay flow card</p> }))

const user = (id: string, name: string, sharingLevel: SharingLevel | null): UserDto => ({
  id,
  username: name.toLowerCase(),
  displayName: name,
  upDisplayName: null,
  negativeStyle: 'minus',
  accent: 'amber',
  connectUpAnswered: true,
  gettingStartedHidden: true,
  sharingLevel,
})

const MESSAGES: Record<string, string> = {
  'hide-transactions': 'Sam keeps their transactions private.',
  balances: 'Sam shares account balances only.',
  none: "Sam doesn't share their personal accounts.",
  null: "Sam hasn't chosen what to share yet.",
}

const overview: OverviewDto = {
  totalBalanceCents: 100_000,
  homeLoanCents: null,
  month: { spentCents: 0, incomeCents: 0, netCents: 0 },
  previousMonth: { spentCents: 0, incomeCents: 0, netCents: 0 },
  balancesByAccount: [],
  spendingByParent: [],
  topCategories: [],
  monthly: [],
  recent: [],
}

const account = (over: Partial<AccountDto> = {}): AccountDto => ({
  id: 'a1',
  displayName: 'Everyday',
  accountType: 'TRANSACTIONAL',
  ownership: 'INDIVIDUAL',
  ownerUserId: 'u2',
  ownerName: 'Sam',
  balanceCents: 5_000,
  currency: 'AUD',
  colorIndex: 0,
  ...over,
})

let level: SharingLevel | null
let requests: string[]
let responses: Record<string, () => Response>

beforeEach(() => {
  level = 'full'
  router.search = {}
  router.params = {}
  requests = []
  responses = {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const path = url.pathname + url.search
      requests.push(path)
      if (responses[path]) return responses[path]()
      if (path === '/api/me') return Response.json(user('u1', 'Owner', 'full'))
      if (path === '/api/users') return Response.json([user('u1', 'Owner', 'full'), user('u2', 'Sam', level)])
      if (path === '/api/sync/status')
        return Response.json({ connections: [{ userId: 'u1', displayName: 'Owner', status: 'ok', running: null }] })
      if (path.startsWith('/api/overview')) return Response.json(overview)
      if (path.startsWith('/api/transactions')) return Response.json({ items: [], nextCursor: null })
      if (path.startsWith('/api/goals?')) return Response.json({ goals: [], archived: [] })
      if (/^\/api\/(accounts|debts)\?/.test(path))
        return Response.json([])
      return Response.json({ error: 'Not found' }, { status: 404 })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function mount(Component: ComponentType) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Component />
      </ToastProvider>
    </QueryClientProvider>,
  )
}
const mountPage = (route: { options: object }) => mount((route.options as { component: ComponentType }).component)
const notices = () => screen.queryAllByRole('status')
/** Long enough for the requests a page makes to land, so "nothing shown" isn't just "not yet". */
const settle = async () => {
  await waitFor(() => expect(requests).toContain('/api/users'))
  await new Promise((r) => setTimeout(r, 30))
}

describe('sharingMessage', () => {
  test('is the exact message for each level, and nothing for full', () => {
    expect(sharingMessage('full', 'Sam')).toBeNull()
    expect(sharingMessage('hide-transactions', 'Sam')).toBe(MESSAGES['hide-transactions'])
    expect(sharingMessage('balances', 'Sam')).toBe(MESSAGES.balances)
    expect(sharingMessage('none', 'Sam')).toBe(MESSAGES.none)
    expect(sharingMessage(null, 'Sam')).toBe(MESSAGES.null)
  })
})

describe('PrivateNotice', () => {
  const cases: [SharingLevel | null, SharedData[], SharedData[]][] = [
    ['full', [], ['balances', 'finances', 'transactions']],
    ['hide-transactions', ['transactions'], ['balances', 'finances']],
    ['balances', ['finances', 'transactions'], ['balances']],
    ['none', ['balances', 'finances', 'transactions'], []],
    [null, ['balances', 'finances', 'transactions'], []],
  ]
  for (const [lvl, hidden, allowed] of cases) {
    test(`at ${lvl}: shows for ${hidden.join(', ') || 'nothing'}, silent for ${allowed.join(', ') || 'nothing'}`, async () => {
      level = lvl
      for (const needs of hidden) {
        const { unmount } = mount(() => <PrivateNotice needs={needs} scope="everyone" />)
        expect(await screen.findByRole('status')).toHaveTextContent(MESSAGES[String(lvl)])
        unmount()
      }
      for (const needs of allowed) {
        requests = []
        const { unmount } = mount(() => <PrivateNotice needs={needs} scope="everyone" />)
        await settle()
        expect(notices()).toHaveLength(0)
        unmount()
      }
    })
  }

  test.each<Scope>(['me', 'joint'])('shows nothing in %s scope', async (scope) => {
    level = 'none'
    mount(() => <PrivateNotice needs="finances" scope={scope} />)
    await settle()
    expect(notices()).toHaveLength(0)
  })

  test.each<Scope | undefined>(['partner', undefined])('shows in %s scope', async (scope) => {
    level = 'none'
    mount(() => <PrivateNotice needs="finances" scope={scope} />)
    expect(await screen.findByRole('status')).toHaveTextContent(MESSAGES.none)
  })

  test('shows nothing with no partner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/api/me')
          ? Response.json(user('u1', 'Owner', 'none'))
          : Response.json([user('u1', 'Owner', 'none')]),
      ),
    )
    mount(() => <PrivateNotice needs="finances" scope="everyone" />)
    await new Promise((r) => setTimeout(r, 30))
    expect(notices()).toHaveLength(0)
  })
})

describe('pages', () => {
  test.each([
    ['Accounts', AccountsRoute, 'none'],
    ['Net worth', NetWorthRoute, 'balances'],
    ['Goals', GoalsRoute, 'balances'],
    ['Debts', DebtsRoute, 'balances'],
  ] as const)('%s tells you what is hidden', async (_name, route, lvl) => {
    level = lvl
    mountPage(route)
    expect(await screen.findByRole('status')).toHaveTextContent(MESSAGES[lvl])
  })

  test('Accounts is silent when balances are shared', async () => {
    level = 'balances'
    mountPage(AccountsRoute)
    await settle()
    expect(notices()).toHaveLength(0)
  })

  test('Overview shows one notice at each level', async () => {
    for (const lvl of ['balances', 'hide-transactions'] as const) {
      level = lvl
      const { unmount } = mountPage(OverviewRoute)
      await screen.findByText(MESSAGES[lvl])
      await new Promise((r) => setTimeout(r, 30))
      expect(screen.getAllByText(MESSAGES[lvl])).toHaveLength(1)
      expect(notices()).toHaveLength(1)
      unmount()
    }
  })

  test('Overview puts the transactions notice above the recent list', async () => {
    level = 'hide-transactions'
    mountPage(OverviewRoute)
    const notice = await screen.findByRole('status')
    const recent = screen.getByRole('region', { name: 'Recent transactions' })
    expect(notice.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('Transactions shows the notice on Household and not on Joint', async () => {
    level = 'hide-transactions'
    const { unmount } = mountPage(TransactionsRoute)
    expect(await screen.findByRole('status')).toHaveTextContent(MESSAGES['hide-transactions'])
    unmount()
    router.search = { scope: 'joint' }
    requests = []
    mountPage(TransactionsRoute)
    await settle()
    expect(notices()).toHaveLength(0)
  })
})

describe('hidden content is replaced, not shown as empty', () => {
  const pages = [
    ['Accounts', AccountsRoute, "Your partner hasn't connected Up yet."],
    ['Goals', GoalsRoute, 'No Savers here yet. Goals sit on Up Savers.'],
    ['Debts', DebtsRoute, 'No debts yet. Add one to see when it’ll be paid off.'],
    ['Transactions', TransactionsRoute, 'No transactions match these filters.'],
  ] as const

  describe.each(pages)('%s', (name, route, empty) => {
    test('in Partner scope the notice replaces the content', async () => {
      level = 'none'
      router.search = { scope: 'partner' }
      mountPage(route)
      expect(await screen.findByRole('status')).toHaveTextContent(MESSAGES.none)
      await settle()
      expect(screen.queryByText(empty)).not.toBeInTheDocument()
      if (name === 'Transactions') {
        expect(requests.filter((r) => r.startsWith('/api/transactions'))).toEqual([])
        expect(screen.queryByLabelText('Search transactions')).not.toBeInTheDocument()
      }
      if (name === 'Debts') expect(screen.queryByRole('button', { name: 'Add debt' })).not.toBeInTheDocument()
    })

    test('in Household scope an empty list shows the notice and no empty state', async () => {
      level = 'none'
      mountPage(route)
      expect(await screen.findByRole('status')).toHaveTextContent(MESSAGES.none)
      await settle()
      expect(screen.queryByText(empty)).not.toBeInTheDocument()
    })

    test('at full, Partner scope still shows the empty state', async () => {
      level = 'full'
      router.search = { scope: 'partner' }
      mountPage(route)
      expect(await screen.findByText(empty)).toBeInTheDocument()
      expect(notices()).toHaveLength(0)
    })
  })
})

test('Accounts in Household scope shows no empty state under the notice', async () => {
  level = 'none'
  mountPage(AccountsRoute)
  expect(await screen.findByRole('status')).toHaveTextContent(MESSAGES.none)
  await settle()
  expect(screen.queryByText('No accounts here yet.')).not.toBeInTheDocument()
})

describe('Overview in Partner scope', () => {
  const netWorth = { points: [], historyFrom: null, todayCents: 123_400, changeCents: 0 }
  const SPENDING = ['Spent this month', 'Income this month', 'Net this month', 'Pay flow card', 'Income vs spending', 'Spending this month']

  const mountOverview = async (lvl: SharingLevel | null) => {
    level = lvl
    router.search = { scope: 'partner' }
    responses['/api/net-worth?scope=partner&range=6m'] = () => Response.json(netWorth)
    const view = mountPage(OverviewRoute)
    await waitFor(() => expect(notices().length).toBeGreaterThan(0))
    await settle()
    return view
  }

  test.each(['none', null] as const)('at %s the notice replaces everything', async (lvl) => {
    await mountOverview(lvl)
    expect(notices()).toHaveLength(1)
    expect(notices()[0]).toHaveTextContent(MESSAGES[String(lvl)])
    for (const text of ['Total balance', 'Balance by account', 'View net worth ›', 'Recent transactions', ...SPENDING]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument()
    }
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument()
  })

  test('at balances, balances stay and one notice replaces the spending', async () => {
    await mountOverview('balances')
    expect(notices()).toHaveLength(1)
    expect(notices()[0]).toHaveTextContent(MESSAGES.balances)
    for (const text of ['Total balance', 'Balance by account', 'View net worth ›']) {
      expect(await screen.findByText(text)).toBeInTheDocument()
    }
    for (const text of ['Recent transactions', ...SPENDING]) expect(screen.queryByText(text)).not.toBeInTheDocument()
  })

  test('at hide-transactions, the totals stay and the notice takes the recent list\'s place', async () => {
    await mountOverview('hide-transactions')
    expect(notices()).toHaveLength(1)
    expect(notices()[0]).toHaveTextContent(MESSAGES['hide-transactions'])
    for (const text of ['Total balance', 'Pay flow card', 'Spent this month', 'Income vs spending']) {
      expect(await screen.findByText(text)).toBeInTheDocument()
    }
    expect(screen.queryByText('No transactions yet.')).not.toBeInTheDocument()
  })

  test('at full, it all shows with no notice', async () => {
    level = 'full'
    router.search = { scope: 'partner' }
    mountPage(OverviewRoute)
    for (const text of ['Total balance', 'Pay flow card', 'Spent this month', 'Recent transactions']) {
      expect(await screen.findByText(text)).toBeInTheDocument()
    }
    expect(notices()).toHaveLength(0)
  })

  test('Household scope still shows everything under the notice', async () => {
    level = 'none'
    mountPage(OverviewRoute)
    expect(await screen.findByRole('status')).toHaveTextContent(MESSAGES.none)
    for (const text of ['Total balance', 'Pay flow card', 'Spent this month', 'Recent transactions']) {
      expect(await screen.findByText(text)).toBeInTheDocument()
    }
    expect(notices()).toHaveLength(1)
  })
})

describe('Net worth in Partner scope', () => {
  const netWorth = {
    points: [
      { date: '2026-09-01', upCents: 100, debtCents: 0, netCents: 100 },
      { date: '2026-10-01', upCents: 200, debtCents: 0, netCents: 200 },
    ],
    historyFrom: null,
    todayCents: 200,
    changeCents: 100,
  }
  const mountNetWorth = async (lvl: SharingLevel | null) => {
    level = lvl
    router.search = { scope: 'partner' }
    responses['/api/net-worth?scope=partner&range=6m'] = () => Response.json(netWorth)
    mountPage(NetWorthRoute)
    await waitFor(() => expect(notices().length).toBeGreaterThan(0))
    await settle()
  }

  test.each(['none', null] as const)('at %s the notice replaces the content', async (lvl) => {
    await mountNetWorth(lvl)
    expect(notices()).toHaveLength(1)
    expect(notices()[0]).toHaveTextContent(MESSAGES[String(lvl)])
    expect(screen.queryByRole('group', { name: 'Range' })).not.toBeInTheDocument()
    expect(screen.queryByText('Net worth')).not.toBeInTheDocument()
  })

  test('at none, a failed request says nothing either', async () => {
    level = 'none'
    router.search = { scope: 'partner' }
    mountPage(NetWorthRoute)
    expect(await screen.findByRole('status')).toHaveTextContent(MESSAGES.none)
    await settle()
    expect(screen.queryByText("Couldn't load net worth.")).not.toBeInTheDocument()
  })

  test('at balances, the chart stays with the notice above it', async () => {
    await mountNetWorth('balances')
    const range = await screen.findByRole('group', { name: 'Range' })
    expect(notices()).toHaveLength(1)
    expect(notices()[0].compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('Household scope keeps the content at none', async () => {
    level = 'none'
    responses['/api/net-worth?scope=everyone&range=6m'] = () => Response.json(netWorth)
    mountPage(NetWorthRoute)
    expect(await screen.findByRole('group', { name: 'Range' })).toBeInTheDocument()
    expect(notices()).toHaveLength(1)
  })
})

describe('account page', () => {
  test("shows the notice where the list would be for the partner's account", async () => {
    level = 'hide-transactions'
    router.params = { accountId: 'a1' }
    responses['/api/accounts/a1'] = () => Response.json(account())
    mountPage(AccountRoute)
    expect(await screen.findByRole('status')).toHaveTextContent(MESSAGES['hide-transactions'])
    expect(requests.some((r) => r.startsWith('/api/transactions'))).toBe(false)
  })

  test('a joint account page shows no notice', async () => {
    level = 'none'
    router.params = { accountId: 'a1' }
    responses['/api/accounts/a1'] = () => Response.json(account({ ownership: 'JOINT', ownerUserId: null, ownerName: null }))
    mountPage(AccountRoute)
    await screen.findByText('Balance')
    await settle()
    expect(notices()).toHaveLength(0)
  })

  test('your own account page shows no notice', async () => {
    level = 'none'
    router.params = { accountId: 'a1' }
    responses['/api/accounts/a1'] = () => Response.json(account({ ownerUserId: 'u1', ownerName: 'Owner' }))
    mountPage(AccountRoute)
    await screen.findByText('Balance')
    await settle()
    expect(notices()).toHaveLength(0)
  })

  describe('when the sharing level can\'t be read', () => {
    const fails = () => Response.json({ error: 'Nope' }, { status: 403 })
    const empty = 'No transactions in this account yet.'
    const shows = (over: Partial<AccountDto>) => {
      router.params = { accountId: 'a1' }
      responses['/api/accounts/a1'] = () => Response.json(account(over))
      mountPage(AccountRoute)
    }
    const JOINT = { ownership: 'JOINT', ownerUserId: null, ownerName: null } as const

    test.each(['/api/users', '/api/me'])('a joint account still lists its transactions when %s fails', async (path) => {
      responses[path] = fails
      shows(JOINT)
      expect(await screen.findByText(empty)).toBeInTheDocument()
    })

    test('your own account still lists its transactions when /api/users fails', async () => {
      responses['/api/users'] = fails
      shows({ ownerUserId: 'u1', ownerName: 'Owner' })
      expect(await screen.findByText(empty)).toBeInTheDocument()
    })

    test('a personal account still lists its transactions when /api/me fails', async () => {
      responses['/api/me'] = fails
      shows({ ownerUserId: 'u1', ownerName: 'Owner' })
      expect(await screen.findByText(empty)).toBeInTheDocument()
    })

    test("the partner's account waits for their level, and says nothing untrue meanwhile", async () => {
      responses['/api/users'] = fails
      shows({})
      await screen.findByText('Balance')
      await settle()
      expect(requests.some((r) => r.startsWith('/api/transactions'))).toBe(false)
      expect(screen.queryByText(empty)).not.toBeInTheDocument()
    })
  })

  test('a hidden account (404) keeps the not-found message', async () => {
    level = 'none'
    router.params = { accountId: 'a1' }
    mountPage(AccountRoute)
    expect(await screen.findByText("Couldn't load this account.")).toBeInTheDocument()
  })
})

describe('debt page', () => {
  const debt = (ownerUserId: string | null) =>
    ({
      id: 'd1',
      name: 'Car loan',
      kind: 'loan',
      ownerUserId,
      ownerName: 'Sam',
      rateBp: 0,
      interest: { charge: null },
      repaymentCents: 0,
      repaymentFrequency: 'monthly',
      fee: null,
      repaymentRules: [],
      balanceCents: 1000,
      balances: [],
      rates: [],
      activity: [],
      exclusions: [],
      timeline: [],
      projection: null,
      canEdit: false,
      estimated: false,
    }) as unknown as DebtDetailDto

  test('a hidden debt (404) keeps the not-found message', async () => {
    level = 'none'
    router.params = { debtId: 'd1' }
    mountPage(DebtRoute)
    expect(await screen.findByText("Couldn't load this debt.")).toBeInTheDocument()
  })

  test("shows the notice above Activity for the partner's debt, not your own", async () => {
    level = 'hide-transactions'
    router.params = { debtId: 'd1' }
    responses['/api/debts/d1'] = () => Response.json(debt('u2'))
    const { unmount } = mountPage(DebtRoute)
    const notice = await screen.findByRole('status')
    const activity = screen.getByRole('heading', { name: 'Activity' })
    expect(notice.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    unmount()
    responses['/api/debts/d1'] = () => Response.json(debt('u1'))
    mountPage(DebtRoute)
    await screen.findByRole('heading', { name: 'Activity' })
    expect(notices()).toHaveLength(0)
  })

  test.each(['hide-transactions', 'balances', 'none', null] as const)(
    'a joint debt shows the notice above Activity at %s',
    async (lvl) => {
      level = lvl
      router.params = { debtId: 'd1' }
      responses['/api/debts/d1'] = () => Response.json(debt(null))
      mountPage(DebtRoute)
      const notice = await screen.findByRole('status')
      expect(notice).toHaveTextContent(MESSAGES[String(lvl)])
      const activity = screen.getByRole('heading', { name: 'Activity' })
      expect(notice.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    },
  )

  test('a joint debt shows no notice at full', async () => {
    level = 'full'
    router.params = { debtId: 'd1' }
    responses['/api/debts/d1'] = () => Response.json(debt(null))
    mountPage(DebtRoute)
    await screen.findByRole('heading', { name: 'Activity' })
    await settle()
    expect(notices()).toHaveLength(0)
  })
})

describe('budgets', () => {
  const mine: BudgetDto = { id: 'b1', kind: 'personal', ownerUserId: 'u1', name: 'Mine', anchorUserId: null, hasPeriods: true, canEdit: true, setup: 'ready' }

  test('the partner pill stays and shows the notice when their budget is hidden', async () => {
    level = 'none'
    router.search = { person: 'u2' }
    responses['/api/budgets'] = () => Response.json([mine])
    mountPage(BudgetsRoute)
    expect(await screen.findByRole('status')).toHaveTextContent(MESSAGES.none)
    expect(screen.getByRole('button', { name: "Sam's pay" })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Your pay' })).toBeInTheDocument()
    expect(requests.filter((r) => /\/period|\/api\/plans|standard-pay/.test(r))).toEqual([])
    expect(screen.queryByText(/hasn't marked their pay yet/)).not.toBeInTheDocument()
  })

  test('your own pay shows no notice', async () => {
    level = 'none'
    responses['/api/budgets'] = () => Response.json([mine])
    mountPage(BudgetsRoute)
    await screen.findByRole('button', { name: "Sam's pay" })
    await new Promise((r) => setTimeout(r, 30))
    expect(notices()).toHaveLength(0)
  })
})
