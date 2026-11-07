import { expect, test } from 'vitest'
import { rangeSpan } from '../../src/server/payflow/range'

const TODAY = '2026-11-01'

test('a past month runs first to first, and steps either way', () => {
  expect(rangeSpan('month', '2026-02-14', TODAY)).toEqual({
    start: '2026-02-01',
    end: '2026-03-01',
    prevDate: '2026-01-01',
    nextDate: '2026-03-01',
    isCurrent: false,
  })
  expect(rangeSpan('month', '2026-01-31', TODAY)).toMatchObject({ prevDate: '2025-12-01', end: '2026-02-01' })
})

test('the current period runs to today and has no next', () => {
  expect(rangeSpan('month', TODAY, TODAY)).toEqual({
    start: '2026-11-01',
    end: null,
    prevDate: '2026-10-01',
    nextDate: null,
    isCurrent: true,
  })
  expect(rangeSpan('year', '2026-03-03', TODAY)).toMatchObject({ start: '2026-01-01', end: null, isCurrent: true })
})

test('a calendar year', () => {
  expect(rangeSpan('year', '2024-02-29', TODAY)).toEqual({
    start: '2024-01-01',
    end: '2025-01-01',
    prevDate: '2023-01-01',
    nextDate: '2025-01-01',
    isCurrent: false,
  })
})

test('a financial year runs 1 July to 30 June', () => {
  expect(rangeSpan('fy', '2026-06-30', TODAY)).toEqual({
    start: '2025-07-01',
    end: '2026-07-01',
    prevDate: '2024-07-01',
    nextDate: '2026-07-01',
    isCurrent: false,
  })
  expect(rangeSpan('fy', '2026-07-01', TODAY)).toMatchObject({ start: '2026-07-01', end: null, isCurrent: true })
})

test('a date after today is clamped to the current period', () => {
  expect(rangeSpan('month', '2027-05-05', TODAY)).toMatchObject({ start: '2026-11-01', isCurrent: true })
})
