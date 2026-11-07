import { expect, test } from 'vitest'
import type { InterestSettingsDto } from '../../src/shared/types'
import { monthlyInterest, projectDebt, type ProjectionInput } from '../../src/server/debts/projection'

const monthly = (chargeDay: number): InterestSettingsDto => ({
  calc: 'on_charge',
  charge: 'monthly',
  chargeDay,
  chargeDate: null,
})

const input = (over: Partial<ProjectionInput> & { rateBp?: number } = {}): ProjectionInput => ({
  settings: monthly(1),
  rates: [{ id: 'r', fromDate: '2026-01-01', rateBp: over.rateBp ?? 0 }],
  usual: { repaymentCents: 0, repaymentFrequency: 'monthly' },
  ...over,
})

test('pays off a zero-rate loan on the last due date', () => {
  const p = projectDebt(input({ usual: { repaymentCents: 10_000, repaymentFrequency: 'monthly' } }), {
    balance: 40_000,
    accruing: 0,
    today: '2026-01-10',
    nextDue: '2026-01-15',
    dueDay: 15,
  })
  expect(p).toEqual({ payoffDate: '2026-04-15', totalInterestCents: 0, shortfallCents: null })
})

test('interest-bearing loan', () => {
  const p = projectDebt(
    input({ rateBp: 1200, usual: { repaymentCents: 50_000, repaymentFrequency: 'monthly' } }),
    { balance: 100_000, accruing: 0, today: '2026-01-01', nextDue: '2026-01-02', dueDay: 2 },
  )
  expect(p?.payoffDate).toBe('2026-03-02')
  expect(p?.totalInterestCents).toBe(505)
})

test("never when the repayment doesn't cover the interest", () => {
  const p = projectDebt(
    input({ rateBp: 2400, usual: { repaymentCents: 10_000, repaymentFrequency: 'monthly' } }),
    { balance: 1_000_000, accruing: 0, today: '2026-01-01', nextDue: '2026-01-15', dueDay: 15 },
  )
  expect(p?.payoffDate).toBeNull()
  expect(p?.shortfallCents).toBe(10_000)
})

test('stops at 50 years', () => {
  // Interest and repayment both on the 1st: the surplus starts at 1c a month, so payoff takes ~77 years.
  const p = projectDebt(
    input({ rateBp: 1200, usual: { repaymentCents: 10_001, repaymentFrequency: 'monthly' } }),
    { balance: 1_000_000, accruing: 0, today: '2026-01-01', nextDue: '2026-02-01', dueDay: 1 },
  )
  expect(p?.payoffDate).toBeNull()
  expect(p?.shortfallCents).toBeNull()
})

test('paid-off debt has no projection', () => {
  expect(
    projectDebt(input(), { balance: 0, accruing: 0, today: '2026-01-01', nextDue: '2026-01-02', dueDay: 2 }),
  ).toBeNull()
})

test('built-up interest is charged before payoff', () => {
  const p = projectDebt(
    input({
      settings: { calc: 'daily', charge: 'monthly', chargeDay: 1, chargeDate: null },
      usual: { repaymentCents: 1_000_000, repaymentFrequency: 'monthly' },
    }),
    { balance: 1_000_000, accruing: 9000, today: '2026-01-31', nextDue: '2026-02-15', dueDay: 15 },
  )
  expect(p).toEqual({ payoffDate: '2026-03-15', totalInterestCents: 9000, shortfallCents: null })
})

test('a future rate takes effect', () => {
  const p = projectDebt(
    input({
      rates: [
        { id: 'a', fromDate: '2026-01-01', rateBp: 0 },
        { id: 'b', fromDate: '2026-03-01', rateBp: 1200 },
      ],
      usual: { repaymentCents: 600_000, repaymentFrequency: 'monthly' },
    }),
    { balance: 1_000_000, accruing: 0, today: '2026-01-31', nextDue: '2026-02-15', dueDay: 15 },
  )
  expect(p).toEqual({ payoffDate: '2026-03-15', totalInterestCents: 4000, shortfallCents: null })
})

test('monthly interest follows the settings', () => {
  expect(monthlyInterest(monthly(1), 1200, 100_000)).toBeCloseTo(1000, 6)
  expect(
    monthlyInterest({ calc: 'daily', charge: 'monthly', chargeDay: 1, chargeDate: null }, 1200, 100_000),
  ).toBeCloseTo(1000, 6)
  expect(
    monthlyInterest({ calc: 'on_charge', charge: 'daily', chargeDay: null, chargeDate: null }, 1100, 1_000_000),
  ).toBeCloseTo(1_000_000 * ((1 + 0.11 / 365) ** (365 / 12) - 1), 6)
})

test('an account fee pushes payoff out and counts toward the shortfall', () => {
  const from = { balance: 40_000, accruing: 0, today: '2026-01-10', nextDue: '2026-01-15', dueDay: 15 }
  const usual = { repaymentCents: 10_000, repaymentFrequency: 'monthly' as const }
  const withFee = projectDebt(input({ usual, fee: { amountCents: 2_000, frequency: 'monthly', from: '2026-01-01' } }), from)
  // 40,000 + 2,000 a month from 1 Feb, paid 10,000 on each 15th: 8,000 net a month after the first.
  expect(withFee).toEqual({ payoffDate: '2026-05-15', totalInterestCents: 0, shortfallCents: null })
  const tooSmall = projectDebt(
    input({ usual, fee: { amountCents: 12_000, frequency: 'monthly', from: '2026-01-01' } }),
    from,
  )
  expect(tooSmall?.shortfallCents).toBe(2_000)
})
