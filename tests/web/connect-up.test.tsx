import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { UserDto } from '../../src/shared/types'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { routeTree } from '../../src/web/routeTree.gen'

const me = (over: Partial<UserDto> = {}): UserDto => ({
  id: 'u1',
  username: 'owner',
  displayName: 'Owner',
  upDisplayName: null,
  negativeStyle: 'minus',
  accent: 'amber',
  connectUpAnswered: false,
  gettingStartedHidden: true,
  sharingLevel: 'full',
  ...over,
})

type Reply = { status: number; body: unknown } | 'pending'

let current: UserDto
let puts: unknown[]
let patches: unknown[]
let putReply: Reply
let patchReply: Reply
let holdMeGet: Promise<UserDto> | null

beforeEach(() => {
  current = me()
  puts = []
  patches = []
  putReply = { status: 200, body: { connections: [] } }
  patchReply = { status: 200, body: null }
  holdMeGet = null
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/setup/status') return Response.json({ needsSetup: false })
      if (path === '/api/sync/status') return Response.json({ connections: [] })
      if (path === '/api/settings/up-token' && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)))
        if (putReply === 'pending') return new Promise<Response>(() => {})
        if (putReply.status === 200) current = { ...current, connectUpAnswered: true }
        return Response.json(putReply.body, { status: putReply.status })
      }
      if (path === '/api/me' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patches.push(body)
        if (patchReply === 'pending') return new Promise<Response>(() => {})
        if (patchReply.status !== 200) return Response.json(patchReply.body, { status: patchReply.status })
        current = { ...current, connectUpAnswered: true, upDisplayName: (body.upDisplayName as string) ?? current.upDisplayName }
        return Response.json(current)
      }
      if (path === '/api/me') {
        if (holdMeGet) return Response.json(await holdMeGet)
        return Response.json(current)
      }
      return Response.json([])
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

let queryClient: QueryClient

function mountRouter(path: string) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({ routeTree, context: { queryClient }, history: createMemoryHistory({ initialEntries: [path] }) })
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return router
}

const heading = () => screen.findByRole('heading', { name: 'Connect your Up account.' })
const tokenInput = () => screen.getByLabelText('Up personal access token')
const connectButton = () => screen.getByRole('button', { name: 'Connect' })
const skipButton = () => screen.getByRole('button', { name: 'Skip for now' })

test("someone who hasn't answered goes to /connect from anywhere in the app", async () => {
  const router = mountRouter('/settings')
  await heading()
  expect(router.state.location.pathname).toBe('/connect')
})

test('/sharing comes before /connect', async () => {
  current = me({ sharingLevel: null })
  const router = mountRouter('/connect')
  await screen.findByRole('radiogroup', { name: 'What can your partner see?' })
  expect(router.state.location.pathname).toBe('/sharing')
})

test('/connect sends someone who answered to the overview', async () => {
  current = me({ connectUpAnswered: true })
  const router = mountRouter('/connect')
  await screen.findByRole('heading', { name: 'Overview' })
  expect(router.state.location.pathname).toBe('/')
})

test('it explains itself', async () => {
  mountRouter('/connect')
  await heading()
  expect(screen.getByText(/It can't move your money\./)).toBeInTheDocument()
  expect(screen.getByText(/Upkeep reads your accounts and transactions from Up to show where your money goes\./)).toBeInTheDocument()
  expect(screen.getByText('Create one in the Up app or at api.up.com.au. It is stored encrypted and never shown again.')).toBeInTheDocument()
  expect(tokenInput()).toHaveAttribute('type', 'password')
  expect(tokenInput()).toHaveAttribute('placeholder', 'up:yeah:…')
  expect(screen.queryByLabelText(/\$handle/)).not.toBeInTheDocument()
})

test('Connect is disabled until a token is entered', async () => {
  mountRouter('/connect')
  await heading()
  expect(connectButton()).toBeDisabled()
  await userEvent.type(tokenInput(), 'up:yeah:x')
  expect(connectButton()).toBeEnabled()
})

test('connecting sends the token, then goes to the overview', async () => {
  const router = mountRouter('/connect')
  await heading()
  await userEvent.type(tokenInput(), 'up:yeah:x')
  await userEvent.click(connectButton())
  await screen.findByRole('heading', { name: 'Overview' })
  expect(puts).toEqual([{ token: 'up:yeah:x' }])
  expect(router.state.location.pathname).toBe('/')
})

test('a rejected token shows on the field and keeps what was typed', async () => {
  putReply = { status: 400, body: { error: "Up didn't accept that token" } }
  const router = mountRouter('/connect')
  await heading()
  await userEvent.type(tokenInput(), 'up:yeah:bad')
  await userEvent.click(connectButton())
  expect(await screen.findByText("Up didn't accept that token")).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/connect')
  expect(tokenInput()).toHaveValue('up:yeah:bad')
  expect(skipButton()).toBeEnabled()
})

test('Up being unreachable shows too', async () => {
  putReply = { status: 502, body: { error: "Couldn't reach Up" } }
  mountRouter('/connect')
  await heading()
  await userEvent.type(tokenInput(), 'up:yeah:x')
  await userEvent.click(connectButton())
  expect(await screen.findByText("Couldn't reach Up")).toBeInTheDocument()
})

test('skipping sends only the skip and goes to the overview', async () => {
  const router = mountRouter('/connect')
  await heading()
  await userEvent.click(skipButton())
  await screen.findByRole('heading', { name: 'Overview' })
  expect(patches).toEqual([{ connectUpSkipped: true }])
  expect(router.state.location.pathname).toBe('/')
})

test('a /me fetch already in flight when Skip lands does not undo it', async () => {
  const router = mountRouter('/connect')
  await heading()
  let release!: (u: UserDto) => void
  holdMeGet = new Promise<UserDto>((r) => (release = r))
  const stale = me() // read before the PATCH: still unanswered
  void queryClient.refetchQueries({ queryKey: ['me'] }) // a /me GET starts before the skip
  await userEvent.click(skipButton())
  await waitFor(() => expect(patches).toHaveLength(1))
  holdMeGet = null
  await screen.findByRole('heading', { name: 'Overview' })
  release(stale) // lands after the PATCH
  await new Promise((r) => setTimeout(r, 80))
  await router.navigate({ to: '/settings' })
  await screen.findByRole('heading', { name: 'Settings' })
  expect(router.state.location.pathname).toBe('/settings')
})

test('a failed skip shows under the buttons and stays', async () => {
  patchReply = { status: 500, body: { error: 'Something broke' } }
  const router = mountRouter('/connect')
  await heading()
  await userEvent.click(skipButton())
  expect(await screen.findByRole('alert')).toHaveTextContent('Something broke')
  expect(router.state.location.pathname).toBe('/connect')
  expect(skipButton()).toBeEnabled()
})

test('only one request goes out while a connect is running', async () => {
  putReply = 'pending'
  mountRouter('/connect')
  await heading()
  await userEvent.type(tokenInput(), 'up:yeah:x')
  await userEvent.click(connectButton())
  await waitFor(() => expect(puts).toHaveLength(1))
  expect(connectButton()).toBeDisabled()
  expect(skipButton()).toBeDisabled()
})

test('only one request goes out while a skip is running', async () => {
  patchReply = 'pending'
  mountRouter('/connect')
  await heading()
  await userEvent.type(tokenInput(), 'up:yeah:x')
  await userEvent.click(skipButton())
  await waitFor(() => expect(patches).toHaveLength(1))
  expect(connectButton()).toBeDisabled()
  expect(skipButton()).toBeDisabled()
})
