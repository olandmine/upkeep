import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { AccountDto, GoalDto } from '../../src/shared/types'
import { AccountsView } from '../../src/web/components/accounts/AccountsView'
import { groupAccounts } from '../../src/web/lib/group-accounts'

const account = (a: Partial<AccountDto>): AccountDto => ({
  id: 'acc',
  displayName: 'Spending',
  accountType: 'TRANSACTIONAL',
  ownership: 'INDIVIDUAL',
  ownerUserId: 'u1',
  ownerName: 'Owner',
  balanceCents: 1000,
  currency: 'AUD',
  colorIndex: 0,
  ...a,
})

const goal = (over: Partial<GoalDto> = {}): GoalDto => ({
  accountId: 's1',
  saverName: 'Emergency',
  balanceCents: 600_000,
  ownerUserId: 'u1',
  goal: { kind: 'save', name: 'Rainy day', targetCents: 1_000_000, targetDate: null },
  progress: 0.6,
  status: 'on-track',
  neededCents: 9_500,
  neededPer: 'pay',
  behindCents: null,
  projectedDate: null,
  toGoCents: null,
  expectedProgress: null,
  belowCents: null,
  recentRateCents: null,
  debtFallCents: null,
  followedDebtName: null,
  reachedOn: null,
  celebrate: false,
  ownerName: null,
  debt: null,
  plan: null,
  cadence: null,
  saverOutCents: null,
  sparkline: null,
  today: '2026-10-30',
  canEdit: true,
  accountMissing: false,
  ...over,
})

const everyday = account({ id: 't1', displayName: 'Everyday', balanceCents: 250_000 })
const twoUp = account({
  id: 'j1',
  displayName: '2Up',
  ownership: 'JOINT',
  ownerUserId: null,
  ownerName: null,
  balanceCents: 50_000,
})
const emergency = account({ id: 's1', displayName: 'Emergency', accountType: 'SAVER', balanceCents: 600_000 })
const holiday = account({ id: 's2', displayName: 'Holiday', accountType: 'SAVER', balanceCents: 100_000 })
const deposit = account({
  id: 'sj',
  displayName: 'House deposit',
  accountType: 'SAVER',
  ownership: 'JOINT',
  ownerUserId: null,
  ownerName: null,
  balanceCents: 1_000_000,
})
const mortgage = account({ id: 'h1', displayName: 'Mortgage', accountType: 'HOME_LOAN', balanceCents: -40_000_000 })
const household = [everyday, twoUp, emergency, holiday, deposit, mortgage]

const view = (props: Partial<Parameters<typeof AccountsView>[0]> = {}) =>
  render(<AccountsView scope="everyone" connected accounts={household} {...props} />)
const stat = (label: string) => screen.getByRole('group', { name: label })

test('groups and orders accounts', () => {
  const groups = groupAccounts([
    account({ id: 's1', accountType: 'SAVER', balanceCents: 500 }),
    account({ id: 't1', balanceCents: 1000 }),
    account({ id: 'h1', accountType: 'HOME_LOAN', balanceCents: -40000000 }),
    account({ id: 's2', accountType: 'SAVER', balanceCents: 250 }),
  ])
  expect(groups.map((g) => [g.label, g.accounts.map((a) => a.id), g.totalCents])).toEqual([
    ['Spending', ['t1'], 1000],
    ['Savers · Personal', ['s1', 's2'], 750],
    ['Home loan', ['h1'], -40000000],
  ])
})

test('puts the largest balance first in each group', () => {
  const [group] = groupAccounts([
    account({ id: 'small', balanceCents: 100 }),
    account({ id: 'large', balanceCents: 900 }),
    account({ id: 'middle', balanceCents: 500 }),
  ])
  expect(group!.accounts.map((a) => a.id)).toEqual(['large', 'middle', 'small'])
})

test('omits empty groups', () => {
  expect(groupAccounts([account({ id: 't1' })]).map((g) => g.label)).toEqual(['Spending'])
  expect(groupAccounts([])).toEqual([])
})

test('partner and not-connected empty states', () => {
  const { rerender } = render(<AccountsView scope="partner" connected accounts={[]} />)
  expect(screen.getByText("Your partner hasn't connected Up yet.")).toBeInTheDocument()
  rerender(<AccountsView scope="everyone" connected={false} accounts={[]} />)
  expect(screen.getByRole('link', { name: /Connect Up/ })).toHaveAttribute('href', '/settings')
})

test('the summary totals everything except the home loan', () => {
  view()
  expect(stat('Total balance')).toHaveTextContent('$20,000.00')
  expect(stat('Total balance')).toHaveTextContent('5 accounts')
  expect(stat('Spending')).toHaveTextContent('$3,000.00')
  expect(stat('Spending')).toHaveTextContent('2 accounts')
  expect(stat('Savers')).toHaveTextContent('$17,000.00')
  expect(stat('Home loan')).toHaveTextContent('−$400,000.00')
  expect(stat('Home loan')).toHaveTextContent('Not in total')
})

