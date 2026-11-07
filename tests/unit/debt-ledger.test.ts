import { expect, test } from 'vitest'
import { editKey, interestDefaults, isChargeDay } from '../../src/shared/debt-interest'
import type { DebtActivityDto, InterestSettingsDto } from '../../src/shared/types'
import { debtLedger, rateOn, type Ledger, type LedgerInput } from '../../src/server/debts/ledger'

const monthly1: InterestSettingsDto = { calc: 'daily', charge: 'monthly', chargeDay: 1, chargeDate: null }
const onCharge = (over: Partial<InterestSettingsDto>): InterestSettingsDto => ({
  calc: 'on_charge',
  charge: 'monthly',
  chargeDay: 1,
  chargeDate: null,
  ...over,
})

// 1095 bp on $10,000 is 300 cents a day.
const ledger = (over: Partial<LedgerInput>, to: string): Ledger =>
  debtLedger(
    {
      settings: monthly1,
      rates: [{ id: 'r1', fromDate: '2026-01-01', rateBp: 1095 }],
      points: [{ id: 'p1', asOf: '2026-01-01', balanceCents: 1_000_000 }],
      repayments: [],
      entries: [],
      edits: {},
      usual: { repaymentCents: 0, repaymentFrequency: 'monthly' },
      ...over,
    },
    to,
  )
const bal = (l: Ledger, date: string) => {
  const day = l.days.find((d) => d.date === date)
  if (!day) throw new Error(`no day ${date}`)
  return day.balance
}
const interestRows = (l: Ledger) => l.activity.filter((a) => a.kind === 'interest')
const kindsOn = (l: Ledger, date: string) => l.activity.filter((a) => a.date === date).map((a) => a.kind)
const rate = (rateBp: number, fromDate = '2026-01-01') => [{ id: 'r1', fromDate, rateBp }]
const repayment = (date: string, amountCents: number, transactionId = `t-${date}`) => ({
  transactionId,
  date,
  amountCents,
  description: 'Repayment',
  oneOff: false,
})

test('daily calculation charged monthly', () => {
  const l = ledger({}, '2026-01-31')
  expect(bal(l, '2026-01-31')).toBe(1_000_000)
  expect(l.accruing).toBe(9000)
  expect(l.nextChargeOn).toBe('2026-02-01')

  const feb = ledger({}, '2026-02-01')
  expect(bal(feb, '2026-02-01')).toBeCloseTo(1_009_000, 6)
  expect(interestRows(feb)).toMatchObject([
    {
      key: 'interest:2026-02-01',
      date: '2026-02-01',
      chargeDate: '2026-02-01',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      amountCents: 9000,
      calculatedCents: 9000,
      edited: false,
      balanceAfterCents: 1_009_000,
    },
  ])
  // The charge day's own build-up starts the next period.
  expect(feb.accruing).toBeCloseTo((1_009_000 * 0.1095) / 365, 6)
})

test('the next period starts at the previous charge day', () => {
  const l = ledger({}, '2026-03-01')
  expect(interestRows(l)).toMatchObject([
    { chargeDate: '2026-02-01', periodStart: '2026-01-01', periodEnd: '2026-01-31' },
    { chargeDate: '2026-03-01', periodStart: '2026-02-01', periodEnd: '2026-02-28' },
  ])
})

test('a mid-period payment lowers the next charge', () => {
  const l = ledger({ repayments: [repayment('2026-01-16', 100_000)] }, '2026-02-01')
  expect(interestRows(l)).toMatchObject([{ amountCents: 8550 }])
  expect(bal(l, '2026-02-01')).toBeCloseTo(908_550, 6)
})

test('on_charge monthly clamps day 31', () => {
  const l = ledger(
    {
      settings: onCharge({ chargeDay: 31 }),
      rates: rate(1200),
      points: [{ id: 'p1', asOf: '2026-01-31', balanceCents: 1_000_000 }],
    },
    '2026-03-31',
  )
  expect(bal(l, '2026-02-27')).toBe(1_000_000)
  expect(bal(l, '2026-02-28')).toBeCloseTo(1_010_000, 6)
  expect(bal(l, '2026-03-31')).toBeCloseTo(1_020_100, 6)
  expect(interestRows(l)[0]).toMatchObject({ periodStart: '2026-01-31', periodEnd: '2026-02-27' })
})

