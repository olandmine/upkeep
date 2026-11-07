import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { NetWorthDto } from '../../src/shared/types'
import { NetWorthChart, NetWorthHeadline } from '../../src/web/components/networth/NetWorthChart'
import { NetWorthTile } from '../../src/web/components/networth/NetWorthTile'

const data = (over: Partial<NetWorthDto> = {}): NetWorthDto => ({
  points: [
    { date: '2026-10-23', upCents: 1_300_000, debtCents: 60_500, netCents: 1_239_500 },
    { date: '2026-10-30', upCents: 1_294_500, debtCents: 60_000, netCents: 1_234_500 },
  ],
  historyFrom: null,
  todayCents: 1_234_500,
  changeCents: -5_000,
  ...over,
})

test('headline and change', () => {
  render(<NetWorthHeadline data={data()} />)
  expect(screen.getByText('$12,345.00')).toBeInTheDocument()
  expect(screen.getByText('−$50.00')).toBeInTheDocument()
  expect(screen.getByText('since 23 Oct 2026')).toBeInTheDocument()
  expect(screen.queryByText(/History from/)).not.toBeInTheDocument()
})

test('history caption', () => {
  render(<NetWorthHeadline data={data({ historyFrom: '2025-03-02' })} />)
  expect(screen.getByText('History from 2 Mar 2025')).toBeInTheDocument()
})

test('table view lists points', async () => {
  render(<NetWorthChart points={data().points} />)
  await userEvent.click(screen.getByRole('button', { name: 'Show table' }))
  expect(screen.getAllByRole('row')).toHaveLength(3)
  expect(screen.getByText('$605.00')).toBeInTheDocument()
})

test('overview tile links to net worth', () => {
  render(<NetWorthTile data={data()} scope="me" />)
  expect(screen.getByText('Net worth')).toBeInTheDocument()
  expect(screen.getByText('$12,345.00')).toBeInTheDocument()
  expect(screen.getByRole('link')).toHaveAttribute('href', '/net-worth?scope=me')
})
