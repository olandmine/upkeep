import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { GettingStartedDto, GettingStartedKey, SyncStatusDto, UserDto } from '../../src/shared/types'
import { PlainLink } from '../../src/web/components/AppLink'
import { GettingStartedCard } from '../../src/web/components/overview/GettingStartedCard'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { routeTree } from '../../src/web/routeTree.gen'

type Connection = SyncStatusDto['connections'][number]
type State = 'done' | 'open' | 'locked'

const KEYS: GettingStartedKey[] = ['connect-up', 'password', 'handle', 'partner', 'budget', 'joint-budget', 'debt', 'goal']
const OPTIONAL = new Set<GettingStartedKey>(['debt', 'goal'])

function dto(states: Partial<Record<GettingStartedKey, State>>): GettingStartedDto {
  return {
    show: true,
    items: KEYS.filter((key) => states[key]).map((key) => ({ key, state: states[key]!, optional: OPTIONAL.has(key) })),
  }
}

const connection = (over: Partial<Connection> = {}): Connection => ({
  userId: 'u1',
  displayName: 'Owner',
  status: 'ok',
  lastSyncedAt: null,
  lastError: null,
  lastFailedAt: null,
  backfillCompletedAt: null,
  running: null,
  ...over,
})

const BACKFILL = (n: number) => ({ kind: 'backfill', startedAt: '2026-11-06T00:00:00Z', transactionsUpserted: n })

function card(data: GettingStartedDto, props: Partial<Parameters<typeof GettingStartedCard>[0]> = {}) {
  const onHide = vi.fn()
  const view = render(
    <GettingStartedCard data={data} connection={undefined} partnerName={undefined} onHide={onHide} LinkComponent={PlainLink} {...props} />,
  )
  return { onHide, ...view }
}

test('counts every row outside Optional', () => {
  card(dto({ 'connect-up': 'done', password: 'done', partner: 'open', budget: 'open', 'joint-budget': 'locked', debt: 'open', goal: 'locked' }))
  expect(screen.getByText('2 of 5 done')).toBeInTheDocument()
  expect(screen.getByText('Optional')).toBeInTheDocument()
})

test('open rows are links to where the job lives', () => {
  card(dto({ 'connect-up': 'open', password: 'open', handle: 'open', partner: 'open', budget: 'open', 'joint-budget': 'open', debt: 'open', goal: 'open' }))
  const hrefs: [string, string][] = [
    ['Connect Up', '/settings#bank-connection'],
    ['Change your password', '/settings#profile'],
    ['Set your Up $handle', '/settings#profile'],
    ['Add your partner', '/settings#users'],
    ['Set up your pay and budget', '/budgets'],
    ['Set up your joint budget', '/budgets'],
    ['Add a debt', '/debts'],
    ['Set a goal', '/goals'],
  ]
  for (const [title, href] of hrefs) {
    const row = screen.getByText(title).closest('li')!
    expect(within(row).getByRole('link')).toHaveAttribute('href', href)
  }
})

test("done and locked rows aren't links", () => {
  card(dto({ 'connect-up': 'done', password: 'open', budget: 'locked', 'joint-budget': 'done' }))
  for (const title of ['Connect Up', 'Set up your pay and budget', 'Set up your joint budget']) {
    expect(within(screen.getByText(title).closest('li')!).queryByRole('link')).toBeNull()
  }
  expect(within(screen.getByText('Change your password').closest('li')!).getByRole('link')).toBeInTheDocument()
})

