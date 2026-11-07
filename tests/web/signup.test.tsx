import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { UsersCard } from '../../src/web/components/settings/UsersCard'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { routeTree } from '../../src/web/routeTree.gen'

let needsSetup: boolean
let posts: { path: string; body: unknown }[]

beforeEach(() => {
  needsSetup = true
  posts = []
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/setup/status') return Response.json({ needsSetup })
      if (init?.method === 'POST') {
        posts.push({ path, body: JSON.parse(String(init.body)) })
        return Response.json({ error: 'stop here' }, { status: 400 })
      }
      return Response.json({ error: 'Not signed in' }, { status: 401 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mountRouter(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({ routeTree, context: { queryClient }, history: createMemoryHistory({ initialEntries: [path] }) })
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

test('signing up asks for a name, an Up $handle and a password, with no separate username', async () => {
  mountRouter('/setup')
  await screen.findByRole('heading', { name: 'Welcome to Upkeep.' })
  expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
  expect(screen.getByText("You'll log in with this. It also matches joint spending on 2Up to you.")).toBeInTheDocument()
  expect(screen.getByLabelText('Your Up $handle')).toHaveAttribute('placeholder', '$yourname')

  await userEvent.type(screen.getByLabelText('Your name'), 'Sam')
  await userEvent.type(screen.getByLabelText('Your Up $handle'), '$sam')
  await userEvent.type(screen.getByLabelText(/^Password/), 'correct horse')
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

  await waitFor(() =>
    expect(posts).toEqual([{ path: '/api/setup', body: { displayName: 'Sam', username: '$sam', password: 'correct horse' } }]),
  )
})

test('logging in asks for the handle or an older username', async () => {
  needsSetup = false
  mountRouter('/login')
  expect(await screen.findByLabelText('Up $handle or username')).toHaveAttribute('autocomplete', 'username')
})

test('adding a partner asks for their name, Up $handle and a password', async () => {
  const onAddPartner = vi.fn().mockResolvedValue(undefined)
  render(<UsersCard users={[]} onAddPartner={onAddPartner} />)
  await userEvent.click(screen.getByRole('button', { name: 'Add partner' }))
  expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()

  await userEvent.type(screen.getByLabelText("Partner's name"), 'Alex')
  await userEvent.type(screen.getByLabelText('Their Up $handle'), '$alex')
  await userEvent.type(screen.getByLabelText(/^Initial password/), 'second horse')
  await userEvent.click(screen.getByRole('button', { name: 'Create login' }))

  expect(onAddPartner).toHaveBeenCalledWith({ displayName: 'Alex', username: '$alex', password: 'second horse' })
})
