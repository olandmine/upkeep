import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { GoalDetailDto, GoalDto, UserDto } from '../../src/shared/types'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { goalsQuery } from '../../src/web/lib/queries'
import { routeTree } from '../../src/web/routeTree.gen'
import { debtGoalDetail, goal, goalDetail } from './goal-fixtures'

const me: UserDto = {
  id: 'u1',
  username: 'owner',
  displayName: 'Owner',
  upDisplayName: null,
  negativeStyle: 'minus',
  accent: 'amber',
  connectUpAnswered: true,
  gettingStartedHidden: true,
  sharingLevel: 'full',
}
const partner: UserDto = {
  ...me,
  id: 'u2',
  username: 'partner',
  displayName: 'Sam',
  sharingLevel: 'hide-transactions',
}

const OCT = {
  month: '2026-10',
  fromIso: '2026-09-30T14:00:00.000Z',
  toIso: '2026-10-31T13:00:00.000Z',
  inCents: 12_000,
  outCents: 3_000,
}
const SEP = {
  month: '2026-09',
  fromIso: '2026-08-31T14:00:00.000Z',
  toIso: '2026-09-30T14:00:00.000Z',
  inCents: 45_000,
  outCents: 0,
}

// The browser's short September is "Sept" in en-AU.
const SEP_LABEL = /^Sept? 2026$/

let detail: GoalDetailDto
let detailStatus: number
let users: UserDto[]
let detailRanges: (string | null)[]
let txRequests: URLSearchParams[]
let writes: { method: string; body: unknown }[]
let posts: string[]
let list: GoalDto[]
let failRange: string | null
let detail2: GoalDetailDto
let gate2: Promise<void>
let failSeen: boolean

beforeEach(() => {
  list = []
  failSeen = false
  failRange = null
  gate2 = Promise.resolve()
  detail2 = goalDetail({
    goal: goal({
      accountId: 's2',
      saverName: 'Car Saver',
      balanceCents: 10_000,
      goal: { kind: 'save', name: 'Car', targetCents: 500_000, targetDate: null },
      status: 'not-growing',
      toGoCents: 490_000,
    }),
    points: [{ date: '2026-10-30', balanceCents: 10_000, targetCents: 500_000 }],
  })
  detail = goalDetail()
  detailStatus = 200
  users = [me]
  detailRanges = []
  txRequests = []
  writes = []
  posts = []
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const path = url.pathname
      if (path === '/api/setup/status') return Response.json({ needsSetup: false })
      if (path === '/api/sync/status') return Response.json({ connections: [] })
      if (path === '/api/me') return Response.json(me)
      if (path === '/api/users') return Response.json(users)
      if (path === '/api/transactions') {
        txRequests.push(url.searchParams)
        return Response.json({ items: [], nextCursor: null })
      }
      if (path === '/api/goals/s1' && init?.method && init.method !== 'GET') {
        writes.push({ method: init.method, body: init.body ? JSON.parse(String(init.body)) : null })
        if (init.method === 'DELETE') {
          detail = goalDetail({ goal: goal({ goal: null, status: null, toGoCents: null }) })
          return new Response(null, { status: 204 })
        }
        return Response.json(detail.goal)
      }
      if (path.startsWith('/api/goals/s1/') && init?.method === 'POST') {
        posts.push(`${path}${init.body ? ` ${init.body}` : ''}`)
        if (path.endsWith('/seen') && failSeen) return Response.json({ error: 'Could not save that.' }, { status: 500 })
        // An archived goal is gone from the list, and its page.
        if (path.endsWith('/archive')) {
          list = []
          detailStatus = 404
        }
        return new Response(null, { status: 204 })
      }
      if (path === '/api/goals/s2') {
        await gate2
        return Response.json(detail2)
      }
      if (path === '/api/goals') return Response.json({ goals: list, archived: [] })
      if (path === '/api/goals/s1') {
        const range = url.searchParams.get('range')
        detailRanges.push(range)
        if (range === failRange) return Response.json({ error: 'Boom' }, { status: 500 })
        return detailStatus === 200
          ? Response.json(detail)
          : Response.json({ error: 'Goal not found' }, { status: detailStatus })
      }
      return Response.json([])
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mountRouter(path = '/goals/s1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { router, queryClient, ...view }
}

const figure = (label: string) => screen.getByText(label).parentElement!

test('a save goal: header, back link, figures and legend', async () => {
  detail = goalDetail({
    goal: goal({
      goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: '2026-12-31' },
      status: 'on-track',
      toGoCents: 38_000,
    }),
    expected: { from: { date: '2026-10-01', cents: 0 }, to: { date: '2026-12-31', cents: 100_000 } },
  })
  mountRouter()
  expect(await screen.findByRole('heading', { name: 'Holiday', level: 1 })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '‹ Goals' })).toHaveAttribute('href', '/goals')
  expect(screen.getByText('Holiday Saver')).toBeInTheDocument()
  expect(screen.getByText('Save up to')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit goal' })).toBeInTheDocument()

  expect(within(figure('To go')).getByText('$380.00')).toBeInTheDocument()
  expect(screen.getByText('Reach by 31 Dec')).toBeInTheDocument()

  const legend = screen.getByRole('list', { name: 'Legend' })
  expect(
    within(legend)
      .getAllByRole('listitem')
      .map((li) => li.textContent),
  ).toEqual(['Saved', 'Target', 'Expected'])
  // Saved and Target are also legend entries, so these figures are found by their values.
  expect(screen.getByText('$620.00').parentElement).toHaveTextContent('Saved')
  expect(screen.getByText('$1,000.00').parentElement).toHaveTextContent('Target')
  expect(screen.getByRole('img', { name: 'Holiday balance over time' })).toBeInTheDocument()
  expect(screen.getByText('Balance over time')).toBeInTheDocument()
})