test('yearly on 06-01', () => {
  const l = ledger(
    { settings: onCharge({ charge: 'yearly', chargeDay: null, chargeDate: '06-01' }), rates: rate(380) },
    '2027-06-01',
  )
  expect(bal(l, '2026-05-31')).toBe(1_000_000)
  expect(bal(l, '2026-06-01')).toBeCloseTo(1_038_000, 6)
  expect(bal(l, '2027-06-01')).toBeCloseTo(1_077_444, 6)
})

test('yearly on 02-29 clamps to 28 Feb in other years', () => {
  const l = ledger(
    { settings: onCharge({ charge: 'yearly', chargeDay: null, chargeDate: '02-29' }), rates: rate(1000) },
    '2028-03-01',
  )
  expect(bal(l, '2026-02-28')).toBeCloseTo(1_100_000, 6)
  expect(bal(l, '2028-02-28')).toBe(bal(l, '2027-02-28'))
  expect(bal(l, '2028-02-29')).toBeGreaterThan(bal(l, '2028-02-28'))
})

test('daily charging groups by month and edits the month', () => {
  const settings = onCharge({ charge: 'daily', chargeDay: null })
  const l = ledger({ settings }, '2026-02-02')
  const rows = interestRows(l)
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({
    date: '2026-01-31',
    chargeDate: '2026-01-31',
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    edited: false,
  })
  // February is cut off where the walk ends.
  expect(rows[1]).toMatchObject({
    date: '2026-02-02',
    chargeDate: '2026-02-28',
    periodStart: '2026-02-01',
    periodEnd: '2026-02-02',
  })
  expect(bal(l, '2026-01-31')).toBeGreaterThan(1_009_000)

  const edited = ledger({ settings, edits: { '2026-01-31': 5000 } }, '2026-02-02')
  expect(bal(edited, '2026-01-31')).toBe(1_005_000)
  expect(interestRows(edited)[0]).toMatchObject({ amountCents: 5000, edited: true })
  expect(interestRows(edited)[0]?.kind === 'interest' && interestRows(edited)[0]).toMatchObject({
    calculatedCents: Math.round(bal(l, '2026-01-31') - 1_000_000),
  })
  // Only the month's last day is an edit key.
  const stray = ledger({ settings, edits: { '2026-01-15': 5000 } }, '2026-02-02')
  expect(bal(stray, '2026-01-31')).toBe(bal(l, '2026-01-31'))
})

test('an edit replaces the charge', () => {
  const l = ledger({ edits: { '2026-02-01': 0 } }, '2026-02-01')
  expect(bal(l, '2026-02-01')).toBe(1_000_000)
  expect(interestRows(l)).toMatchObject([{ amountCents: 0, calculatedCents: 9000, edited: true }])

  const stray = ledger({ edits: { '2026-02-15': 123 } }, '2026-02-20')
  expect(stray.days).toEqual(ledger({}, '2026-02-20').days)
  expect(interestRows(stray)).toHaveLength(1)
})

test('a rate change mid-period', () => {
  const rates = [
    { id: 'r1', fromDate: '2026-01-01', rateBp: 1095 },
    { id: 'r2', fromDate: '2026-01-17', rateBp: 2190 },
  ]
  expect(interestRows(ledger({ rates }, '2026-02-01'))).toMatchObject([{ amountCents: 13_500 }])
  expect(interestRows(ledger({ rates, settings: onCharge({}) }, '2026-02-01'))).toMatchObject([
    { amountCents: 18_250 },
  ])
})

