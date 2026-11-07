import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canTryAmount,
  otherRate,
  planComparison,
  planLine,
  sliderRange,
  tryResult,
} from '../../src/web/components/goals/plan'
import { goal } from './goal-fixtures'

const pay = { kind: 'pay', frequencyDays: 14, lastPayDate: '2026-10-23' } as const
const plan = (over: Partial<NonNullable<ReturnType<typeof goal>['plan']>> = {}) => ({
  amountCents: 20_000,
  mineCents: 20_000,
  partnerCents: null,
  partnerName: null,
  partial: false,
  ...over,
})
const base = (over: Parameters<typeof goal>[0] = {}) =>
  goal({
    balanceCents: 0,
    goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: '2026-12-31' },
    neededCents: 25_000,
    cadence: pay,
    plan: plan(),
    ...over,
  })
const debt = (over: Parameters<typeof goal>[0] = {}) =>
  base({ goal: { kind: 'debt', name: 'Tax', targetCents: 100_000, targetDate: '2026-12-31' }, ...over })
const undated = (kind: 'save' | 'debt', over: Parameters<typeof goal>[0] = {}) =>
  base({ goal: { kind, name: 'G', targetCents: 100_000, targetDate: null }, neededCents: null, ...over })

afterEach(() => vi.useRealTimers())

describe('otherRate', () => {
  it('is the debt fall less the Saver outflow, and 0 on save goals', () => {
    expect(otherRate(debt({ debtFallCents: 30_000, saverOutCents: 10_000 }))).toBe(20_000)
    expect(otherRate(debt({ debtFallCents: null, saverOutCents: null }))).toBe(0)
    expect(otherRate(base({ debtFallCents: 30_000 }))).toBe(0)
  })
})

describe('planLine', () => {
  it('describes your plan, both plans and their plan', () => {
    expect(planLine(base())).toBe('Your plan puts in $200.00 a pay')
    expect(
      planLine(base({ plan: plan({ amountCents: 26_000, mineCents: 16_000, partnerCents: 10_000, partnerName: 'Sam' }) })),
    ).toBe('Plans put in $260.00 a pay: $160.00 from you, $100.00 from Sam')
    expect(
      planLine(base({ plan: plan({ amountCents: 10_000, mineCents: 0, partnerCents: 10_000, partnerName: 'Sam' }) })),
    ).toBe("Sam's plan puts in $100.00 a pay")
  })
  it('says a month on a monthly cadence, and is null without a plan', () => {
    expect(planLine(base({ cadence: { kind: 'month' } }))).toBe('Your plan puts in $200.00 a month')
    expect(planLine(base({ plan: null }))).toBeNull()
  })
})

describe('planComparison', () => {
  it('compares a dated plan with what is needed', () => {
    expect(planComparison(base())).toEqual({ text: 'short by $50.00 a pay', warning: true })
    expect(planComparison(base({ plan: plan({ amountCents: 25_000 }) }))).toEqual({
      text: 'enough to reach it by 31 Dec',
      warning: false,
    })
    expect(planComparison(debt({ plan: plan({ amountCents: 25_000 }) }))?.text).toBe('enough to cover it by 31 Dec')
  })
  it('projects undated goals', () => {
    expect(planComparison(undated('save', { plan: plan({ amountCents: 25_000 }) }))).toEqual({
      text: 'At your planned rate, about Dec 2026',
      warning: false,
    })
    expect(planComparison(undated('debt', { plan: plan({ amountCents: 25_000 }) }))?.text).toBe(
      'At your planned rate, enough to pay it off by Dec 2026',
    )
  })
  it('says a month on a monthly cadence', () => {
    const m = base({ cadence: { kind: 'month' }, plan: plan({ amountCents: 20_000 }) })
    expect(planComparison(m)).toEqual({ text: 'short by $300.00 a month', warning: true })
  })
  it('agrees with tryResult at a plan that is not a multiple of $10', () => {
    const g = base({
      goal: { kind: 'save', name: 'Holiday', targetCents: 99_200, targetDate: '2026-12-31' },
      neededCents: 24_800,
      plan: plan({ amountCents: 24_500 }),
    })
    expect(planComparison(g)?.text).toBe('short by $3.00 a pay')
    expect(tryResult(g, sliderRange(g).startCents)).toBe('Short by $3.00 a pay')
  })
  it("says so when an undated plan doesn't grow the goal", () => {
    const g = undated('debt', { plan: plan({ amountCents: 10_000 }), debtFallCents: 0, saverOutCents: 30_000 })
    expect(planComparison(g)).toEqual({ text: 'not growing at your planned rate', warning: true })
    const theirs = { ...g, plan: plan({ amountCents: 10_000, mineCents: 0, partnerCents: 10_000, partnerName: 'Sam' }) }
    expect(planComparison(theirs)).toEqual({ text: 'not growing at the planned rate', warning: true })
    expect(planComparison({ ...g, status: 'reached' })).toBeNull()
    expect(planComparison({ ...g, status: 'date-passed' })).toBeNull()
  })
  it("doesn't call it your rate when only the partner has a plan", () => {
    const theirs = plan({ amountCents: 25_000, mineCents: 0, partnerCents: 25_000, partnerName: 'Sam' })
    expect(planComparison(undated('save', { plan: theirs }))?.text).toBe('At the planned rate, about Dec 2026')
    expect(planComparison(undated('debt', { plan: theirs }))?.text).toBe(
      'At the planned rate, enough to pay it off by Dec 2026',
    )
  })
  it('is null for buffers, reached, date-passed, and no plan or cadence', () => {
    const buffer = { kind: 'buffer', name: 'B', targetCents: 100_000, targetDate: null } as const
    expect(planComparison(base({ goal: buffer }))).toBeNull()
    expect(planComparison(base({ status: 'reached' }))).toBeNull()
    expect(planComparison(base({ status: 'date-passed' }))).toBeNull()
    expect(planComparison(base({ plan: null }))).toBeNull()
    expect(planComparison(base({ cadence: null }))).toBeNull()
  })
  it("repayments from the Saver don't count twice", () => {
    const g = debt({ plan: plan({ amountCents: 20_000 }), debtFallCents: 30_000, saverOutCents: 30_000 })
    expect(planComparison(g)?.text).toBe('short by $50.00 a pay')
    expect(planComparison({ ...g, saverOutCents: 0 })?.text).toBe('enough to cover it by 31 Dec')
  })
})

