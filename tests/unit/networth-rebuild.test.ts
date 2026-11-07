import { expect, test } from 'vitest'
import { diffDays } from '../../src/server/budgets/dates'
import { debtSeries } from '../../src/server/goals/history'
import { historyStart, pointDates, rebuildTotals } from '../../src/server/networth/rebuild'

test('rebuild undoes round-ups and held', () => {
  // A −1,000 purchase plus its −196 round-up at 00:00 on 1 Oct (AEST); cutoffs are the next local midnight.
  const deltas = [{ at: '2026-09-30T14:00:00.000Z', cents: -1_196 }]
  expect(rebuildTotals(10_000, deltas, ['2026-09-30T14:00:00.000Z', '2026-10-01T14:00:00.000Z'])).toEqual([
    11_196, 10_000,
  ])
})

test('today equals balance now', () => {
  const deltas = [
    { at: '2026-10-29T01:00:00.000Z', cents: -500 },
    { at: '2026-10-30T01:00:00.000Z', cents: 2_000 },
  ]
  expect(rebuildTotals(7_000, deltas, ['2026-10-28T13:00:00.000Z', '2026-10-30T13:00:00.000Z'])).toEqual([
    5_500, 7_000,
  ])
})

test("history start flags an account that doesn't open at zero", () => {
  const account = (balanceNow: number) => ({
    type: 'TRANSACTIONAL',
    balanceNow,
    totalCents: 5_000,
    firstDate: '2025-03-02',
  })
  expect(historyStart([account(55_000)])).toBe('2025-03-02')
  expect(historyStart([account(5_050)])).toBeNull()
  const later = { type: 'SAVER', balanceNow: 900, totalCents: 100, firstDate: '2025-06-10' }
  expect(historyStart([account(55_000), later])).toBe('2025-06-10')
  expect(historyStart([{ type: 'SAVER', balanceNow: 900, totalCents: 0, firstDate: null }])).toBeNull()
})

test('home loan is not checked', () => {
  expect(
    historyStart([{ type: 'HOME_LOAN', balanceNow: -30_000_000, totalCents: 100, firstDate: '2024-01-01' }]),
  ).toBeNull()
})

test('point dates', () => {
  const six = pointDates('6m', '2026-10-30', '2020-01-01')
  expect(six.at(-1)).toBe('2026-10-30')
  expect(six[0]! >= '2026-04-30').toBe(true)
  expect(diffDays(six[1]!, six[0]!)).toBe(7)
  // Crossing the 4 Oct daylight-saving change stays 7 days apart.
  expect(six.filter((d) => d >= '2026-09-25' && d <= '2026-10-12')).toEqual([
    '2026-09-25',
    '2026-10-02',
    '2026-10-09',
  ])
  expect(pointDates('1y', '2026-10-30', '2020-01-01')[0]! >= '2025-10-30').toBe(true)

  expect(pointDates('all', '2026-10-30', '2025-11-12')).toEqual([
    '2025-11-30',
    '2025-12-31',
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
    '2026-05-31',
    '2026-06-30',
    '2026-07-31',
    '2026-08-31',
    '2026-09-30',
    '2026-10-30',
  ])
})

test('3m point dates are weekly back from today', () => {
  const dates = pointDates('3m', '2026-10-30', '2020-01-01')
  expect(dates.at(-1)).toBe('2026-10-30')
  expect(Math.abs(diffDays(dates[0]!, '2026-07-30'))).toBeLessThanOrEqual(7)
  dates.slice(1).forEach((d, i) => expect(diffDays(d, dates[i]!)).toBe(7))
})

test('debt series is the closing balance on each date, ending on what is left', () => {
  const days = [
    { date: '2026-09-01', balance: 100_000.4 },
    { date: '2026-10-01', balance: 90_000 },
  ]
  expect(debtSeries(days, ['2026-08-15', '2026-09-01', '2026-10-01', '2026-10-30'], 88_000)).toEqual([
    null,
    100_000,
    90_000,
    88_000,
  ])
  // The last known balance carries across dates the ledger has no row for.
  expect(debtSeries(days, ['2026-09-15', '2026-10-30'], 88_000)).toEqual([100_000, 88_000])
})
