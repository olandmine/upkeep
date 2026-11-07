import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { SharingLevel } from '../../src/shared/sharing'
import type { UserDto } from '../../src/shared/types'
import { SharingCard } from '../../src/web/components/settings/SharingCard'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { ApiError } from '../../src/web/lib/api'
import { routeTree } from '../../src/web/routeTree.gen'

const LABELS = ['Full transparency', 'Hide transactions', 'Balances only', 'No sharing']

const me = (over: Partial<UserDto> = {}): UserDto => ({
  id: 'u1',
  username: 'owner',
  displayName: 'Owner',
  upDisplayName: null,
  negativeStyle: 'minus',
  accent: 'amber',
  connectUpAnswered: true,
  gettingStartedHidden: true,
  sharingLevel: null,
  ...over,
})

let current: UserDto | 'logged-out'
let patches: unknown[]

beforeEach(() => {
  current = me()
  patches = []
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/setup/status') return Response.json({ needsSetup: false })
      if (path === '/api/sync/status') return Response.json({ connections: [] })
      if (path === '/api/me' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Partial<UserDto>
        patches.push(body)
        current = { ...(current as UserDto), ...body }
        return Response.json(current)
      }
      if (path === '/api/me') return current === 'logged-out' ? Response.json({ error: 'Not logged in' }, { status: 401 }) : Response.json(current)
      return Response.json([])
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
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
  return router
}

test('someone with no level yet is sent to /sharing from the app', async () => {
  const router = mountRouter('/settings')
  await screen.findByRole('radiogroup', { name: 'What can your partner see?' })
  expect(router.state.location.pathname).toBe('/sharing')
})

test('someone with a level is not sent to /sharing', async () => {
  current = me({ sharingLevel: 'none' })
  const router = mountRouter('/settings')
  await screen.findByRole('heading', { name: 'Settings' })
  expect(router.state.location.pathname).toBe('/settings')
})

test('/sharing sends a logged-out person to the login page', async () => {
  current = 'logged-out'
  const router = mountRouter('/sharing')
  await screen.findByRole('heading', { name: 'Welcome back.' })
  expect(router.state.location.pathname).toBe('/login')
})

test('/sharing sends someone who already chose to the overview', async () => {
  current = me({ sharingLevel: 'full' })
  const router = mountRouter('/sharing')
  await screen.findByRole('heading', { name: 'Overview' })
  expect(router.state.location.pathname).toBe('/')
})

test('the options are a radio group in order, with none selected', async () => {
  mountRouter('/sharing')
  const group = await screen.findByRole('radiogroup', { name: 'What can your partner see?' })
  const radios = screen.getAllByRole('radio')
  expect(radios).toHaveLength(4)
  LABELS.forEach((label, i) => {
    expect(radios[i]).toHaveAccessibleName(expect.stringContaining(label))
    expect(group).toContainElement(radios[i])
    expect(radios[i]).not.toBeChecked()
  })
  expect(screen.getByText('Everything, including individual transactions.')).toBeInTheDocument()
  expect(screen.getByText('Balances, budgets, goals, debts and category totals, but no individual transactions.')).toBeInTheDocument()
  expect(screen.getByText('Account balances and net worth, but no spending, budgets, goals or debts.')).toBeInTheDocument()
  expect(screen.getByText('Nothing from your personal accounts.')).toBeInTheDocument()
  expect(screen.getByText('Joint accounts are always shared. You can change this any time in Settings.')).toBeInTheDocument()
})

test('Continue waits for a choice, then sends it and goes to the overview', async () => {
  const router = mountRouter('/sharing')
  const next = await screen.findByRole('button', { name: 'Continue' })
  expect(next).toBeDisabled()
  await userEvent.click(screen.getByRole('radio', { name: /Balances only/ }))
  expect(next).toBeEnabled()
  await userEvent.click(next)
  await waitFor(() => expect(patches).toEqual([{ sharingLevel: 'balances' }]))
  await screen.findByRole('heading', { name: 'Overview' })
  expect(router.state.location.pathname).toBe('/')
})

test('the options work by keyboard', async () => {
  mountRouter('/sharing')
  await screen.findByRole('radiogroup')
  await userEvent.tab()
  await userEvent.keyboard('{ArrowDown}')
  expect(screen.getByRole('radio', { name: /Hide transactions/ })).toBeChecked()
})

test('the disclosure lists what sharing cannot hide', async () => {
  mountRouter('/sharing')
  const summary = await screen.findByText("What this can't hide")
  expect(summary.closest('details')).toBeTruthy()
  for (const line of [
    'A transfer into a joint account can name your personal account and shows its amount.',
    'A joint budget running on your pay cycle reveals your pay dates.',
    'At Balances only, a balance moving over time gives a rough idea of your spending.',
    'Subtracting their own share from a Household figure reveals yours.',
    "A repayment rule on a joint debt shows its description, and your repayments under it change the debt's balance.",
    'Whoever runs this Upkeep server can still read the database directly.',
  ]) {
    expect(screen.getByText(line)).toBeInTheDocument()
  }
})

function mountCard(onSave: (level: SharingLevel) => Promise<void>, value: UserDto['sharingLevel'] = 'hide-transactions') {
  return render(
    <ToastProvider>
      <SharingCard value={value} onSave={onSave} />
    </ToastProvider>,
  )
}

const choose = (name: RegExp) => fireEvent.click(screen.getByRole('radio', { name }))
const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

test('the settings card shows the current level selected', () => {
  mountCard(async () => {})
  expect(screen.getByRole('radio', { name: /Hide transactions/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: /Full transparency/ })).not.toBeChecked()
})

test('choosing another level in settings sends it and says so', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  mountCard(onSave)
  await userEvent.click(screen.getByRole('radio', { name: /No sharing/ }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('none'))
  expect(await screen.findByText('Sharing updated')).toBeInTheDocument()
})

test('a failed change keeps the old selection and shows the error', async () => {
  const onSave = vi.fn().mockRejectedValue(new ApiError(500, 'Request failed (500)'))
  mountCard(onSave)
  await userEvent.click(screen.getByRole('radio', { name: /No sharing/ }))
  expect(await screen.findByText('Request failed (500)')).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /Hide transactions/ })).toBeChecked()
  expect(screen.queryByText('Sharing updated')).not.toBeInTheDocument()
})