test('a balance check carries the built-up interest', () => {
  const l = ledger(
    {
      points: [
        { id: 'p1', asOf: '2026-01-01', balanceCents: 1_000_000 },
        { id: 'p2', asOf: '2026-01-20', balanceCents: 500_000 },
      ],
    },
    '2026-02-01',
  )
  expect(bal(l, '2026-01-20')).toBe(500_000)
  expect(l.corrections).toEqual({ p2: -500_000 })
  expect(interestRows(l)).toMatchObject([{ amountCents: 7350 }])
  expect(l.activity.find((a) => a.key === 'check:p2')).toMatchObject({
    kind: 'check',
    correctionCents: -500_000,
    amountCents: -500_000,
    balanceAfterCents: 500_000,
  })
})

test('the first balance is a check row without a correction', () => {
  const l = ledger({}, '2026-01-05')
  expect(l.activity).toMatchObject([
    { kind: 'rate', date: '2026-01-01' },
    { kind: 'check', key: 'check:p1', correctionCents: null, amountCents: 0, balanceAfterCents: 1_000_000 },
  ])
})

test('same-day order: charge, added, payments, repayments, check', () => {
  const date = '2026-02-01'
  const l = ledger(
    {
      entries: [
        { id: 'e2', kind: 'payment', date, amountCents: 20_000, note: null },
        { id: 'e1', kind: 'added', date, amountCents: 50_000, note: 'Fee' },
      ],
      repayments: [repayment(date, 10_000)],
      points: [
        { id: 'p1', asOf: '2026-01-01', balanceCents: 1_000_000 },
        { id: 'p2', asOf: date, balanceCents: 900_000 },
      ],
    },
    date,
  )
  expect(kindsOn(l, date)).toEqual(['interest', 'added', 'payment', 'repayment', 'check'])
  expect(l.corrections.p2).toBeCloseTo(900_000 - 1_029_000, 6)
  expect(bal(l, date)).toBe(900_000)
  expect(l.activity.filter((a) => a.date === date)).toMatchObject([
    { amountCents: 9000, balanceAfterCents: 1_009_000 },
    { key: 'entry:e1', amountCents: 50_000, note: 'Fee', balanceAfterCents: 1_059_000 },
    { key: 'entry:e2', amountCents: -20_000, balanceAfterCents: 1_039_000 },
    {
      key: 'repayment:t-2026-02-01',
      amountCents: -10_000,
      description: 'Repayment',
      oneOff: false,
      balanceAfterCents: 1_029_000,
    },
    { amountCents: -129_000, correctionCents: -129_000, balanceAfterCents: 900_000 },
  ])
})

test('a rate row comes before the other rows of its day', () => {
  const rates = [...rate(1095), { id: 'r2', fromDate: '2026-02-01', rateBp: 500 }]
  const l = ledger({ rates }, '2026-02-01')
  expect(kindsOn(l, '2026-02-01')).toEqual(['rate', 'interest'])
})

test('paid off drops built-up interest, and an addition raises it again', () => {
  const points = [{ id: 'p1', asOf: '2026-01-01', balanceCents: 100_000 }]
  const l = ledger({ points, repayments: [repayment('2026-01-11', 200_000)] }, '2026-02-01')
  expect(l.paidOffOn).toBe('2026-01-11')
  expect(interestRows(l)).toHaveLength(0)
  expect(bal(l, '2026-02-01')).toBe(0)

  const raised = ledger(
    {
      points,
      repayments: [repayment('2026-01-11', 200_000)],
      entries: [{ id: 'e1', kind: 'added', date: '2026-02-10', amountCents: 50_000, note: null }],
    },
    '2026-02-10',
  )
  expect(bal(raised, '2026-02-10')).toBe(50_000)
  expect(raised.paidOffOn).toBeNull()
})

test('nothing builds up at $0 and later payments are ignored', () => {
  const points = [{ id: 'p1', asOf: '2026-01-01', balanceCents: 100_000 }]
  const l = ledger(
    { points, repayments: [repayment('2026-01-11', 100_000), repayment('2026-01-20', 5000)] },
    '2026-01-25',
  )
  expect(bal(l, '2026-01-20')).toBe(0)
  expect(l.accruing).toBe(0)
  expect(l.paidOffOn).toBe('2026-01-11')
})

