import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { debtsTimelineQuery, meQuery, setupStatusQuery } from '../../src/web/lib/queries'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('setup status keeps retrying while the API is still starting', async () => {
  vi.useFakeTimers()
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('fetch failed')) // nothing listening yet
    .mockResolvedValueOnce(new Response('proxy error', { status: 500 })) // dev proxy can't reach it
    .mockResolvedValueOnce(Response.json({ needsSetup: true }))
  vi.stubGlobal('fetch', fetchMock)

  const pending = new QueryClient().fetchQuery(setupStatusQuery)
  await vi.advanceTimersByTimeAsync(5_000)
  await expect(pending).resolves.toEqual({ needsSetup: true })
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

test('a 401 from /api/me is not retried', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: 'Not logged in' }, { status: 401 }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(new QueryClient().fetchQuery(meQuery)).rejects.toMatchObject({ status: 401 })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('the debts total timeline refreshes with debt edits', () => {
  expect(debtsTimelineQuery('me', 'fy').queryKey).toEqual(['debts', 'me', 'timeline', 'fy'])
})