test('a debt goal: its figures, and a legend naming the debt', async () => {
  detail = debtGoalDetail()
  mountRouter()
  await screen.findByRole('heading', { name: 'Car', level: 1 })
  expect(screen.getByText('Pay off a debt')).toBeInTheDocument()
  expect(screen.getAllByText('$8,000.00')[0]!.parentElement).toHaveTextContent('Car loan left')
  expect(within(figure('Gap')).getByText('$5,000.00')).toBeInTheDocument()
  expect(screen.getByText('Covered by Feb 2027')).toBeInTheDocument()
  expect(screen.queryByText('To go')).not.toBeInTheDocument()
  const legend = screen.getByRole('list', { name: 'Legend' })
  expect(
    within(legend)
      .getAllByRole('listitem')
      .map((li) => li.textContent),
  ).toEqual(['Saved', 'Car loan left', 'At this rate'])
})

test('the date figure for a projected save goal, and otherwise the next step', async () => {
  detail = goalDetail({
    goal: goal({
      goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: null },
      status: 'projected',
      projectedDate: '2027-03-15',
      toGoCents: 38_000,
    }),
    projected: { date: '2027-03-15', saverCents: 100_000 },
  })
  const first = mountRouter()
  expect(await screen.findByText('At this rate, Mar 2027')).toBeInTheDocument()
  first.unmount()

  detail = goalDetail({
    goal: goal({
      goal: { kind: 'buffer', name: 'Food', targetCents: 40_000, targetDate: null },
      status: 'below',
      belowCents: 4_000,
      toGoCents: null,
    }),
  })
  mountRouter()
  expect(await screen.findByText('$40.00 below · top it up to $400.00')).toBeInTheDocument()
  expect(screen.queryByText('To go')).not.toBeInTheDocument()
})

test("a behind goal's Reach by isn't in warning colour, since its words don't say behind", async () => {
  detail = goalDetail({
    goal: goal({
      goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: '2026-12-31' },
      status: 'behind',
      toGoCents: 38_000,
    }),
  })
  mountRouter()
  const reach = await screen.findByText('Reach by 31 Dec')
  expect(reach).not.toHaveClass('text-warning')
  // The line under it says behind, in the status colour.
  expect(screen.getByText(/^\$95\.00 a pay to reach it by 31 Dec/)).toHaveClass('text-warning')
})

test('a next step that says what is wrong keeps its status colour', async () => {
  detail = goalDetail({
    goal: goal({
      goal: { kind: 'buffer', name: 'Food', targetCents: 40_000, targetDate: null },
      status: 'below',
      belowCents: 4_000,
      toGoCents: null,
    }),
  })
  mountRouter()
  expect(await screen.findByText('$40.00 below · top it up to $400.00')).toHaveClass('text-warning')
})

