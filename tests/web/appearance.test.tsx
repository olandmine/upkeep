import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { ACCENTS } from '../../src/shared/accent'
import type { UserDto } from '../../src/shared/types'
import { AppearanceCard } from '../../src/web/components/settings/AppearanceCard'
import { ToastProvider } from '../../src/web/components/ui/Toast'
import { useAccent } from '../../src/web/lib/accent'
import { meQuery } from '../../src/web/lib/queries'

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

function Harness() {
  const { data } = useQuery({ ...meQuery, enabled: false })
  useAccent(data?.accent ?? 'amber')
  return <AppearanceCard value={data?.accent ?? 'amber'} />
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(meQuery.queryKey, me)
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Harness />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

const respondWith = (...responses: (() => Response)[]) => {
  const fetchMock = vi.fn(async () => (responses.length > 1 ? responses.shift()! : responses[0]!)())
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const saved = () => new Response(JSON.stringify(me), { status: 200, headers: { 'content-type': 'application/json' } })
const failed = () => new Response(JSON.stringify({ error: 'Nope' }), { status: 500, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.accent
})

test('offers each colour, with the current one chosen', () => {
  respondWith(saved)
  renderCard()
  for (const name of ['Amber', 'Blue', 'Violet', 'Rose', 'Teal', 'Slate']) {
    expect(screen.getByRole('radio', { name })).toBeInTheDocument()
  }
  expect(screen.getByRole('radio', { name: 'Amber' })).toBeChecked()
})

test('picking a colour applies straight away and saves it', async () => {
  const fetchMock = respondWith(saved)
  const queryClient = renderCard()
  await userEvent.click(screen.getByRole('radio', { name: 'Teal' }))
  expect(document.documentElement.dataset.accent).toBe('teal')
  expect(screen.getByRole('radio', { name: 'Teal' })).toBeChecked()
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(String(url)).toContain('/api/me')
  expect(init.method).toBe('PATCH')
  expect(JSON.parse(init.body as string)).toEqual({ accent: 'teal' })
  expect(queryClient.getQueryData<UserDto>(meQuery.queryKey)?.accent).toBe('teal')
})

test('a failed save goes back to the previous colour and says so', async () => {
  respondWith(failed)
  renderCard()
  await userEvent.click(screen.getByRole('radio', { name: 'Rose' }))
  expect(await screen.findByText('Nope')).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Amber' })).toBeChecked()
  expect(document.documentElement.dataset.accent).toBeUndefined()
})

test('an earlier failure does not undo a later pick', async () => {
  respondWith(failed, saved)
  renderCard()
  await userEvent.click(screen.getByRole('radio', { name: 'Rose' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Blue' }))
  expect(await screen.findByText('Nope')).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Blue' })).toBeChecked()
  expect(document.documentElement.dataset.accent).toBe('blue')
})

test('leaving the app puts the default back', () => {
  const { unmount, rerender } = renderHook(({ accent }) => useAccent(accent), {
    initialProps: { accent: 'violet' as UserDto['accent'] },
  })
  expect(document.documentElement.dataset.accent).toBe('violet')
  rerender({ accent: 'amber' })
  expect(document.documentElement.dataset.accent).toBeUndefined()
  rerender({ accent: 'slate' })
  unmount()
  expect(document.documentElement.dataset.accent).toBeUndefined()
})

test('every colour but the default has its tokens, and the shades follow the accent', () => {
  const css = readFileSync('src/web/styles/tokens.css', 'utf8')
  for (const accent of ACCENTS.filter((a) => a !== 'amber')) {
    const rule = css.match(new RegExp(`:root\\[data-accent='${accent}'\\]\\s*{([^}]*)}`))?.[1]
    expect(rule, accent).toContain('--accent:')
    expect(rule, accent).toContain('--accent-hover:')
  }
  expect(css).toContain('--accent-muted: color-mix(in srgb, var(--accent) 12%, transparent)')
  expect(css).toContain('--accent-glow: color-mix(in srgb, var(--accent) 35%, transparent)')
})