test('assumed repayments when estimated', () => {
  const l = ledger(
    {
      rates: rate(0),
      repayments: null,
      points: [{ id: 'p1', asOf: '2026-01-15', balanceCents: 1_000_000 }],
      usual: { repaymentCents: 100_000, repaymentFrequency: 'monthly' },
    },
    '2026-03-20',
  )
  expect(l.estimated).toBe(true)
  const assumed = l.activity.filter((a) => a.kind === 'assumed')
  expect(assumed).toMatchObject([
    { key: 'assumed:2026-02-15', date: '2026-02-15', amountCents: -100_000, balanceAfterCents: 900_000 },
    { key: 'assumed:2026-03-15', date: '2026-03-15', amountCents: -100_000, balanceAfterCents: 800_000 },
  ])
  expect(bal(l, '2026-03-20')).toBe(800_000)
})

test('an explicit schedule sets the assumed due dates', () => {
  const l = ledger(
    {
      rates: rate(0),
      repayments: null,
      usual: { repaymentCents: 100_000, repaymentFrequency: 'monthly' },
      schedule: { nextDue: '2026-01-10', dueDay: 10 },
    },
    '2026-02-20',
  )
  expect(l.activity.filter((a) => a.kind === 'assumed').map((a) => a.date)).toEqual([
    '2026-01-10',
    '2026-02-10',
  ])
})

test('openingAccrued is charged with the first period', () => {
  const l = ledger({ openingAccrued: 5000 }, '2026-02-01')
  expect(interestRows(l)).toMatchObject([{ amountCents: 14_000 }])
  expect(ledger({ openingAccrued: 5000 }, '2026-01-31').accruing).toBe(14_000)
})

test('stopWhenPaidOff ends the walk on the payoff day', () => {
  const l = ledger(
    {
      rates: rate(0),
      repayments: null,
      points: [{ id: 'p1', asOf: '2026-01-01', balanceCents: 100_000 }],
      usual: { repaymentCents: 60_000, repaymentFrequency: 'monthly' },
      stopWhenPaidOff: true,
    },
    '2026-06-01',
  )
  expect(l.paidOffOn).toBe('2026-03-01')
  expect(l.days.at(-1)).toEqual({ date: '2026-03-01', balance: 0 })
})

test('stopWhenPaidOff keeps a part-month daily charge row', () => {
  const l = ledger(
    {
      settings: onCharge({ charge: 'daily', chargeDay: null }),
      repayments: null,
      points: [{ id: 'p1', asOf: '2026-01-01', balanceCents: 100_000 }],
      usual: { repaymentCents: 200_000, repaymentFrequency: 'monthly' },
      stopWhenPaidOff: true,
    },
    '2026-06-01',
  )
  expect(l.paidOffOn).toBe('2026-02-01')
  const last = interestRows(l).at(-1) as Extract<DebtActivityDto, { kind: 'interest' }>
  expect(last).toMatchObject({ chargeDate: '2026-02-28', periodStart: '2026-02-01', periodEnd: '2026-02-01' })
  const order = l.activity.filter((a) => a.date === '2026-02-01').map((a) => a.kind)
  expect(order).toEqual(['interest', 'assumed'])
})

test('rate rows and zero interest', () => {
  const rates = [...rate(0), { id: 'r2', fromDate: '2026-03-01', rateBp: 500 }]
  const l = ledger({ rates }, '2026-02-01')
  expect(interestRows(l)).toHaveLength(0)
  expect(l.activity[0]).toMatchObject({ kind: 'rate', rateBp: 0, date: '2026-01-01', key: 'rate:r1' })
  expect(l.activity.filter((a) => a.kind === 'rate')).toHaveLength(1)
})

test('a rate dated before the first balance is listed on that balance day', () => {
  const l = ledger({ rates: rate(1095, '2025-06-01') }, '2026-01-05')
  expect(l.activity[0]).toMatchObject({ kind: 'rate', date: '2026-01-01' })
})

test('no points gives an empty ledger', () => {
  const l = ledger({ points: [] }, '2026-01-05')
  expect(l).toMatchObject({ days: [], activity: [], accruing: 0, nextChargeOn: null })
})

