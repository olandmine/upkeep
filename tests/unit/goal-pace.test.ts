import { expect, test } from 'vitest'
import { bufferStatus, expectedProgress, goalStatus, planOutcome, type Cadence } from '../../src/shared/goals/pace'

const TODAY = '2026-10-30'
const PAY: Cadence = { kind: 'pay', frequencyDays: 14, lastPayDate: '2026-10-23' }
const MONTH: Cadence = { kind: 'month' }

const status = (over: Partial<Parameters<typeof goalStatus>[0]>) =>
  goalStatus({
    balanceCents: 0,
    targetCents: 100_000,
    targetDate: null,
    today: TODAY,
    recentRateCents: 0,
    cadence: PAY,
    ...over,
  })

test('reached', () => {
  expect(status({ balanceCents: 120_000, targetDate: '2026-12-31' })).toMatchObject({
    status: 'reached',
    progress: 1,
    neededCents: null,
  })
})

test('needed per pay', () => {
  // Paydays 6 Nov, 20 Nov, 4 Dec and 18 Dec.
  expect(status({ targetDate: '2026-12-31' })).toMatchObject({ neededCents: 25_000, neededPer: 'pay' })
})

test('minimum of one payday', () => {
  expect(status({ balanceCents: 40_000, targetDate: '2026-11-01' })).toMatchObject({
    neededCents: 60_000,
    neededPer: 'pay',
    progress: 0.4,
  })
})

test('needed per month without a schedule', () => {
  expect(status({ targetDate: '2027-01-15', cadence: MONTH })).toMatchObject({
    neededCents: 33_334,
    neededPer: 'month',
  })
})

test('on track vs behind', () => {
  expect(status({ targetDate: '2026-12-31', recentRateCents: 25_000 })).toMatchObject({
    status: 'on-track',
    behindCents: null,
  })
  expect(status({ targetDate: '2026-12-31', recentRateCents: 20_000 })).toMatchObject({
    status: 'behind',
    behindCents: 5_000,
  })
})

test('date passed', () => {
  expect(status({ targetDate: '2026-10-29', recentRateCents: 50_000 })).toMatchObject({
    status: 'date-passed',
  })
})

test('projected and not growing', () => {
  // 30,000 left at 10,000 a pay: the third payday from now.
  expect(status({ balanceCents: 70_000, recentRateCents: 10_000 })).toMatchObject({
    status: 'projected',
    projectedDate: '2026-12-04',
  })
  expect(status({ balanceCents: 70_000, recentRateCents: 10_000, cadence: MONTH })).toMatchObject({
    projectedDate: '2027-01-30',
  })
  expect(status({ balanceCents: 70_000, recentRateCents: 0 })).toMatchObject({ status: 'not-growing' })
  expect(status({ balanceCents: 70_000, recentRateCents: -500 })).toMatchObject({ status: 'not-growing' })
})

test('a trickle that would take over 100 years is not growing', () => {
  // 1 cent a pay towards $1,000 is ~3,800 years away: no "At this rate: Mar 29026".
  expect(status({ recentRateCents: 1 })).toMatchObject({ status: 'not-growing', projectedDate: null })
  expect(status({ recentRateCents: 1, cadence: MONTH })).toMatchObject({ status: 'not-growing', projectedDate: null })
  // Just under 100 years still projects.
  expect(status({ recentRateCents: 84, cadence: MONTH })).toMatchObject({ status: 'projected' })
})

test('a $0 target is reached', () => {
  expect(status({ targetCents: 0, balanceCents: 0 })).toMatchObject({ status: 'reached', progress: 1 })
})
test('buffer', () => {
  expect(bufferStatus(36_000, 40_000)).toEqual({ progress: 0.9, status: 'below', belowCents: 4_000 })
  expect(bufferStatus(40_000, 40_000)).toEqual({ progress: 1, status: 'topped-up', belowCents: null })
})
test('expected progress', () => {
  const e = (over = {}) => expectedProgress({ startCents: 0, startTargetCents: 100_000, startDate: '2026-10-01', targetDate: '2026-12-10', today: '2026-10-30', ...over })
  expect(e()).toBeCloseTo(29 / 70)
  expect(e({ startCents: 50_000 })).toBeCloseTo(0.5 + 0.5 * (29 / 70))
  expect(e({ today: '2026-09-01' })).toBe(0)
  expect(e({ today: '2027-01-01' })).toBe(1)
  expect(e({ startCents: 150_000 })).toBe(1)
  expect(e({ targetDate: '2026-10-01' })).toBe(1)
})

const outcome = (over = {}) =>
  planOutcome({ balanceCents: 0, targetCents: 100_000, targetDate: '2026-12-31', today: TODAY, amountCents: 0, otherRateCents: 0, cadence: PAY, ...over })

test('plan outcome with a date', () => {
  // Four paydays left, so 25_000 is needed.
  expect(outcome({ amountCents: 20_000 })).toEqual({ kind: 'short', shortCents: 5_000 })
  expect(outcome({ amountCents: 25_000 })).toEqual({ kind: 'enough', date: '2026-12-31' })
  expect(outcome({ amountCents: 15_000, otherRateCents: 10_000 })).toEqual({ kind: 'enough', date: '2026-12-31' })
  expect(outcome({ amountCents: 25_000, otherRateCents: -5_000 })).toEqual({ kind: 'short', shortCents: 5_000 })
})
test('plan outcome without a date', () => {
  expect(outcome({ targetDate: null, amountCents: 25_000 })).toEqual({ kind: 'reach', date: '2026-12-18' })
  expect(outcome({ targetDate: null, amountCents: 0 })).toEqual({ kind: 'none' })
})
test('plan outcome has nothing to say once reached or past the date', () => {
  expect(outcome({ balanceCents: 100_000, amountCents: 1 })).toEqual({ kind: 'none' })
  expect(outcome({ targetDate: '2026-10-01', amountCents: 1 })).toEqual({ kind: 'none' })
})
