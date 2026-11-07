import { expect, test } from 'vitest'
import { addDays, addMonthsClamped, dayOfMonth, diffDays, localDate, periodRangeUtc, todayLocal } from '../../src/server/budgets/dates'

const TZ = 'Australia/Sydney'

test('localDate puts a 00:01 deposit on the new day (AEDT)', () => {
  expect(localDate('2026-10-29T13:01:00Z', TZ)).toBe('2026-10-30')
})

test('localDate keeps 23:59 on the same day', () => {
  expect(localDate('2026-10-30T12:59:00Z', TZ)).toBe('2026-10-30')
})

test('addDays crosses a year', () => {
  expect(addDays('2026-12-25', 14)).toBe('2027-01-08')
})

test('diffDays counts whole days a − b', () => {
  expect(diffDays('2026-11-12', '2026-10-30')).toBe(13)
})

test('periodRangeUtc spans the October daylight-saving change', () => {
  expect(periodRangeUtc('2026-09-24', '2026-10-08', TZ)).toEqual({
    start: '2026-09-23T14:00:00.000Z',
    end: '2026-10-07T13:00:00.000Z',
  })
})

test('todayLocal uses the configured timezone', () => {
  expect(todayLocal(new Date('2026-10-29T14:30:00Z'), TZ)).toBe('2026-10-30')
})

test('addMonthsClamped clamps to month end', () => {
  expect(addMonthsClamped('2026-01-31', 1, 31)).toBe('2026-02-28')
  expect(addMonthsClamped('2028-01-31', 1, 31)).toBe('2028-02-29')
  expect(addMonthsClamped('2026-10-31', 1, 31)).toBe('2026-11-30')
  expect(addMonthsClamped('2026-11-30', 1, 31)).toBe('2026-12-31')
  expect(addMonthsClamped('2026-03-15', -3, 15)).toBe('2025-12-15')
  expect(dayOfMonth('2026-10-30')).toBe(30)
})