test('a reached goal with a date says so, with no Reach by and no plan', async () => {
  detail = goalDetail({
    goal: goal({
      goal: { kind: 'save', name: 'Holiday', targetCents: 50_000, targetDate: '2026-12-31' },
      status: 'reached',
      progress: 1,
      toGoCents: null,
    }),
  })
  mountRouter()
  expect(await screen.findByText('Reached ✓')).toBeInTheDocument()
  expect(screen.queryByText(/Reach by/)).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Your plan' })).not.toBeInTheDocument()
})

test('Show table shows a row per point, then Show chart goes back', async () => {
  mountRouter()
  await userEvent.click(await screen.findByRole('button', { name: 'Show table' }))
  const table = within(screen.getByRole('table'))
  expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'Saved', 'Target'])
  expect(table.getAllByRole('row')).toHaveLength(3)
  expect(table.getByText('$600.00')).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: 'Holiday balance over time' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Show chart' }))
  expect(screen.getByRole('img', { name: 'Holiday balance over time' })).toBeInTheDocument()
})

test("the table lists a debt goal's paths, with where the debt is heading under its name", async () => {
  detail = debtGoalDetail()
  mountRouter()
  await userEvent.click(await screen.findByRole('button', { name: 'Show table' }))
  const table = within(screen.getByRole('table'))
  expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
    'Date',
    'Saved',
    'Car loan left',
    'At this rate',
  ])
  const end = table.getAllByRole('row').at(-1)!
  expect(
    within(end)
      .getAllByRole('cell')
      .map((c) => c.textContent),
  ).toEqual(['10 Feb 2027', '—', '$5,750.00', '$5,750.00'])
})

test('the table keeps the true start of a goal older than the range', async () => {
  detail = goalDetail({
    range: '3m',
    expected: { from: { date: '2025-11-01', cents: 0 }, to: { date: '2026-12-31', cents: 100_000 } },
  })
  mountRouter('/goals/s1?range=3m')
  await userEvent.click(await screen.findByRole('button', { name: 'Show table' }))
  const first = within(screen.getByRole('table')).getAllByRole('row')[1]!
  expect(
    within(first)
      .getAllByRole('cell')
      .map((c) => c.textContent),
  ).toEqual(['1 Nov 2025', '—', '—', '$0.00'])
})

test('the debt panel lists its rows and links to the debt', async () => {
  detail = debtGoalDetail()
  mountRouter()
  const panel = within(
    (await screen.findByRole('heading', { name: 'The debt it follows' })).closest('section')!,
  )
  expect(panel.getByRole('link', { name: 'Car loan' })).toHaveAttribute('href', '/debts/d1')
  const row = (label: string) => panel.getByText(label).parentElement!
  expect(within(row('Left now')).getByText('$8,000.00')).toBeInTheDocument()
  expect(within(row('When you set this')).getByText('$10,000.00')).toBeInTheDocument()
  expect(within(row('Falling lately')).getByText('$450.00 a month')).toBeInTheDocument()
  expect(within(row('Next repayment')).getByText('1 Nov')).toBeInTheDocument()
})

test('a debt that has stopped falling says so', async () => {
  const base = debtGoalDetail()
  detail = { ...base, debt: { ...base.debt!, fallCents: 0 } }
  mountRouter()
  expect(await screen.findByText('Not falling lately')).toBeInTheDocument()
  expect(screen.queryByText(/\$0\.00 a/)).not.toBeInTheDocument()
})

test('a paid-off debt, or one with no date due, has no Next repayment row', async () => {
  const base = debtGoalDetail()
  detail = { ...base, goal: { ...base.goal, debt: { ...base.goal.debt!, paidOff: true } } }
  const first = mountRouter()
  await screen.findByRole('heading', { name: 'The debt it follows' })
  expect(screen.queryByText('Next repayment')).not.toBeInTheDocument()
  first.unmount()

  detail = { ...base, debt: { ...base.debt!, nextDue: null } }
  mountRouter()
  await screen.findByRole('heading', { name: 'The debt it follows' })
  expect(screen.queryByText('Next repayment')).not.toBeInTheDocument()
})

