import { expect, test } from 'vitest'
import { findCrossPartnerTransferPairs, isTransfer } from '../../src/server/sync/transfers'

test('isTransfer requires a known transfer account', () => {
  const known = new Set(['acc-saver'])
  expect(isTransfer({ transferAccountId: 'acc-saver', description: 'Transfer to Savings' }, known)).toBe(true)
  expect(isTransfer({ transferAccountId: 'acc-unknown', description: 'Transfer' }, known)).toBe(false)
  expect(isTransfer({ transferAccountId: null, description: 'Coffee' }, known)).toBe(false)
})

const t0 = Date.parse('2026-10-20T00:00:00Z')
const at = (hours: number) => new Date(t0 + hours * 3_600_000).toISOString()
const row = (id: string, ownerUserId: string | null, amountCents: number, createdAt: string, transferAccountId: string | null = null) => ({
  id,
  accountId: `acc-${id}`,
  ownerUserId,
  amountCents,
  createdAt,
  transferAccountId,
})

test('pairs opposite amounts across partners within a day', () => {
  expect(findCrossPartnerTransferPairs([row('a', 'u1', -5000, at(0)), row('b', 'u2', 5000, at(3))])).toEqual([['a', 'b']])
})

test('does not pair the same owner, distant times, joint accounts or known transfers', () => {
  expect(findCrossPartnerTransferPairs([row('a', 'u1', -5000, at(0)), row('b', 'u1', 5000, at(3))])).toEqual([])
  expect(findCrossPartnerTransferPairs([row('a', 'u1', -5000, at(0)), row('b', 'u2', 5000, at(48))])).toEqual([])
  expect(findCrossPartnerTransferPairs([row('a', 'u1', -5000, at(0)), row('b', null, 5000, at(1))])).toEqual([])
  expect(findCrossPartnerTransferPairs([row('a', 'u1', -5000, at(0), 'acc-x'), row('b', 'u2', 5000, at(1))])).toEqual([])
})

test('pairs each transaction at most once, preferring the closest in time', () => {
  const pairs = findCrossPartnerTransferPairs([
    row('a', 'u1', -5000, at(0)),
    row('far', 'u2', 5000, at(20)),
    row('near', 'u2', 5000, at(1)),
  ])
  expect(pairs).toEqual([['a', 'near']])
})