describe('tryResult', () => {
  it('reads the slider outcome', () => {
    expect(tryResult(base(), 20_000)).toBe('Short by $50.00 a pay')
    expect(tryResult(base(), 25_000)).toBe('Enough to reach it by 31 Dec')
    expect(tryResult(debt(), 25_000)).toBe('Enough to cover it by 31 Dec')
    expect(tryResult(undated('save'), 25_000)).toBe('Reach it about Dec 2026')
    expect(tryResult(undated('debt'), 25_000)).toBe('Enough to pay it off by Dec 2026')
    expect(tryResult(undated('save'), 0)).toBe('Not growing at this amount')
  })
  it('reads a monthly cadence', () => {
    const m = base({ cadence: { kind: 'month' } })
    expect(tryResult(m, 20_000)).toBe('Short by $300.00 a month')
  })
  it('today comes from the goal', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-10-30T00:00:00Z'))
    expect(tryResult(base(), 25_000)).toBe('Enough to reach it by 31 Dec')
  })
})

describe('sliderRange', () => {
  it('starts at the plan and reaches twice what is needed', () => {
    expect(sliderRange(base({ neededCents: 24_700 }))).toEqual({ maxCents: 50_000, startCents: 20_000 })
    expect(sliderRange(base({ neededCents: 24_700, plan: plan({ amountCents: 24_700 }) })).startCents).toBe(24_700)
  })
  it('falls back to the recent rate, then 0', () => {
    expect(sliderRange(undated('save', { plan: null, recentRateCents: 73_000 }))).toEqual({
      maxCents: 75_000,
      startCents: 73_000,
    })
    expect(sliderRange(undated('save', { plan: null, recentRateCents: 0 }))).toEqual({ maxCents: 10_000, startCents: 0 })
  })
  it('rounds the recent-rate start to the nearest $10', () => {
    expect(sliderRange(undated('save', { plan: null, recentRateCents: 24_400 })).startCents).toBe(24_000)
  })
  it('reaches enough even when money out of the Saver exceeds the fall', () => {
    const g = debt({ neededCents: 25_000, plan: plan({ amountCents: 10_000 }), debtFallCents: 0, saverOutCents: 60_000 })
    expect(sliderRange(g).maxCents).toBeGreaterThanOrEqual(85_000)
    expect(tryResult(g, 85_000)).toMatch(/^Enough/)
  })
  it('takes other repayments off the recent rate on debt goals', () => {
    const g = debt({ plan: null, recentRateCents: 40_000, debtFallCents: 30_000, saverOutCents: 0 })
    expect(sliderRange(g).startCents).toBe(10_000)
  })
})

describe('canTryAmount', () => {
  it('is true for save and debt goals with a cadence', () => {
    expect(canTryAmount(base())).toBe(true)
    expect(canTryAmount(debt())).toBe(true)
  })
  it('is false otherwise', () => {
    const buffer = { kind: 'buffer', name: 'B', targetCents: 100_000, targetDate: null } as const
    expect(canTryAmount(base({ goal: buffer }))).toBe(false)
    expect(canTryAmount(base({ status: 'reached' }))).toBe(false)
    expect(canTryAmount(base({ status: 'date-passed' }))).toBe(false)
    expect(canTryAmount(base({ canEdit: false }))).toBe(false)
    expect(canTryAmount(base({ cadence: null }))).toBe(false)
    expect(canTryAmount(base({ accountMissing: true }))).toBe(false)
  })
})