test('interestDefaults by kind', () => {
  expect(interestDefaults('loan', '2026-03-15')).toEqual({
    calc: 'on_charge',
    charge: 'monthly',
    chargeDay: 15,
    chargeDate: null,
  })
  expect(interestDefaults('credit_card', '2026-03-09').chargeDay).toBe(9)
  expect(interestDefaults('ato', '2026-03-15')).toEqual({
    calc: 'daily',
    charge: 'monthly',
    chargeDay: 1,
    chargeDate: null,
  })
  expect(interestDefaults('hecs', '2026-03-15')).toEqual({
    calc: 'on_charge',
    charge: 'yearly',
    chargeDay: null,
    chargeDate: '06-01',
  })
  expect(interestDefaults('bnpl', '2026-03-15')).toMatchObject({ charge: 'monthly', chargeDay: 1 })
})

test('isChargeDay and editKey', () => {
  const m31 = onCharge({ chargeDay: 31 })
  expect(isChargeDay(m31, '2026-11-30')).toBe(true)
  expect(isChargeDay(m31, '2026-11-29')).toBe(false)
  expect(isChargeDay(m31, '2026-12-31')).toBe(true)
  const leap = onCharge({ charge: 'yearly', chargeDay: null, chargeDate: '02-29' })
  expect(isChargeDay(leap, '2027-02-28')).toBe(true)
  expect(isChargeDay(leap, '2028-02-28')).toBe(false)
  expect(isChargeDay(leap, '2028-02-29')).toBe(true)
  expect(isChargeDay(leap, '2028-03-29')).toBe(false)
  const daily = onCharge({ charge: 'daily', chargeDay: null })
  expect(isChargeDay(daily, '2026-05-07')).toBe(true)
  expect(editKey(daily, '2026-02-10')).toBe('2026-02-28')
  expect(editKey(daily, '2028-02-10')).toBe('2028-02-29')
  expect(editKey(m31, '2026-11-30')).toBe('2026-11-30')
})

test('rateOn', () => {
  const rates = [
    { id: 'b', fromDate: '2026-06-01', rateBp: 500 },
    { id: 'a', fromDate: '2026-01-01', rateBp: 300 },
  ]
  expect(rateOn(rates, '2025-01-01')).toBe(300)
  expect(rateOn(rates, '2026-05-31')).toBe(300)
  expect(rateOn(rates, '2026-06-01')).toBe(500)
  expect(rateOn(rates, '2030-01-01')).toBe(500)
})

test('an estimated debt with a $0 usual repayment has no assumed rows', () => {
  const l = ledger(
    {
      rates: rate(0),
      repayments: null,
      points: [{ id: 'p1', asOf: '2026-01-15', balanceCents: 1_000_000 }],
      usual: { repaymentCents: 0, repaymentFrequency: 'monthly' },
    },
    '2026-04-20',
  )
  expect(l.estimated).toBe(true)
  expect(l.activity.filter((a) => a.kind === 'assumed')).toHaveLength(0)
  expect(bal(l, '2026-04-20')).toBe(1_000_000)
})

test('an interest edit applies at $0 and can reopen the debt', () => {
  const points = [{ id: 'p1', asOf: '2026-01-01', balanceCents: 100_000 }]
  const l = ledger({ points, repayments: [repayment('2026-01-11', 200_000)], edits: { '2026-02-01': 2500 } }, '2026-02-01')
  expect(l.paidOffOn).toBeNull()
  expect(bal(l, '2026-01-31')).toBe(0)
  expect(bal(l, '2026-02-01')).toBe(2500)
  expect(interestRows(l)).toMatchObject([
    { chargeDate: '2026-02-01', amountCents: 2500, calculatedCents: 0, edited: true, balanceAfterCents: 2500 },
  ])
})

