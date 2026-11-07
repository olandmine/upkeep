import { expect, test } from 'vitest'
import { currentMonth, monthRangeUtc, shiftMonth } from '../../src/server/queries/time'

test('month ranges follow the local timezone across DST changes', () => {
  // AEDT (+11) ends on the first Sunday of April: April starts at +11 and ends at +10
  expect(monthRangeUtc('2026-04', 'Australia/Sydney')).toEqual({
    start: '2026-03-31T13:00:00.000Z',
    end: '2026-04-30T14:00:00.000Z',
  })
  expect(monthRangeUtc('2026-11', 'Australia/Sydney')).toEqual({
    start: '2026-10-31T13:00:00.000Z',
    end: '2026-11-30T13:00:00.000Z',
  })
  expect(monthRangeUtc('2026-12', 'UTC')).toEqual({ start: '2026-12-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' })
})

test('current month is the local month', () => {
  expect(currentMonth(new Date('2026-10-31T13:30:00Z'), 'Australia/Sydney')).toBe('2026-11')
  expect(currentMonth(new Date('2026-10-31T12:30:00Z'), 'Australia/Sydney')).toBe('2026-10')
})

test('shiftMonth crosses year boundaries', () => {
  expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  expect(shiftMonth('2026-11', -5)).toBe('2026-06')
  expect(shiftMonth('2026-12', 1)).toBe('2027-01')
})
