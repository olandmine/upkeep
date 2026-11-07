import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { SyncStatusDto, UserDto } from '../../src/shared/types'
import { BankConnectionCard } from '../../src/web/components/settings/BankConnectionCard'
import { ProfileCard } from '../../src/web/components/settings/ProfileCard'
import { UsersCard } from '../../src/web/components/settings/UsersCard'
import { ApiError } from '../../src/web/lib/api'

type Conn = SyncStatusDto['connections'][number]
const now = new Date('2026-10-29T10:00:00Z')
const conn = (c: Partial<Conn> = {}): Conn => ({
  userId: 'u1',
  displayName: 'Owner',
  status: 'ok',
  lastSyncedAt: '2026-10-29T09:58:00Z',
  lastError: null,
  lastFailedAt: null,
  backfillCompletedAt: '2026-10-01T00:00:00Z',
  running: null,
  ...c,
})
const user = (u: Partial<UserDto>): UserDto => ({
  id: 'u1',
  username: 'owner',
  displayName: 'Owner',
  upDisplayName: null,
  negativeStyle: 'minus',
  accent: 'amber',
  connectUpAnswered: true,
  gettingStartedHidden: true,
  sharingLevel: 'full',
  ...u,
})
const noop = async () => {}

test('shows backfill progress', () => {
  render(
    <BankConnectionCard
      connection={conn({ backfillCompletedAt: null, running: { kind: 'backfill', startedAt: now.toISOString(), transactionsUpserted: 3214 } })}
      now={now}
      onConnect={noop}
      onDisconnect={noop}
      onSyncNow={noop}
    />,
  )
  expect(screen.getByText('Imported 3,214 transactions…')).toBeInTheDocument()
})

test('shows token rejection inline', async () => {
  const onConnect = vi.fn().mockRejectedValue(new ApiError(400, "Up didn't accept that token"))
  render(<BankConnectionCard connection={undefined} now={now} onConnect={onConnect} onDisconnect={noop} onSyncNow={noop} />)
  const input = screen.getByLabelText('Up personal access token')
  await userEvent.type(input, 'up:yeah:wrong')
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
  expect(onConnect).toHaveBeenCalledWith('up:yeah:wrong')
  expect(await screen.findByText("Up didn't accept that token")).toBeInTheDocument()
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveFocus()
})

test('needs-attention connection explains what to do', () => {
  render(<BankConnectionCard connection={conn({ status: 'unauthorized' })} now={now} onConnect={noop} onDisconnect={noop} onSyncNow={noop} />)
  expect(screen.getByText('Needs attention')).toBeInTheDocument()
  expect(screen.getByLabelText('Up personal access token')).toBeInTheDocument()
})

test('disconnect requires confirmation', async () => {
  const onDisconnect = vi.fn().mockResolvedValue(undefined)
  render(<BankConnectionCard connection={conn()} now={now} onConnect={noop} onDisconnect={onDisconnect} onSyncNow={noop} />)
  expect(screen.getByText('Last synced 2 min ago')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
  expect(await screen.findByText('Disconnect Up? Synced transactions stay; syncing stops until you add a token again.')).toBeInTheDocument()
  expect(onDisconnect).not.toHaveBeenCalled()
  const dialog = screen.getByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
  await waitFor(() => expect(onDisconnect).toHaveBeenCalledOnce())
})

test('add partner hidden when two users exist', () => {
  const { rerender } = render(<UsersCard users={[user({})]} onAddPartner={noop} />)
  expect(screen.getByRole('button', { name: 'Add partner' })).toBeInTheDocument()
  rerender(<UsersCard users={[user({}), user({ id: 'u2', username: 'partner', displayName: 'Partner' })]} onAddPartner={noop} />)
  expect(screen.queryByRole('button', { name: 'Add partner' })).not.toBeInTheDocument()
  expect(screen.getByText('Partner')).toBeInTheDocument()
})

test('profile saves negative style and Up $handle', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(<ProfileCard me={user({})} onSave={onSave} />)
  await userEvent.type(screen.getByLabelText('Your Up $handle'), '$owner')
  await userEvent.click(screen.getByLabelText(/Parentheses/))
  await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
  expect(onSave).toHaveBeenCalledWith({ displayName: 'Owner', upDisplayName: '$owner', negativeStyle: 'parentheses' })
})