test("every row has its copy", () => {
  card(
    dto({ 'connect-up': 'open', password: 'open', handle: 'open', partner: 'open', budget: 'open', 'joint-budget': 'open', debt: 'open', goal: 'open' }),
    { partnerName: 'Alex' },
  )
  const lines: [string, string][] = [
    ['Connect Up', 'Link your Up account to start tracking.'],
    ['Change your password', 'Alex chose your first one. Make it yours so only you can log in.'],
    ['Set your Up $handle', 'Do this before connecting, so joint spending on 2Up is matched to you.'],
    ['Add your partner', 'Give them their own login, with their own Up connection.'],
    ['Set up your pay and budget', 'Pick your pay deposit, then plan where it goes.'],
    ['Set up your joint budget', 'Plan the money you share.'],
    ['Add a debt', "Track a loan or tax bill and see when it's paid off."],
    ['Set a goal', 'Give a Saver a target and see how close it is.'],
  ]
  for (const [title, line] of lines) {
    expect(within(screen.getByText(title).closest('li')!).getByText(line)).toBeInTheDocument()
  }
})

test('the password line falls back to Your partner', () => {
  card(dto({ password: 'open' }))
  expect(screen.getByText('Your partner chose your first one. Make it yours so only you can log in.')).toBeInTheDocument()
})

test('the handle line depends on being connected', () => {
  const { unmount } = card(dto({ 'connect-up': 'open', handle: 'open' }))
  expect(screen.getByText('Do this before connecting, so joint spending on 2Up is matched to you.')).toBeInTheDocument()
  unmount()
  card(dto({ 'connect-up': 'done', handle: 'open' }), { connection: connection() })
  expect(screen.getByText('Matches your new joint spending on 2Up to you.')).toBeInTheDocument()
})

test('locked rows say what they wait for', () => {
  const { unmount } = card(dto({ 'connect-up': 'open', budget: 'locked' }))
  expect(screen.getByText('Ready once Up is connected and your history has imported.')).toBeInTheDocument()
  unmount()
  card(dto({ 'connect-up': 'done', budget: 'locked' }), { connection: connection() })
  expect(screen.getByText('Ready once your history has imported.')).toBeInTheDocument()
})

test('importing shows the live count', () => {
  card(dto({ 'connect-up': 'done', budget: 'locked' }), { connection: connection({ running: BACKFILL(3214) }) })
  expect(screen.getByText('Imported 3,214 transactions…')).toBeInTheDocument()
})