test.each([
  ['on_charge monthly', onCharge({ chargeDay: 7 }), 733],
  ['daily calculation monthly', monthly1, 1_137],
])('%s: each charge is whole cents, so every row adds up', (_name, settings, rateBp) => {
  const l = ledger(
    {
      settings,
      rates: rate(rateBp),
      points: [
        { id: 'p1', asOf: '2026-01-01', balanceCents: 1_234_567 },
        { id: 'p2', asOf: '2026-05-20', balanceCents: 1_000_001 },
      ],
      repayments: [
        repayment('2026-02-10', 51_111),
        repayment('2026-03-12', 49_999),
        repayment('2026-06-09', 33_333),
        repayment('2026-08-30', 22_222),
      ],
      entries: [{ id: 'e1', kind: 'added', date: '2026-04-03', amountCents: 1_234, note: null }],
    },
    '2026-12-31',
  )
  let prev: number | null = null
  let walked = 0
  for (const row of l.activity) {
    if (row.kind === 'check') {
      prev = row.balanceAfterCents
      continue
    }
    if (row.kind !== 'rate' && prev !== null) {
      walked++
      expect(prev + row.amountCents).toBe(row.balanceAfterCents)
    }
    prev = row.balanceAfterCents
  }
  expect(walked).toBeGreaterThan(15)
  expect(interestRows(l).length).toBeGreaterThan(8)
})

const feeRows = (l: Ledger) => l.activity.filter((a) => a.kind === 'fee').map((a) => [a.date, a.amountCents])

test('a monthly account fee comes out from its date, clamped to short months', () => {
  const l = ledger(
    { rates: rate(0), fee: { amountCents: 995, frequency: 'monthly', from: '2026-01-31' } },
    '2026-04-15',
  )
  expect(feeRows(l)).toEqual([
    ['2026-01-31', 995],
    ['2026-02-28', 995],
    ['2026-03-31', 995],
  ])
  expect(bal(l, '2026-04-15')).toBe(1_000_000 + 3 * 995)
})

test('weekly, fortnightly and yearly fees', () => {
  const run = (frequency: 'weekly' | 'fortnightly' | 'yearly', from: string, to: string) =>
    feeRows(ledger({ rates: rate(0), fee: { amountCents: 100, frequency, from } }, to)).map(([d]) => d)
  expect(run('weekly', '2026-01-05', '2026-01-26')).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'])
  expect(run('fortnightly', '2026-01-05', '2026-02-01')).toEqual(['2026-01-05', '2026-01-19'])
  expect(run('yearly', '2024-02-29', '2028-03-01')).toEqual(['2026-02-28', '2027-02-28', '2028-02-29'])
})

test('a fee comes after the interest charge, and not while nothing is owed', () => {
  const l = ledger(
    {
      fee: { amountCents: 500, frequency: 'monthly', from: '2026-02-01' },
      entries: [{ id: 'e1', kind: 'payment', date: '2026-02-15', amountCents: 2_000_000, note: null }],
    },
    '2026-04-02',
  )
  expect(kindsOn(l, '2026-02-01')).toEqual(['interest', 'fee'])
  expect(feeRows(l)).toEqual([['2026-02-01', 500]])
  expect(bal(l, '2026-04-02')).toBe(0)
})

test("the first balance is the opening amount: that day's payments and additions count after it", () => {
  const l = ledger(
    {
      rates: rate(0),
      repayments: [repayment('2026-01-01', 5_999)],
      entries: [{ id: 'e1', kind: 'added', date: '2026-01-01', amountCents: 1_000, note: null }],
    },
    '2026-01-02',
  )
  expect(kindsOn(l, '2026-01-01')).toEqual(['rate', 'check', 'added', 'repayment'])
  expect(l.activity.find((a) => a.kind === 'check')?.balanceAfterCents).toBe(1_000_000)
  expect(bal(l, '2026-01-01')).toBe(1_000_000 + 1_000 - 5_999)
  expect(bal(l, '2026-01-02')).toBe(1_000_000 + 1_000 - 5_999)
})

test('a first balance paid off that day is paid off', () => {
  const l = ledger(
    { rates: rate(0), points: [{ id: 'p1', asOf: '2026-01-01', balanceCents: 5_999 }], repayments: [repayment('2026-01-01', 5_999)] },
    '2026-01-03',
  )
  expect(l.paidOffOn).toBe('2026-01-01')
})
