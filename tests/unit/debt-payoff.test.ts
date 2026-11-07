import { expect, test } from 'vitest'
import type { InterestSettingsDto } from '../../src/shared/types'
import {
  payoffDifferences,
  simulateBalances,
  simulatePayoff,
  type PayoffDebt,
} from '../../src/server/debts/payoff'

const monthly: InterestSettingsDto = { calc: 'on_charge', charge: 'monthly', chargeDay: 1, chargeDate: null }
const daily: InterestSettingsDto = { calc: 'daily', charge: 'monthly', chargeDay: 1, chargeDate: null }
const dailyCharge: InterestSettingsDto = { calc: 'on_charge', charge: 'daily', chargeDay: null, chargeDate: null }
const yearly = (chargeDate: string): InterestSettingsDto => ({
  calc: 'on_charge',
  charge: 'yearly',
  chargeDay: null,
  chargeDate,
})

const A: PayoffDebt = {
  id: 'a',
  name: 'A',
  interest: monthly,
  rateBp: 2000,
  balanceCents: 300_000,
  monthlyCents: 10_000,
}
const B: PayoffDebt = {
  id: 'b',
  name: 'B',
  interest: monthly,
  rateBp: 1000,
  balanceCents: 100_000,
  monthlyCents: 5_000,
}
const C: PayoffDebt = {
  id: 'c',
  name: 'C',
  interest: monthly,
  rateBp: 0,
  balanceCents: 50_000,
  monthlyCents: 5_000,
}
const ALL = [A, B, C]
const START = '2027-01'

const payoffOf = (s: ReturnType<typeof simulatePayoff>, id: string) =>
  s.debts.find((d) => d.id === id)?.payoffMonth

test('as is pays each debt alone', () => {
  const asIs = simulatePayoff(ALL, 10_000, 'as-is', START)
  for (const d of ALL) {
    expect(payoffOf(asIs, d.id)).toBe(simulatePayoff([d], 0, 'as-is', START).debts[0]?.payoffMonth)
  }
})

test('avalanche targets the highest rate', () => {
  const [m1] = simulateBalances(ALL, 10_000, 'avalanche', START)
  expect(m1?.balances.a).toBeCloseTo(285_000, 6)
  expect(m1?.balances.c).toBeCloseTo(45_000, 6)
})

test('snowball targets the smallest balance', () => {
  const [m1] = simulateBalances(ALL, 10_000, 'snowball', START)
  expect(m1?.balances.c).toBeCloseTo(35_000, 6)
  expect(m1?.balances.a).toBeCloseTo(295_000, 6)
  expect(payoffOf(simulatePayoff(ALL, 10_000, 'snowball', START), 'c')).toBe('2027-04')
  expect(payoffOf(simulatePayoff(ALL, 10_000, 'avalanche', START), 'c')).toBe('2027-10')
})

test('freed repayments roll on', () => {
  const months = simulateBalances(ALL, 10_000, 'snowball', START)
  const b4 = months[3]!.balances.b!
  const b5 = months[4]!.balances.b!
  expect(months[3]!.balances.c).toBe(0)
  // B's own 5,000 + extra 10,000 + C's freed 5,000.
  expect(b5).toBeCloseTo(b4 * (1 + 0.1 / 12) - 20_000, 6)
})

test('leftover flows to the next target in the same month', () => {
  const small: PayoffDebt = { ...C, balanceCents: 2_000 }
  const [m1] = simulateBalances([B, small], 10_000, 'snowball', START)
  expect(m1?.balances.c).toBe(0)
  expect(m1?.balances.b).toBeCloseTo(100_000 * (1 + 0.1 / 12) - 5_000 - 13_000, 6)
})

test('avalanche beats as is', () => {
  const asIs = simulatePayoff(ALL, 10_000, 'as-is', START)
  const avalanche = simulatePayoff(ALL, 10_000, 'avalanche', START)
  expect(avalanche.totalInterestCents).toBeLessThan(asIs.totalInterestCents)
  expect(avalanche.debtFreeMonth! < asIs.debtFreeMonth!).toBe(true)
})

test('daily charging uses the monthly equivalent rate', () => {
  const ato: PayoffDebt = {
    id: 't',
    name: 'Tax',
    interest: dailyCharge,
    rateBp: 1100,
    balanceCents: 1_000_000,
    monthlyCents: 0,
  }
  const [m1] = simulateBalances([ato], 0, 'as-is', START)
  expect(m1?.balances.t).toBeCloseTo(1_000_000 * (1 + 0.11 / 365) ** (365 / 12), 4)
})

