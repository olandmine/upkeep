import { expect, test } from 'vitest'
import { mapTransaction } from '../../src/server/sync/map'
import { buildTransaction } from '../fake-up/builders'

const ctx = {
  users: [
    { id: 'u1', upDisplayName: 'Jordan' },
    { id: 'u2', upDisplayName: 'alex' },
  ],
  knownAccountIds: new Set(['acc-1', 'acc-saver']),
  syncedAt: '2026-10-29T00:00:00.000Z',
}

test('normalises createdAt and settledAt to UTC', () => {
  const { row } = mapTransaction(
    buildTransaction({ id: 't1', accountId: 'acc-1', amountCents: -100, createdAt: '2026-10-29T10:15:30+11:00' }),
    ctx,
  )
  expect(row.createdAt).toBe('2026-10-28T23:15:30.000Z')
  expect(row.settledAt).toBe('2026-10-28T23:15:30.000Z')
})

test('uses valueInBaseUnits for every amount', () => {
  const { row } = mapTransaction(
    buildTransaction({
      id: 't1',
      accountId: 'acc-1',
      amountCents: -1230,
      createdAt: '2026-10-29T00:00:00Z',
      roundUpCents: -70,
      cashbackCents: 500,
      foreignAmountCents: -899,
      foreignCurrency: 'USD',
    }),
    ctx,
  )
  expect(row).toMatchObject({
    amountCents: -1230,
    currency: 'AUD',
    roundUpCents: -70,
    cashbackCents: 500,
    foreignAmountCents: -899,
    foreignCurrency: 'USD',
  })
})

test('maps descriptive fields, card, category and tags', () => {
  const { row, tags } = mapTransaction(
    buildTransaction({
      id: 't1',
      accountId: 'acc-1',
      amountCents: -100,
      createdAt: '2026-10-29T00:00:00Z',
      status: 'HELD',
      description: 'Woolworths',
      message: 'snacks',
      rawText: 'WOOLWORTHS 1234',
      categoryId: 'groceries',
      parentCategoryId: 'home',
      isCategorizable: true,
      cardMethod: 'CONTACTLESS',
      cardSuffix: '1234',
      tags: ['a', 'b'],
    }),
    ctx,
  )
  expect(row).toMatchObject({
    id: 't1',
    accountId: 'acc-1',
    status: 'HELD',
    settledAt: null,
    description: 'Woolworths',
    message: 'snacks',
    rawText: 'WOOLWORTHS 1234',
    categoryId: 'groceries',
    parentCategoryId: 'home',
    isCategorizable: true,
    cardMethod: 'CONTACTLESS',
    cardSuffix: '1234',
    deletedAt: null,
    syncedAt: ctx.syncedAt,
  })
  expect(JSON.parse(row.rawJson).id).toBe('t1')
  expect(tags).toEqual(['a', 'b'])
})

test('maps performingCustomer case-insensitively', () => {
  const { row } = mapTransaction(
    buildTransaction({ id: 't1', accountId: 'acc-1', amountCents: -100, createdAt: '2026-10-29T00:00:00Z', performingCustomer: 'ALEX' }),
    ctx,
  )
  expect(row.performingCustomer).toBe('ALEX')
  expect(row.performedByUserId).toBe('u2')
})

test('matches the Up $handle with or without the leading $', () => {
  // On 2Up, performingCustomer.displayName is the customer's $handle.
  const base = { accountId: 'acc-1', amountCents: -100, createdAt: '2026-10-29T00:00:00Z' }
  const users = [
    { id: 'u1', upDisplayName: 'jordan' },
    { id: 'u2', upDisplayName: '$Alex' },
  ]
  const map = (id: string, performingCustomer: string) =>
    mapTransaction(buildTransaction({ ...base, id, performingCustomer }), { ...ctx, users }).row.performedByUserId
  expect(map('t1', '$jordan')).toBe('u1')
  expect(map('t2', '$alex')).toBe('u2')
  expect(map('t3', 'alex')).toBe('u2')
})

test('a round-up is a transfer on the Saver side and never spending', () => {
  // Real shape: one credit on the Saver, linked back to Spending; the purchase carries only roundUp.
  const { row } = mapTransaction(
    buildTransaction({
      id: 't1',
      accountId: 'acc-saver',
      amountCents: 196,
      createdAt: '2026-10-29T19:03:46+11:00',
      description: 'Round Up',
      isCategorizable: false,
      transferAccountId: 'acc-1',
    }),
    ctx,
  )
  expect(row).toMatchObject({ isTransfer: true, performedByUserId: null })
})

test('flags transfers to known accounts only', () => {
  const base = { accountId: 'acc-1', amountCents: -100, createdAt: '2026-10-29T00:00:00Z' }
  expect(mapTransaction(buildTransaction({ ...base, id: 't1', transferAccountId: 'acc-saver' }), ctx).row.isTransfer).toBe(true)
  expect(mapTransaction(buildTransaction({ ...base, id: 't2', transferAccountId: 'acc-other' }), ctx).row.isTransfer).toBe(false)
  expect(mapTransaction(buildTransaction({ ...base, id: 't3' }), ctx).row.isTransfer).toBe(false)
})

test('maps transactionType', () => {
  const base = { id: 't1', accountId: 'acc-1', amountCents: 196, createdAt: '2026-10-29T00:00:00Z' }
  expect(mapTransaction(buildTransaction({ ...base, transactionType: 'Round Up' }), ctx).row.transactionType).toBe('Round Up')
  expect(mapTransaction(buildTransaction(base), ctx).row.transactionType).toBeNull()
})