test('with no goal: Set goal, the Saver as the title, and no plan or debt panel', async () => {
  detail = goalDetail({
    goal: goal({ saverName: 'Rent Saver', goal: null, status: null, toGoCents: null }),
    points: [{ date: '2026-10-30', balanceCents: 62_000, targetCents: null }],
  })
  mountRouter()
  expect(await screen.findByRole('heading', { name: 'Rent Saver', level: 1 })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Set goal' })).toBeInTheDocument()
  // No chips: the Saver's name is already the title, and there's no kind yet.
  expect(screen.getAllByText('Rent Saver')).toHaveLength(1)
  expect(screen.queryByText('Save up to')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Your plan' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'The debt it follows' })).not.toBeInTheDocument()
  expect(screen.queryByText('Target')).not.toBeInTheDocument()
  expect(screen.queryByRole('list', { name: 'Legend' })).not.toBeInTheDocument()
})

test('Your plan shows the slider to someone who can edit', async () => {
  detail = goalDetail({
    goal: goal({
      goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: null },
      status: 'not-growing',
      toGoCents: 38_000,
      cadence: { kind: 'month' },
    }),
  })
  mountRouter()
  await screen.findByRole('heading', { name: 'Your plan' })
  expect(screen.getByRole('slider', { name: 'Holiday: try an amount' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Try an amount' })).not.toBeInTheDocument()
})

test("someone else's Saver shows the plan line but no slider, and no edit button", async () => {
  detail = goalDetail({
    goal: goal({
      canEdit: false,
      status: 'not-growing',
      toGoCents: 38_000,
      cadence: { kind: 'month' },
      plan: { amountCents: 5_000, mineCents: 0, partnerCents: 5_000, partnerName: 'Sam', partial: false },
    }),
  })
  mountRouter()
  await screen.findByRole('heading', { name: 'The plan' })
  expect(screen.getByText(/^Sam's plan puts in \$50\.00 a month/)).toBeInTheDocument()
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit goal' })).not.toBeInTheDocument()
})

test("someone else's Saver with nothing planned has no empty plan section", async () => {
  detail = goalDetail({ goal: goal({ canEdit: false, status: 'not-growing', toGoCents: 38_000 }) })
  mountRouter()
  await screen.findByText('Money in and out')
  expect(screen.queryByRole('heading', { name: 'Your plan' })).not.toBeInTheDocument()
})

test('the form opens in place of the button, saves, and closes', async () => {
  mountRouter()
  await userEvent.click(await screen.findByRole('button', { name: 'Edit goal' }))
  expect(screen.queryByRole('button', { name: 'Edit goal' })).not.toBeInTheDocument()
  await userEvent.clear(screen.getByLabelText('Name'))
  await userEvent.type(screen.getByLabelText('Name'), 'Bali')
  await userEvent.click(screen.getByRole('button', { name: 'Save goal' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toMatchObject({
    method: 'PUT',
    body: { kind: 'save', name: 'Bali', targetCents: 100_000 },
  })
  expect(await screen.findByRole('button', { name: 'Edit goal' })).toBeInTheDocument()
  await waitFor(() => expect(detailRanges.length).toBeGreaterThan(1))
})

test('removing a goal stays on the page, now offering Set goal', async () => {
  const { router } = mountRouter()
  await userEvent.click(await screen.findByRole('button', { name: 'Edit goal' }))
  await userEvent.click(screen.getByRole('button', { name: 'Remove goal' }))
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove goal' }))
  expect(await screen.findByRole('button', { name: 'Set goal' })).toBeInTheDocument()
  expect(writes[0]).toMatchObject({ method: 'DELETE' })
  expect(router.state.location.pathname).toBe('/goals/s1')
})

test('the range group marks the current range, and the URL carries it except at 6M', async () => {
  const { router } = mountRouter()
  const group = within(await screen.findByRole('group', { name: 'Range' }))
  expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(['3M', '6M', '1Y', 'All'])
  expect(group.getByRole('button', { name: '6M' })).toHaveAttribute('aria-pressed', 'true')
  expect(detailRanges).toEqual(['6m'])

  await userEvent.click(group.getByRole('button', { name: '1Y' }))
  await waitFor(() => expect(router.state.location.search).toEqual({ range: '1y' }))
  await waitFor(() => expect(detailRanges).toEqual(['6m', '1y']))
  expect(screen.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true')

  await userEvent.click(screen.getByRole('button', { name: '6M' }))
  await waitFor(() => expect(router.state.location.search).toEqual({}))
})

test('a range in the URL is what gets asked for, and a bad one falls back', async () => {
  const first = mountRouter('/goals/s1?range=3m')
  await screen.findByRole('group', { name: 'Range' })
  expect(detailRanges).toEqual(['3m'])
  first.unmount()

  detailRanges = []
  mountRouter('/goals/s1?range=nope')
  await screen.findByRole('group', { name: 'Range' })
  expect(detailRanges).toEqual(['6m'])
})

test('changing range keeps the scope', async () => {
  const { router } = mountRouter('/goals/s1?scope=me')
  await userEvent.click(await screen.findByRole('button', { name: '1Y' }))
  await waitFor(() => expect(router.state.location.search).toEqual({ scope: 'me', range: '1y' }))
  await userEvent.click(screen.getByRole('button', { name: '6M' }))
  await waitFor(() => expect(router.state.location.search).toEqual({ scope: 'me' }))
})

test('‹ Goals keeps the scope and leaves the range behind', async () => {
  mountRouter('/goals/s1?scope=me&range=1y')
  expect(await screen.findByRole('link', { name: '‹ Goals' })).toHaveAttribute('href', '/goals?scope=me')
})

test('‹ Goals keeps the scope on the not-found page too', async () => {
  detailStatus = 404
  mountRouter('/goals/s1?scope=me')
  await screen.findByText('Goal not found.')
  expect(screen.getByRole('link', { name: '‹ Goals' })).toHaveAttribute('href', '/goals?scope=me')
})

test("the list's links carry the scope to the goal's page", async () => {
  list = [goal(), goal({ accountId: 'rent', saverName: 'Rent Saver', goal: null, status: null })]
  mountRouter('/goals?scope=me')
  expect(await screen.findByRole('link', { name: 'Details for Holiday' })).toHaveAttribute(
    'href',
    '/goals/s1?scope=me',
  )
  expect(screen.getByRole('link', { name: 'Holiday' })).toHaveAttribute('href', '/goals/s1?scope=me')
  expect(screen.getByRole('link', { name: 'Rent Saver' })).toHaveAttribute('href', '/goals/rent?scope=me')
})

test('in the default scope the links carry nothing', async () => {
  list = [goal()]
  mountRouter('/goals')
  expect(await screen.findByRole('link', { name: 'Details for Holiday' })).toHaveAttribute(
    'href',
    '/goals/s1',
  )
})

test('a range that fails keeps the last chart, and says so until a range loads', async () => {
  failRange = '1y'
  mountRouter()
  await userEvent.click(await screen.findByRole('button', { name: '1Y' }))
  expect(await screen.findByText("Couldn't load this range.")).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('img', { name: 'Holiday balance over time' })).toBeInTheDocument()
  expect(screen.queryByText("Couldn't load this goal.")).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: '3M' }))
  await waitFor(() => expect(screen.queryByText("Couldn't load this range.")).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true')
})

test('hidden transactions: totals and the notice, with no details', async () => {
  users = [me, partner]
  detail = goalDetail({
    goal: goal({ ownerUserId: 'u2', canEdit: false, status: 'not-growing' }),
    months: [OCT, SEP],
    transactionsHidden: true,
  })
  const { container } = mountRouter()
  await screen.findByText('Money in and out')
  expect(await screen.findByText('Sam keeps their transactions private.')).toBeInTheDocument()
  expect(screen.getByText('Oct 2026')).toBeInTheDocument()
  expect(screen.getByText('In $120.00')).toBeInTheDocument()
  expect(screen.getByText('Out $30.00')).toBeInTheDocument()
  expect(screen.getByText('In $450.00')).toBeInTheDocument()
  expect(container.querySelector('details')).toBeNull()
  expect(txRequests).toHaveLength(0)
})

test('the newest month starts open; opening an older one asks for its dates', async () => {
  detail = goalDetail({ months: [OCT, SEP] })
  const { container } = mountRouter()
  const newest = (await screen.findByText('Oct 2026')).closest('details')!
  const older = screen.getByText(SEP_LABEL).closest('details')!
  expect(newest.open).toBe(true)
  expect(older.open).toBe(false)
  expect(container.querySelectorAll('details')).toHaveLength(2)

  await waitFor(() => expect(txRequests).toHaveLength(1))
  expect(Object.fromEntries(txRequests[0]!)).toEqual({ accountId: 's1', from: OCT.fromIso, to: OCT.toIso })

  await userEvent.click(screen.getByText(SEP_LABEL))
  await waitFor(() => expect(txRequests).toHaveLength(2))
  expect(Object.fromEntries(txRequests[1]!)).toEqual({ accountId: 's1', from: SEP.fromIso, to: SEP.toIso })
  expect(older.open).toBe(true)
})

test('no months in the range says so', async () => {
  mountRouter()
  expect(await screen.findByText('No money in or out in this range.')).toBeInTheDocument()
})

test('a 404 shows Goal not found and the way back', async () => {
  detailStatus = 404
  mountRouter()
  expect(await screen.findByText('Goal not found.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '‹ Goals' })).toHaveAttribute('href', '/goals')
  expect(screen.queryByText("Couldn't load this goal.")).not.toBeInTheDocument()
})

test('any other error says it could not load', async () => {
  detailStatus = 500
  mountRouter()
  expect(await screen.findByText("Couldn't load this goal.")).toBeInTheDocument()
  expect(screen.queryByText('Goal not found.')).not.toBeInTheDocument()
})

test('moving to another goal closes the form and never shows the first goal under the second', async () => {
  let release!: () => void
  gate2 = new Promise((r) => (release = r))
  const { router } = mountRouter()
  await userEvent.click(await screen.findByRole('button', { name: 'Edit goal' }))
  expect(screen.getByLabelText('Name')).toBeInTheDocument()

  await router.navigate({ to: '/goals/$accountId', params: { accountId: 's2' } })
  await waitFor(() => expect(router.state.location.pathname).toBe('/goals/s2'))
  expect(screen.queryByRole('heading', { name: 'Holiday', level: 1 })).not.toBeInTheDocument()
  expect(screen.queryByText('$620.00')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()

  release()
  expect(await screen.findByRole('heading', { name: 'Car', level: 1 })).toBeInTheDocument()
  expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit goal' })).toBeInTheDocument()
  expect(screen.queryByText('Holiday')).not.toBeInTheDocument()
})

test('a behind goal says so beneath the figures, in its status colour, besides Reach by', async () => {
  detail = goalDetail({
    goal: goal({
      goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: '2026-12-31' },
      status: 'behind',
      neededCents: 9_500,
      recentRateCents: 4_000,
      toGoCents: 38_000,
    }),
  })
  mountRouter()
  expect(await screen.findByText('Reach by 31 Dec')).toBeInTheDocument()
  expect(screen.getByText('$95.00 a pay to reach it by 31 Dec · lately about $40.00')).toHaveClass(
    'text-warning',
  )
})

test('an on-track goal repeats nothing it already says', async () => {
  detail = goalDetail({
    goal: goal({
      goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: '2026-12-31' },
      status: 'on-track',
      toGoCents: 38_000,
    }),
  })
  mountRouter()
  expect(await screen.findByText('Reach by 31 Dec')).toBeInTheDocument()
  expect(screen.getByText('$95.00 a pay to reach it by 31 Dec · on track')).toBeInTheDocument()
})

test("Reach by names the year when it isn't this year's", async () => {
  detail = goalDetail({
    goal: goal({
      goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: '2027-12-31' },
      status: 'on-track',
      toGoCents: 38_000,
    }),
  })
  mountRouter()
  expect(await screen.findByText('Reach by 31 Dec 2027')).toBeInTheDocument()
})

test('the debt links keep the scope', async () => {
  detail = debtGoalDetail()
  mountRouter('/goals/s1?scope=me')
  expect(await screen.findByRole('link', { name: 'Car loan' })).toHaveAttribute('href', '/debts/d1?scope=me')
})

test('a background refetch that fails does not say the range failed', async () => {
  const { queryClient } = mountRouter()
  await screen.findByRole('group', { name: 'Range' })
  failRange = '6m'
  await queryClient.invalidateQueries()
  await waitFor(() => expect(detailRanges.length).toBeGreaterThan(1))
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByText("Couldn't load this range.")).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Holiday balance over time' })).toBeInTheDocument()
})

test("a plan that isn't the viewer's is headed The plan", async () => {
  detail = goalDetail({
    goal: goal({
      canEdit: false,
      status: 'not-growing',
      toGoCents: 38_000,
      cadence: { kind: 'month' },
      plan: { amountCents: 5_000, mineCents: 0, partnerCents: 5_000, partnerName: 'Sam', partial: false },
    }),
  })
  mountRouter()
  expect(await screen.findByRole('heading', { name: 'The plan' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Your plan' })).not.toBeInTheDocument()
})

test("a goal card's debt link keeps the scope", async () => {
  const base = debtGoalDetail().goal
  list = [base]
  mountRouter('/goals?scope=me')
  expect(await screen.findByRole('link', { name: 'Pays off Car loan' })).toHaveAttribute(
    'href',
    '/debts/d1?scope=me',
  )
})

const reachedDetail = (over: Partial<GoalDto> = {}) =>
  goalDetail({
    goal: goal({
      goal: { kind: 'save', name: 'Holiday', targetCents: 50_000, targetDate: null },
      status: 'reached',
      progress: 1,
      toGoCents: null,
      reachedOn: '2026-10-30',
      ...over,
    }),
  })

test('opening a celebrated goal records it as seen, once', async () => {
  detail = reachedDetail({ celebrate: true })
  const { queryClient } = mountRouter()
  expect(await screen.findByText('Reached 30 Oct')).toBeInTheDocument()
  await waitFor(() => expect(posts).toEqual(['/api/goals/s1/seen']))
  // A refetch with the same reached date doesn't send it again.
  await queryClient.invalidateQueries({ queryKey: ['goals'] })
  await new Promise((r) => setTimeout(r, 20))
  expect(posts).toEqual(['/api/goals/s1/seen'])
})

test('a goal that is not celebrating is not marked seen', async () => {
  detail = reachedDetail({ celebrate: false })
  mountRouter()
  expect(await screen.findByText('Reached 30 Oct')).toBeInTheDocument()
  await new Promise((r) => setTimeout(r, 20))
  expect(posts).toEqual([])
})

const celebrating = (over: Partial<GoalDto> = {}) =>
  goal({
    goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: null },
    status: 'reached',
    progress: 1,
    toGoCents: null,
    reachedOn: '2026-10-30',
    celebrate: true,
    ...over,
  })

test('marking seen from the page updates the list it came from, even unobserved', async () => {
  detail = reachedDetail({ celebrate: true })
  const { queryClient } = mountRouter()
  // The list as it was when the person left it, with no page observing it now.
  list = [celebrating()]
  await queryClient.fetchQuery(goalsQuery('everyone'))
  list = [celebrating({ celebrate: false })]
  await waitFor(() => expect(posts).toEqual(['/api/goals/s1/seen']))
  await waitFor(() =>
    expect(queryClient.getQueryData<{ goals: GoalDto[] }>(['goals', 'everyone'])?.goals[0].celebrate).toBe(false),
  )
})

test('archiving from the page refreshes the list first, and never refetches the goal that has gone', async () => {
  detail = reachedDetail()
  const { router, queryClient } = mountRouter('/goals/s1?scope=me')
  list = [celebrating({ celebrate: false })]
  await queryClient.fetchQuery(goalsQuery('me'))
  await userEvent.click(await screen.findByRole('button', { name: 'Archive' }))
  const fetchedBefore = detailRanges.length
  let listAtNavigate: unknown
  router.subscribe('onBeforeNavigate', () => {
    listAtNavigate ??= queryClient.getQueryData(['goals', 'me'])
  })
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/goals'))
  expect(listAtNavigate).toEqual({ goals: [], archived: [] })
  expect(detailRanges).toHaveLength(fetchedBefore)
  expect(screen.queryByText('Goal not found.')).not.toBeInTheDocument()
})

test('a seen that fails keeps the banner hidden and says so', async () => {
  failSeen = true
  list = [celebrating()]
  mountRouter('/goals')
  expect(await screen.findByText('You reached Holiday!')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(await screen.findByText('Could not save that.')).toBeInTheDocument()
  expect(posts).toEqual(['/api/goals/s1/seen'])
  expect(screen.queryByText('You reached Holiday!')).not.toBeInTheDocument()
})

test('the reached actions sit on the page, and a new target is posted', async () => {
  detail = reachedDetail()
  mountRouter()
  await userEvent.click(await screen.findByRole('button', { name: 'Set a new target' }))
  await userEvent.type(screen.getByLabelText('New target'), '900')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(posts).toEqual(['/api/goals/s1/new-target {"targetCents":90000}']))
})

test('archiving from the page goes back to the goals, keeping the scope', async () => {
  detail = reachedDetail()
  const { router } = mountRouter('/goals/s1?scope=me')
  await userEvent.click(await screen.findByRole('button', { name: 'Archive' }))
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/goals'))
  expect(router.state.location.search).toEqual({ scope: 'me' })
  expect(posts).toEqual(['/api/goals/s1/archive'])
})