test('hecs indexes in June only', () => {
  const hecs: PayoffDebt = {
    id: 'h',
    name: 'HECS',
    interest: yearly('06-01'),
    rateBp: 320,
    balanceCents: 1_000_000,
    monthlyCents: 0,
  }
  const months = simulateBalances([hecs], 0, 'as-is', START)
  expect(months[4]).toMatchObject({ month: '2027-05', balances: { h: 1_000_000 } })
  expect(months[5]?.month).toBe('2027-06')
  expect(months[5]?.balances.h).toBeCloseTo(1_032_000, 6)
  expect(months[6]?.balances.h).toBeCloseTo(1_032_000, 6)
})

test('daily calculation with monthly charging is balance x rate / 12', () => {
  const tax: PayoffDebt = {
    id: 't',
    name: 'Tax',
    interest: daily,
    rateBp: 1200,
    balanceCents: 1_000_000,
    monthlyCents: 0,
  }
  const [m1] = simulateBalances([tax], 0, 'as-is', START)
  expect(m1?.balances.t).toBeCloseTo(1_010_000, 6)
})

test('yearly interest only in its month', () => {
  const loan: PayoffDebt = {
    id: 'y',
    name: 'Yearly',
    interest: yearly('06-01'),
    rateBp: 380,
    balanceCents: 1_000_000,
    monthlyCents: 0,
  }
  const months = simulateBalances([loan], 0, 'as-is', START)
  expect(months[3]).toMatchObject({ month: '2027-04', balances: { y: 1_000_000 } })
  expect(months[4]).toMatchObject({ month: '2027-05', interest: 0, balances: { y: 1_000_000 } })
  expect(months[5]?.month).toBe('2027-06')
  expect(months[5]?.interest).toBeCloseTo(38_000, 6)
  expect(months[5]?.balances.y).toBeCloseTo(1_038_000, 6)
})

test('600-month cap gives never', () => {
  const ato: PayoffDebt = {
    id: 't',
    name: 'Tax',
    interest: dailyCharge,
    rateBp: 1100,
    balanceCents: 1_000_000,
    monthlyCents: 0,
  }
  const s = simulatePayoff([ato], 0, 'as-is', START)
  expect(s.debtFreeMonth).toBeNull()
  expect(s.debts[0]?.payoffMonth).toBeNull()
  expect(s.series).toHaveLength(600)
})

test('differences text', () => {
  const scenarios = (['as-is', 'avalanche', 'snowball'] as const).map((st) =>
    simulatePayoff(ALL, 10_000, st, START),
  )
  const lines = payoffDifferences(scenarios, ALL)
  expect(lines[0]).toMatch(
    /^Avalanche: debt-free \d+ months? sooner and \$[\d,]+\.\d\d less interest than As is\.$/,
  )

  const twin: PayoffDebt = { ...C, id: 'c2', name: 'C2' }
  const tie = (['as-is', 'avalanche', 'snowball'] as const).map((st) =>
    simulatePayoff([C, twin], 10_000, st, START),
  )
  expect(payoffDifferences(tie, [C, twin])).toContain(
    'Avalanche and Snowball finish together: your highest-rate debts are also your smallest, so both pay them off in the same order.',
  )
})

test('a tie with different orders gives no reason', () => {
  // A has the higher rate, B the smaller balance; with no extra, the pools only meet the last debt.
  const tie = (['as-is', 'avalanche', 'snowball'] as const).map((st) => simulatePayoff([A, B], 0, st, START))
  expect(payoffDifferences(tie, [A, B])).toContain('Avalanche and Snowball finish together.')
})

test('never as is reads "instead of never"', () => {
  const stuck: PayoffDebt = {
    id: 's',
    name: 'S',
    interest: monthly,
    rateBp: 2400,
    balanceCents: 100_000,
    monthlyCents: 1_000,
  }
  const scenarios = (['as-is', 'avalanche', 'snowball'] as const).map((st) =>
    simulatePayoff([stuck], 10_000, st, START),
  )
  expect(payoffDifferences(scenarios, [stuck])[0]).toMatch(
    /^Avalanche: debt-free by [A-Z][a-z]{2} \d{4} instead of never\.$/,
  )
})

test('an account fee is added each month but not counted as interest', () => {
  const s = simulatePayoff([{ ...C, feeMonthlyCents: 1_000 }], 0, 'as-is', START)
  expect(payoffOf(s, 'c')).toBe('2028-01')
  expect(s.totalInterestCents).toBe(0)
})
