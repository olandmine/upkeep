import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ScopeSwitcher } from '../../src/web/components/shell/ScopeSwitcher'
import { SyncIndicatorView } from '../../src/web/components/shell/SyncIndicator'
import type { SyncStatusDto } from '../../src/shared/types'

const now = new Date('2026-10-29T10:00:00Z')
type Conn = SyncStatusDto['connections'][number]
const conn = (c: Partial<Conn>): SyncStatusDto => ({
  connections: [
    {
      userId: 'u1',
      displayName: 'Owner',
      status: 'ok',
      lastSyncedAt: '2026-10-29T09:58:00Z',
      lastError: null,
      lastFailedAt: null,
      backfillCompletedAt: '2026-10-01T00:00:00Z',
      running: null,
      ...c,
    },
  ],
})

test('SyncIndicator states', () => {
  const { rerender } = render(<SyncIndicatorView status={conn({})} now={now} />)
  expect(screen.getByText('Synced 2 min ago')).toBeInTheDocument()

  rerender(<SyncIndicatorView status={conn({ running: { kind: 'incremental', startedAt: now.toISOString(), transactionsUpserted: 0 } })} now={now} />)
  expect(screen.getByText('Syncing…')).toBeInTheDocument()

  rerender(<SyncIndicatorView status={conn({ status: 'unauthorized' })} now={now} />)
  expect(screen.getByRole('link', { name: /Bank connection needs attention/ })).toHaveAttribute('href', '/settings')

  // 10:42 in Australia/Sydney (AEDT, +11) is 23:42Z the day before
  rerender(<SyncIndicatorView status={conn({ status: 'error', lastFailedAt: '2026-10-28T23:42:00Z' })} now={now} tz="Australia/Sydney" />)
  expect(screen.getByText('Last sync failed 10:42, retrying')).toBeInTheDocument()

  rerender(<SyncIndicatorView status={{ connections: [] }} now={now} />)
  expect(screen.getByRole('link', { name: /Connect Up/ })).toHaveAttribute('href', '/settings')
})

test('ScopeSwitcher reports the chosen scope', async () => {
  const onChange = vi.fn()
  render(<ScopeSwitcher value="everyone" onChange={onChange} />)
  expect(screen.getByRole('button', { name: 'Everyone' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'Joint' }))
  expect(onChange).toHaveBeenCalledWith('joint')
  expect(screen.getByRole('button', { name: 'Joint' })).toHaveAttribute('aria-pressed', 'false')
})