test('a sync problem shows on the done row, and links to Settings', () => {
  const data = dto({ 'connect-up': 'done', budget: 'locked' })
  const { unmount } = card(data, { connection: connection({ status: 'error' }) })
  const link = screen.getByRole('link', { name: /Couldn't finish syncing\. Check your bank connection\./ })
  expect(link).toHaveAttribute('href', '/settings#bank-connection')
  unmount()
  card(data, { connection: connection({ status: 'error', running: BACKFILL(5) }) })
  expect(screen.getByText('Imported 5 transactions…')).toBeInTheDocument()
  expect(screen.queryByText(/Couldn't finish syncing/)).toBeNull()
})

test('done rows drop their line', () => {
  card(dto({ 'connect-up': 'done', password: 'done', handle: 'done', partner: 'done', budget: 'open' }), {
    connection: connection(),
    partnerName: 'Alex',
  })
  expect(screen.queryByText(/Link your Up account/)).toBeNull()
  expect(screen.queryByText(/chose your first one/)).toBeNull()
  expect(screen.queryByText(/2Up/)).toBeNull()
  expect(screen.queryByText(/own login/)).toBeNull()
  // The tick is aria-hidden, so each done row says so to a screen reader.
  expect(screen.getAllByText('Done')).toHaveLength(4)
})

test('Hide calls onHide', async () => {
  const { onHide } = card(dto({ 'connect-up': 'open', budget: 'locked' }))
  await userEvent.click(screen.getByRole('button', { name: 'Hide' }))
  expect(onHide).toHaveBeenCalledTimes(1)
})

// On Overview

const me = (over: Partial<UserDto> = {}): UserDto => ({
  id: 'u1',
  username: 'owner',
  displayName: 'Owner',
  upDisplayName: null,
  negativeStyle: 'minus',
  accent: 'amber',
  connectUpAnswered: true,
  gettingStartedHidden: false,
  sharingLevel: 'full',
  ...over,
})

let gettingStarted: () => Promise<Response>
let patches: unknown[]
let patchStatus: number

beforeEach(() => {
  patches = []
  patchStatus = 200
  gettingStarted = async () => Response.json(dto({ 'connect-up': 'open', budget: 'locked' }))
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/setup/status') return Response.json({ needsSetup: false })
      if (path === '/api/sync/status') return Response.json({ connections: [] })
      if (path === '/api/getting-started') return gettingStarted()
      if (path === '/api/me' && init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)))
        if (patchStatus !== 200) return Response.json({ error: 'Nope' }, { status: patchStatus })
        return Response.json(me({ gettingStartedHidden: true }))
      }
      if (path === '/api/me') return Response.json(me())
      if (path === '/api/users') return Response.json([me(), me({ id: 'u2', displayName: 'Alex' })])
      return Response.json([])
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mountRouter(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({ routeTree, context: { queryClient }, history: createMemoryHistory({ initialEntries: [path] }) })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const cardRegion = () => screen.queryByRole('region', { name: 'Getting started' })
const settle = () => new Promise((r) => setTimeout(r, 80))

test('the tile gives way to the card', async () => {
  mountRouter('/')
  await screen.findByRole('region', { name: 'Getting started' })
  expect(screen.queryByText('Bank connection →')).toBeNull()
})

test("the tile doesn't flash while the card loads", async () => {
  let release = () => {}
  gettingStarted = () =>
    new Promise<Response>((resolve) => {
      release = () => resolve(Response.json({ show: false, items: [] }))
    })
  mountRouter('/')
  await screen.findByRole('heading', { name: 'Overview' })
  await settle()
  expect(screen.queryByText('Bank connection →')).toBeNull()
  release()
  expect(await screen.findByText('Bank connection →')).toBeInTheDocument()
})

test("the tile still shows if the card can't load", async () => {
  gettingStarted = async () => Response.json({ error: 'Broken' }, { status: 500 })
  mountRouter('/')
  expect(await screen.findByText('Bank connection →')).toBeInTheDocument()
})

test('the card is about the viewer: Everyone and Me only', async () => {
  for (const path of ['/', '/?scope=me']) {
    const { unmount } = mountRouter(path)
    await screen.findByRole('region', { name: 'Getting started' })
    unmount()
  }
  for (const path of ['/?scope=partner', '/?scope=joint']) {
    const { unmount } = mountRouter(path)
    await screen.findByRole('heading', { name: 'Overview' })
    await settle()
    expect(cardRegion()).toBeNull()
    unmount()
  }
})

test('Hide saves, and the card goes', async () => {
  mountRouter('/')
  const hide = await screen.findByRole('button', { name: 'Hide' })
  gettingStarted = async () => Response.json({ show: false, items: [] })
  await userEvent.click(hide)
  await waitFor(() => expect(cardRegion()).toBeNull())
  expect(patches).toEqual([{ gettingStartedHidden: true }])
})

test('Hide is immediate: the card goes even if the refetch still says show', async () => {
  mountRouter('/')
  const hide = await screen.findByRole('button', { name: 'Hide' })
  await userEvent.click(hide)
  await waitFor(() => expect(cardRegion()).toBeNull())
  gettingStarted = async () => Response.json({ error: 'Broken' }, { status: 500 })
  await settle()
  expect(cardRegion()).toBeNull()
  expect(patches).toEqual([{ gettingStartedHidden: true }])
})

test('a failed Hide keeps the card and shows a toast', async () => {
  patchStatus = 500
  mountRouter('/')
  await userEvent.click(await screen.findByRole('button', { name: 'Hide' }))
  expect(await screen.findByText('Nope')).toBeInTheDocument()
  expect(cardRegion()).toBeInTheDocument()
})

test('on Partner and Joint the tile stays, since the card is not shown there', async () => {
  for (const path of ['/?scope=partner', '/?scope=joint']) {
    const { unmount } = mountRouter(path)
    expect(await screen.findByText('Bank connection →')).toBeInTheDocument()
    expect(cardRegion()).toBeNull()
    unmount()
  }
})
