import { expect, test } from 'vitest'
import { debtFall } from '../../src/server/goals/debt-goal'

const days = [
  { date: '2026-09-01', balance: 100_000 }, { date: '2026-09-15', balance: 90_000 },
  { date: '2026-09-29', balance: 80_000 }, { date: '2026-10-13', balance: 70_000 },
]
const periods: [string, string][] = [['2026-09-11', '2026-09-25'], ['2026-09-25', '2026-10-09'], ['2026-10-09', '2026-10-23']]
test('fall per period', () => expect(debtFall(days, periods)).toBe(10_000)) // (100k − 70k) ÷ 3
test('a growing debt falls by a negative amount', () =>
  expect(debtFall(days.map((d, i) => ({ ...d, balance: 100_000 + i * 3_000 })), periods)).toBe(-3_000))
test('periods before the debt use its first balance', () =>
  expect(debtFall(days, [['2026-01-01', '2026-02-01']])).toBe(0))
test('no periods', () => expect(debtFall(days, [])).toBe(0))
