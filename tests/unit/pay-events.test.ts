import { expect, test } from 'vitest'
import { derivePayEvents, type PayDeposit } from '../../src/server/budgets/pay-events'

const dep = (txId: string, localDate: string, amountCents = 400000): PayDeposit => ({
  txId,
  localDate,
  amountCents,
})
const detected = (payDate: string, txId: string, extraTxIds: string[] = []) => ({
  payDate,
  source: 'detected',
  txId,
  amountCents: 400000,
  extraTxIds,
})
const placeholder = (payDate: string) => ({
  payDate,
  source: 'scheduled',
  txId: null,
  amountCents: null,
  extraTxIds: [],
})

test('empty', () => {
  expect(derivePayEvents([], '2026-01-01')).toEqual([])
})

test('first event is the earliest deposit', () => {
  expect(derivePayEvents([dep('a', '2026-01-01')], '2026-01-02')).toEqual([detected('2026-01-01', 'a')])
})

test('on-time and early pays start new events at their dates', () => {
  const deposits = [dep('a', '2026-01-01'), dep('b', '2026-01-15'), dep('c', '2026-01-26')]
  expect(derivePayEvents(deposits, '2026-01-27')).toEqual([
    detected('2026-01-01', 'a'),
    detected('2026-01-15', 'b'),
    detected('2026-01-26', 'c'),
  ])
})

test('late pay within 5 days keeps the expected date', () => {
  expect(derivePayEvents([dep('a', '2026-01-01'), dep('b', '2026-01-19')], '2026-01-20')).toEqual([
    detected('2026-01-01', 'a'),
    { payDate: '2026-01-15', source: 'scheduled', txId: 'b', amountCents: 400000, extraTxIds: [] },
  ])
})

test('very late pay attaches to its empty placeholder', () => {
  expect(derivePayEvents([dep('a', '2026-01-01'), dep('b', '2026-01-22')], '2026-01-23')).toEqual([
    detected('2026-01-01', 'a'),
    { payDate: '2026-01-15', source: 'scheduled', txId: 'b', amountCents: 400000, extraTxIds: [] },
  ])
})

test('missed pay leaves a placeholder and the next deposit starts a new event', () => {
  expect(derivePayEvents([dep('a', '2026-01-01'), dep('b', '2026-01-27')], '2026-01-28')).toEqual([
    detected('2026-01-01', 'a'),
    placeholder('2026-01-15'),
    detected('2026-01-27', 'b'),
  ])
})

test('a deposit soon after pay is extra income', () => {
  expect(derivePayEvents([dep('a', '2026-01-01'), dep('b', '2026-01-04', 50000)], '2026-01-05')).toEqual([
    detected('2026-01-01', 'a', ['b']),
  ])
})

test('trailing placeholders appear once pay is more than 2 days overdue', () => {
  expect(derivePayEvents([dep('a', '2026-01-01')], '2026-01-18')).toEqual([
    detected('2026-01-01', 'a'),
    placeholder('2026-01-15'),
  ])
  expect(derivePayEvents([dep('a', '2026-01-01')], '2026-01-17')).toEqual([detected('2026-01-01', 'a')])
})

test('deterministic, and a late deposit never moves a stored pay date', () => {
  const deposits = [dep('a', '2026-01-01'), dep('b', '2026-01-19')]
  expect(derivePayEvents(deposits, '2026-01-20')).toEqual(derivePayEvents(deposits, '2026-01-20'))
  const before = derivePayEvents([dep('a', '2026-01-01')], '2026-01-18')
  const after = derivePayEvents(deposits, '2026-01-20')
  expect(before.map((e) => e.payDate)).toEqual(after.map((e) => e.payDate))
})
