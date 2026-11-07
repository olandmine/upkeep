import { expect, test } from 'vitest'
import { pairTransfers, type TransferLeg } from '../../src/shared/transfers'

const T0 = '2026-11-04T01:00:00.000Z'
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString()

const out = (id: string, over: Partial<TransferLeg> = {}): TransferLeg => ({
  id,
  accountId: 'spending',
  transferAccountId: 'saver',
  amountCents: -5000,
  createdAt: T0,
  isTransfer: true,
  ...over,
})
const inc = (id: string, over: Partial<TransferLeg> = {}): TransferLeg =>
  out(id, { accountId: 'saver', transferAccountId: 'spending', amountCents: 5000, ...over })

const ids = (legs: TransferLeg[]) => pairTransfers(legs).map(([from, to]) => [from.id, to.id])

test('pairs the two sides of a transfer as outgoing then incoming, in either list order', () => {
  expect(ids([out('a'), inc('b')])).toEqual([['a', 'b']])
  expect(ids([inc('b'), out('a')])).toEqual([['a', 'b']])
})

test('needs mirrored accounts', () => {
  expect(ids([out('a'), inc('b', { accountId: 'other' })])).toEqual([])
  expect(ids([out('a'), inc('b', { transferAccountId: 'other' })])).toEqual([])
})

test('needs opposite amounts', () => {
  expect(ids([out('a'), inc('b', { amountCents: 4999 })])).toEqual([])
})

test('needs both sides within 60 seconds, inclusive', () => {
  expect(ids([out('a'), inc('b', { createdAt: at(60) })])).toEqual([['a', 'b']])
  expect(ids([out('a'), inc('b', { createdAt: at(61) })])).toEqual([])
  expect(ids([out('a'), inc('b', { createdAt: at(-61) })])).toEqual([])
})

test('the closest in time wins, and a side is only used once', () => {
  const legs = [out('a'), inc('far', { createdAt: at(30) }), inc('near', { createdAt: at(2) }), out('c', { createdAt: at(25) })]
  expect(ids(legs)).toEqual([
    ['a', 'near'],
    ['c', 'far'],
  ])
})

test('leaves anything that is not a transfer, or has no other side, alone', () => {
  expect(ids([out('a', { isTransfer: false }), inc('b')])).toEqual([])
  expect(ids([inc('round-up')])).toEqual([])
  expect(ids([out('a', { transferAccountId: null }), inc('b', { transferAccountId: null })])).toEqual([])
})