test('a scope without Savers or a home loan hides those figures', () => {
  view({ accounts: [everyday] })
  expect(stat('Total balance')).toHaveTextContent('1 account')
  expect(stat('Spending')).toHaveTextContent('$2,500.00')
  expect(screen.queryByRole('group', { name: 'Savers' })).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Home loan' })).not.toBeInTheDocument()
})

test('the bar shows each group as a share of positive balances', () => {
  view()
  expect(screen.getAllByRole('img').map((bar) => bar.getAttribute('aria-label'))).toEqual([
    'Spending: 15% of balances',
    'Savers · Personal: 35% of balances',
    'Savers · Joint: 50% of balances',
  ])
  expect(screen.getByTitle('Everyday: $2,500.00')).toBeInTheDocument()
  expect(screen.queryByTitle(/^Mortgage/)).not.toBeInTheDocument()
})

test('a group too small to round up still shows in the bar', () => {
  view({ accounts: [deposit, account({ id: 't1', balanceCents: 1_000 })] })
  expect(screen.getByRole('img', { name: 'Spending: <1% of balances' })).toBeInTheDocument()
})

test('a negative balance counts in the total and gets a row but no bar segment', () => {
  const overdrawn = account({ id: 'o', displayName: 'Overdrawn', balanceCents: -50_000 })
  view({ accounts: [everyday, overdrawn] })
  expect(stat('Total balance')).toHaveTextContent('$2,000.00')
  expect(screen.getByRole('link', { name: /Overdrawn/ })).toHaveTextContent('−$500.00')
  expect(screen.queryByTitle(/^Overdrawn/)).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Spending: 100% of balances' })).toBeInTheDocument()
})

test('with no positive balances the bar is hidden and the rows remain', () => {
  view({ accounts: [account({ id: 'z', displayName: 'Empty', balanceCents: 0 }), mortgage] })
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Empty/ })).toHaveTextContent('$0.00')
  expect(screen.getByRole('link', { name: /Mortgage/ })).toHaveTextContent('−$400,000.00')
})

test('each group lists its accounts as links under its total', () => {
  view()
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
    'Spending',
    'Savers · Personal',
    'Savers · Joint',
    'Home loan',
  ])
  const savers = screen.getByRole('region', { name: 'Savers · Personal' })
  expect(within(savers).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
    '/accounts/s1',
    '/accounts/s2',
  ])
  expect(savers).toHaveTextContent('$7,000.00')
})

test('a row names the owner, or Joint when shared', () => {
  view()
  expect(screen.getByRole('link', { name: /Everyday/ })).toHaveTextContent('Owner')
  expect(screen.getByRole('link', { name: /2Up/ })).toHaveTextContent('Joint')
})

test('a Saver with a goal shows its progress and status', () => {
  view({ goals: [goal()] })
  const row = screen.getByRole('link', { name: /Emergency/ })
  expect(row).toHaveTextContent('60% of $10,000')
  expect(row).toHaveTextContent('On track · $95.00 per pay')
  expect(within(row).getByRole('meter', { name: 'Emergency goal progress' })).toHaveAttribute('aria-valuenow', '60')
})

test('a goal target keeps cents only when it has them', () => {
  view({ goals: [goal({ goal: { kind: 'save', name: 'Rainy day', targetCents: 1_000_050, targetDate: null } })] })
  expect(screen.getByRole('link', { name: /Emergency/ })).toHaveTextContent('60% of $10,000.50')
})

test('a reached goal says so', () => {
  view({ goals: [goal({ progress: 1, status: 'reached' })] })
  const row = screen.getByRole('link', { name: /Emergency/ })
  expect(row).toHaveTextContent('Reached ✓')
  expect(within(row).getByRole('meter')).toHaveAttribute('aria-valuenow', '100')
})

test('rows stay without goals before they load, and for Savers with no goal or a missing Saver', () => {
  view()
  expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Emergency/ })).toHaveTextContent('$6,000.00')
  view({
    goals: [
      goal({ goal: null, status: null }),
      goal({ accountId: 's2', saverName: null, accountMissing: true }),
    ],
  })
  expect(screen.queryByRole('meter')).not.toBeInTheDocument()
})

test('the Savers figure counts goals and those needing attention', () => {
  view({
    goals: [
      goal({ accountId: 's1', status: 'on-track' }),
      goal({ accountId: 's2', status: 'behind', behindCents: 6_000 }),
      goal({ accountId: 'sj', status: 'date-passed' }),
      goal({ accountId: 'gone', accountMissing: true, status: 'behind' }),
    ],
  })
  expect(stat('Savers')).toHaveTextContent('3 goals · 2 behind')
})

test('the Savers figure leaves out the behind count when no goal is behind', () => {
  view({ goals: [goal()] })
  expect(stat('Savers')).toHaveTextContent('1 goal')
  expect(stat('Savers')).not.toHaveTextContent('behind')
})

test('with no goals the Savers figure counts accounts', () => {
  view()
  expect(stat('Savers')).toHaveTextContent('3 accounts')
})