test('two quick changes save once, with the last level, and show one toast', async () => {
  vi.useFakeTimers()
  const onSave = vi.fn().mockResolvedValue(undefined)
  mountCard(onSave)
  choose(/Balances only/)
  await pass(100)
  choose(/No sharing/)
  await pass(299)
  expect(onSave).not.toHaveBeenCalled()
  await pass(1)
  expect(onSave.mock.calls).toEqual([['none']])
  await pass(1000)
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(screen.getAllByText('Sharing updated')).toHaveLength(1)
})

test('the selection moves straight away, and goes back if the save fails', async () => {
  vi.useFakeTimers()
  const onSave = vi.fn().mockRejectedValue(new ApiError(500, 'Request failed (500)'))
  mountCard(onSave)
  choose(/No sharing/)
  expect(screen.getByRole('radio', { name: /No sharing/ })).toBeChecked()
  await pass(300)
  expect(screen.getByText('Request failed (500)')).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /Hide transactions/ })).toBeChecked()
})

test('going back to the saved level sends nothing', async () => {
  vi.useFakeTimers()
  const onSave = vi.fn().mockResolvedValue(undefined)
  mountCard(onSave)
  choose(/No sharing/)
  await pass(100)
  choose(/Hide transactions/)
  await pass(1000)
  expect(onSave).not.toHaveBeenCalled()
  expect(screen.queryByText('Sharing updated')).not.toBeInTheDocument()
})

test('leaving the page during the pause still saves the choice', async () => {
  vi.useFakeTimers()
  const onSave = vi.fn().mockResolvedValue(undefined)
  const { unmount } = mountCard(onSave)
  choose(/No sharing/)
  unmount()
  expect(onSave.mock.calls).toEqual([['none']])
  await pass(1000)
  expect(onSave).toHaveBeenCalledTimes(1)
})

test('a change made during a save goes after it, so the last choice wins', async () => {
  vi.useFakeTimers()
  let finish = () => {}
  const onSave = vi.fn<(level: SharingLevel) => Promise<void>>().mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  )
  onSave.mockResolvedValue(undefined)
  mountCard(onSave)
  choose(/Balances only/)
  await pass(300)
  choose(/No sharing/)
  await pass(1000)
  expect(onSave.mock.calls).toEqual([['balances']])
  expect(screen.getByRole('radio', { name: /No sharing/ })).toBeChecked()
  finish()
  await pass(0)
  expect(onSave.mock.calls).toEqual([['balances'], ['none']])
})

test('going back to the original level during a save still saves it', async () => {
  vi.useFakeTimers()
  let finish = () => {}
  const onSave = vi.fn<(level: SharingLevel) => Promise<void>>().mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  )
  onSave.mockResolvedValue(undefined)
  mountCard(onSave)
  choose(/No sharing/)
  await pass(300)
  choose(/Hide transactions/)
  await pass(300)
  finish()
  await pass(0)
  expect(onSave.mock.calls).toEqual([['none'], ['hide-transactions']])
})

test('moving by keyboard keeps focus while a save runs', async () => {
  const onSave = vi.fn(() => new Promise<void>(() => {}))
  mountCard(onSave)
  screen.getByRole('radio', { name: /Hide transactions/ }).focus()
  await userEvent.keyboard('{ArrowDown}')
  const balances = screen.getByRole('radio', { name: /Balances only/ })
  expect(balances).toHaveFocus()
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('balances'))
  expect(balances).toHaveFocus()
  expect(balances).toBeEnabled()
  await userEvent.keyboard('{ArrowDown}')
  expect(screen.getByRole('radio', { name: /No sharing/ })).toHaveFocus()
  expect(screen.getByRole('radio', { name: /No sharing/ })).toBeChecked()
})
