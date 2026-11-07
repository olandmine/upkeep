import { describe, expect, test } from 'vitest'
import {
  buildPayView,
  changedKeys,
  draftChanges,
  isStructural,
  saverOptions,
  sliderMax,
  standardHeadline,
  startDraft,
  withCreate,
  withoutCreate,
  type DraftBucket,
  type PayDraft,
} from '../../src/web/lib/pay-view'
import type { AccountDto, BudgetPeriodDto, GoalDto, LineStatusDto, PayPlanDto, PlanItemDto } from '../../src/shared/types'

type Input = Parameters<typeof buildPayView>[0]

const account = (id: string, ownership: 'INDIVIDUAL' | 'JOINT', balanceCents = 100_000): AccountDto => ({
  id,
  displayName: `${id} Saver`,
  accountType: 'SAVER',
  ownership,
  ownerUserId: ownership === 'JOINT' ? null : 'u1',
  ownerName: null,
  balanceCents,
  currency: 'AUD',
  colorIndex: 0,
})

const line = (id: string, over: Partial<LineStatusDto> = {}): LineStatusDto => ({
  lineId: id,
  kind: 'spending',
  name: id,
  amountCents: 0,
  categoryIds: [],
  colorToken: `color-${id}`,
  saverAccountId: null,
  saverName: null,
  saverBalanceCents: null,
  saverMissing: false,
  spentCents: 0,
  remainingCents: null,
  spentRatio: null,
  state: null,
  coverage: null,
  contributedCents: null,
  withdrawnCents: null,
  contribution: null,
  goal: null,
  ...over,
})

const item = (over: Partial<PlanItemDto> & { id: string }): PlanItemDto => ({
  targetKind: 'saver',
  lineId: null,
  saverAccountId: null,
  amountCents: 0,
  targetName: over.id,
  resolvedSaverId: null,
  check: null,
  movedCents: null,
  ...over,
})

const saverItem = (saver: string, amountCents: number, check: PlanItemDto['check'] = null, movedCents: number | null = null) =>
  item({ id: `item-${saver}`, saverAccountId: saver, resolvedSaverId: saver, amountCents, check, movedCents })

const period = (over: Partial<BudgetPeriodDto> = {}): BudgetPeriodDto => ({
  budgetId: 'b1',
  start: '2026-10-30',
  end: null,
  nominalEnd: '2026-11-12',
  isCurrent: true,
  prevDate: null,
  nextDate: null,
  source: 'detected',
  payNotSeen: false,
  daysTotal: 14,
  daysElapsed: 7,
  incomeCents: 412_000,
  movedBackCents: 0,
  lines: [],
  notBudgetedCents: 0,
  totals: { limitCents: 0, spentCents: 0 },
  beforeSetup: false,
  ...over,
})

const plan = (items: PlanItemDto[], over: Partial<PayPlanDto> = {}): PayPlanDto => ({
  userId: 'u1',
  payDate: '2026-10-30',
  incomeCents: 412_000,
  incomeIsExpected: false,
  allocatedCents: 0,
  customised: false,
  items,
  ...over,
})

const draftWith = (over: Partial<PayDraft> = {}): PayDraft => ({
  baseline: {},
  amounts: {},
  texts: {},
  creates: [],
  updates: {},
  removals: [],
  ...over,
})

/** Pay $4,120.00, Savers $2,960.00, Groceries $400.00 ($286.40 spent), Eating out $250.00 ($212.75 spent). */
function example(draft?: Partial<PayDraft>, over: Partial<Input> = {}): Input {
  return {
    plan: plan([
      saverItem('rainy', 25_000, 'done', 25_000),
      saverItem('house', 200_000, 'pending', 0),
      saverItem('holiday', 71_000, 'partial', 20_000),
      item({ id: 'item-g', targetKind: 'line', lineId: 'groceries', amountCents: 40_000 }),
    ]),
    period: period({
      lines: [line('groceries', { amountCents: 40_000, spentCents: 28_640 }), line('eating', { amountCents: 25_000, spentCents: 21_275 })],
      notBudgetedCents: 19_830,
    }),
    jointPeriod: null,
    accounts: [account('rainy', 'INDIVIDUAL', 120_000), account('house', 'JOINT'), account('holiday', 'JOINT')],
    goals: [],
    draft: draft ? draftWith(draft) : null,
    ...over,
  }
}

const bucket = (v: ReturnType<typeof buildPayView>, key: string) => v.sections.flatMap((s) => s.buckets).find((b) => b.key === key)

test('the worked example adds up', () => {
  const v = buildPayView(example())
  expect(v.payCents).toBe(412_000)
  expect(v.saversCents).toBe(296_000)
  expect(v.spendingMoneyCents).toBe(116_000)
  expect(v.limitsCents).toBe(65_000)
  expect(v.otherBudgetCents).toBe(51_000)
  expect(v.spentCents).toBe(69_745)
  expect(v.leftToSpendCents).toBe(46_255)
  expect(v.overPayCents).toBe(0)
  expect(v.saverCount).toBe(3)
  expect(v.movedCount).toBe(1)
})

test('raising a limit lowers Other spending, not Left to spend', () => {
  const v = buildPayView(example({ amounts: { 'line:groceries': 50_000 } }))
  expect(v.otherBudgetCents).toBe(41_000)
  expect(v.leftToSpendCents).toBe(46_255)
})

test('raising a Saver lowers both', () => {
  const v = buildPayView(example({ amounts: { 'saver:rainy': 35_000 } }))
  expect(v.otherBudgetCents).toBe(41_000)
  expect(v.leftToSpendCents).toBe(36_255)
})

test('Savers +$600 goes over the pay', () => {
  const v = buildPayView(example({ amounts: { 'saver:rainy': 85_000 } }))
  expect(v.overPayCents).toBe(9_000)
  expect(v.leftToSpendCents).toBe(-13_745)
  expect(v.pace).toBe('over')
})

test('moved back adds to spending money', () => {
  const input = example()
  const v = buildPayView({ ...input, period: { ...input.period, movedBackCents: 12_000 } })
  expect(v.movedBackCents).toBe(12_000)
  expect(v.spendingMoneyCents).toBe(128_000)
  expect(v.otherBudgetCents).toBe(63_000)
  expect(v.leftToSpendCents).toBe(58_255)
})

test('spend on a personal line with a Saver counts as other spending', () => {
  const input = example()
  const v = buildPayView({
    ...input,
    plan: plan([
      ...input.plan!.items,
      item({
        id: 'item-car',
        targetKind: 'line',
        lineId: 'car',
        saverAccountId: null,
        resolvedSaverId: 'car',
        amountCents: 5_000,
      }),
    ]),
    period: {
      ...input.period,
      lines: [...input.period.lines, line('car', { amountCents: 10_000, spentCents: 3_000, saverAccountId: 'car' })],
    },
    accounts: [...input.accounts, account('car', 'INDIVIDUAL', 80_000)],
  })
  // Savers 296000 + 5000; spending money 111000; limits stay 65000 (the car limit is not a stay-in-Spending limit)
  expect(v.saversCents).toBe(301_000)
  expect(v.spendingMoneyCents).toBe(111_000)
  expect(v.limitsCents).toBe(65_000)
  expect(v.otherBudgetCents).toBe(46_000)
  // 28640 + 21275 + (19830 + 3000)
  expect(v.spentCents).toBe(72_745)
  expect(v.leftToSpendCents).toBe(38_255)
})

test('spend on a personal fund line counts as other spending', () => {
  const input = example()
  const v = buildPayView({
    ...input,
    period: {
      ...input.period,
      lines: [...input.period.lines, line('trip', { kind: 'fund', amountCents: 7_000, spentCents: 2_500, saverAccountId: 'tripfund' })],
    },
    accounts: [...input.accounts, account('tripfund', 'INDIVIDUAL', 9_000)],
  })
  // Savers 296000 + 7000; spending money 412000 - 303000 = 109000; limits stay 65000.
  expect(v.spendingMoneyCents).toBe(109_000)
  expect(v.otherBudgetCents).toBe(44_000)
  // Other spending 19830 + 2500 = 22330; with Groceries 28640 and Eating out 21275, spent is 72245.
  expect(bucket(v, 'other')!.spentCents).toBe(22_330)
  expect(v.spentCents).toBe(72_245)
  // 109000 - 72245
  expect(v.leftToSpendCents).toBe(36_755)
})

test('a personal fund line with no plan item shows at the line amount and counts as a Saver', () => {
  const input = example()
  const v = buildPayView({
    ...input,
    period: {
      ...input.period,
      lines: [...input.period.lines, line('trip', { kind: 'fund', amountCents: 7_000, saverAccountId: 'tripfund' })],
    },
    accounts: [...input.accounts, account('tripfund', 'INDIVIDUAL', 9_000)],
  })
  const b = bucket(v, 'saver:tripfund')!
  expect(b.amountCents).toBe(7_000)
  expect(b.lineId).toBe('trip')
  expect(v.sections.find((s) => s.id === 'yours')!.buckets.map((x) => x.key)).toContain('saver:tripfund')
  expect(v.saversCents).toBe(303_000)
  expect(v.spendingMoneyCents).toBe(109_000)
})

test('a personal spending line with a Saver shows under Your Savers', () => {
  const input = example()
  const v = buildPayView({
    ...input,
    plan: plan([
      ...input.plan!.items,
      item({ id: 'item-car', targetKind: 'line', lineId: 'car', resolvedSaverId: 'car', amountCents: 5_000 }),
    ]),
    period: {
      ...input.period,
      lines: [...input.period.lines, line('car', { amountCents: 10_000, spentCents: 3_000, saverAccountId: 'car' })],
    },
    accounts: [...input.accounts, account('car', 'INDIVIDUAL', 80_000)],
  })
  const b = bucket(v, 'saver:car')!
  expect(v.sections.find((s) => s.id === 'yours')!.buckets).toContain(b)
  expect(b.amountCents).toBe(5_000)
  expect(b.lineId).toBe('car')
  expect(b.spentCents).toBe(3_000)
  expect(b.caption).toContain('$30.00 of $100.00 spent')
})

test('a plan item for a joint line with no Saver shows as plain and counts towards limits', () => {
  const input = example()
  const v = buildPayView({
    ...input,
    plan: plan([
      ...input.plan!.items,
      item({
        id: 'item-rent',
        targetKind: 'line',
        lineId: 'rent',
        resolvedSaverId: null,
        amountCents: 30_000,
        targetName: 'Rent',
      }),
    ]),
  })
  const b = bucket(v, 'plain:rent')!
  expect(b.kind).toBe('plain')
  expect(b.name).toBe('Rent')
  expect(b.amountCents).toBe(30_000)
  expect(b.editable).toBe(false)
  expect(b.spentCents).toBeNull()
  expect(v.sections.find((s) => s.id === 'spending')!.buckets).toContain(b)
  expect(v.saversCents).toBe(296_000)
  expect(v.limitsCents).toBe(95_000)
  expect(v.otherBudgetCents).toBe(21_000)
  expect(v.leftToSpendCents).toBe(46_255)
})

test('buffer items are ignored', () => {
  const input = example()
  const v = buildPayView({
    ...input,
    plan: plan([...input.plan!.items, item({ id: 'item-buf', targetKind: 'buffer', amountCents: 99_999 })]),
  })
  expect(v.saversCents).toBe(296_000)
  expect(v.leftToSpendCents).toBe(46_255)
  expect(v.sections.flatMap((s) => s.buckets)).toHaveLength(6)
})

test('a joint Saver in the plan is in the joint section; one not in the plan is absent', () => {
  const input = example()
  const v = buildPayView({ ...input, accounts: [...input.accounts, account('unplanned', 'JOINT')] })
  const joint = v.sections.find((s) => s.id === 'joint')!
  expect(joint.buckets.map((b) => b.key)).toEqual(['saver:house', 'saver:holiday'])
  expect(joint.totalCents).toBe(271_000)
  expect(bucket(v, 'saver:unplanned')).toBeUndefined()
  expect(v.sections.find((s) => s.id === 'yours')!.buckets.map((b) => b.key)).toEqual(['saver:rainy'])
})

test('shared limits and shared other spending come from the joint period and do not change Left to spend', () => {
  const input = example()
  const v = buildPayView({
    ...input,
    jointPeriod: period({
      budgetId: 'joint',
      incomeCents: 0,
      lines: [
        line('food', {
          amountCents: 30_000,
          spentCents: 10_000,
          saverAccountId: 'house',
          saverName: 'House Saver',
          coverage: { state: 'covered', shortCents: 0 },
        }),
      ],
      notBudgetedCents: 5_000,
    }),
  })
  const shared = v.sections.find((s) => s.id === 'shared')!
  expect(shared.buckets.map((b) => b.key)).toEqual(['line:food', 'shared-other'])
  expect(shared.totalCents).toBe(30_000)
  const food = shared.buckets[0]!
  expect(food.kind).toBe('shared-limit')
  expect(food.amountCents).toBe(30_000)
  expect(food.spentCents).toBe(10_000)
  expect(food.leftCents).toBe(20_000)
  expect(food.caption).toBe('House Saver covers it')
  const other = shared.buckets[1]!
  expect(other.kind).toBe('shared-other')
  expect(other.amountCents).toBeNull()
  expect(other.editable).toBe(false)
  expect(other.spentCents).toBe(5_000)
  expect(v.spentCents).toBe(69_745)
  expect(v.leftToSpendCents).toBe(46_255)
})

test('rows sort largest first within a section', () => {
  const v = buildPayView(example())
  expect(v.sections.find((s) => s.id === 'spending')!.buckets.map((b) => b.key)).toEqual(['line:groceries', 'line:eating', 'other'])
  expect(v.sections.find((s) => s.id === 'spending')!.totalCents).toBe(116_000)
})

test('while editing, rows sort by their starting amounts, so a slider does not reorder them', () => {
  const draft = startDraft(buildPayView(example()))
  draft.amounts = { 'line:eating': 90_000 }
  const v = buildPayView({ ...example(), draft })
  expect(bucket(v, 'line:eating')!.amountCents).toBe(90_000)
  expect(v.sections.find((s) => s.id === 'spending')!.buckets.map((b) => b.key)).toEqual(['line:groceries', 'line:eating', 'other'])
})

test('draftChanges gives the same result for a copy of the view', () => {
  const saved = buildPayView(example())
  const draft = startDraft(saved)
  draft.amounts = { 'saver:rainy': 30_000 }
  draft.removals = ['saver:house']
  const view = buildPayView({ ...example(), draft })
  expect(draftChanges({ ...view }, saved, draft, '2026-10-30', 'every-pay')).toEqual(
    draftChanges(view, saved, draft, '2026-10-30', 'every-pay'),
  )
  expect(draftChanges({ ...view }, saved, draft, '2026-10-30', 'every-pay').savers.remove).toEqual(['house'])
})

test('a shared limit says who covers it, or how short it is', () => {
  const food = (coverage: LineStatusDto['coverage']) =>
    bucket(
      buildPayView({
        ...example(),
        jointPeriod: period({
          lines: [
            line('food', {
              amountCents: 30_000,
              saverAccountId: 'house',
              saverName: 'House Saver',
              coverage,
            }),
          ],
        }),
      }),
      'line:food',
    )!.caption
  expect(food({ state: 'covered', shortCents: 0 })).toBe('House Saver covers it')
  expect(food({ state: 'short', shortCents: 4_550 })).toBe('Short $45.50')
})

test('empty sections are left out, except while editing', () => {
  const v = buildPayView(example())
  expect(v.sections.map((s) => s.id)).toEqual(['spending', 'yours', 'joint'])
  const editing = buildPayView(example({}, { plan: null }))
  expect(editing.sections.map((s) => s.id)).toEqual(['spending', 'yours', 'joint', 'shared'])
  const notEditing = buildPayView(example(undefined, { plan: null }))
  expect(notEditing.sections.map((s) => s.id)).toEqual(['spending'])
})

describe('pace', () => {
  test('is null for a past period', () => {
    const input = example()
    expect(buildPayView({ ...input, period: { ...input.period, isCurrent: false } }).pace).toBeNull()
  })
  test('on pace at or below elapsed share', () => {
    // spent 10000 of 20000 spending money = 0.5, and 7 of 14 days = 0.5
    const v = buildPayView({
      plan: null,
      period: period({ incomeCents: 20_000, notBudgetedCents: 10_000 }),
      jointPeriod: null,
      accounts: [],
      goals: [],
    })
    expect(v.pace).toBe('on-pace')
    expect(buildPayView(example({}, { period: { ...example().period, daysElapsed: 10 } })).pace).toBe('on-pace')
  })
  test('fast above it', () => {
    // 69745 / 116000 = 0.60 > 7/14
    expect(buildPayView(example()).pace).toBe('fast')
  })
})

test('a limit at 85% is warning; above 100% is over', () => {
  const withSpent = (spentCents: number) =>
    buildPayView(
      example(undefined, {
        period: period({ lines: [line('groceries', { amountCents: 40_000, spentCents })] }),
      }),
    )
  const at85 = bucket(withSpent(34_000), 'line:groceries')!
  expect(at85.state).toBe('warning')
  expect(at85.percent).toBeCloseTo(85)
  expect(bucket(withSpent(28_640), 'line:groceries')!.state).toBe('ok')
  expect(bucket(withSpent(40_000), 'line:groceries')!.state).toBe('warning')
  const over = bucket(withSpent(40_001), 'line:groceries')!
  expect(over.state).toBe('over')
  expect(over.leftCents).toBe(-1)
})

test('sliderMax', () => {
  expect(sliderMax(40_000, 40_000)).toBe(80_000)
  expect(sliderMax(5_000, 5_000)).toBe(20_000)
  expect(sliderMax(15_000, 15_000)).toBe(30_000)
  expect(sliderMax(12_000, 12_000)).toBe(24_000)
  expect(sliderMax(40_000, 95_000)).toBe(95_000)
})

test('draftChanges sends only changed rows, sorted into savers and limits', () => {
  const saved = buildPayView(example())
  const base = saved
  const draft = startDraft(base)
  expect(draft.baseline).toMatchObject({
    'line:groceries': 40_000,
    'saver:rainy': 25_000,
    'saver:house': 200_000,
  })
  expect(draft.baseline.other).toBeUndefined()
  draft.amounts = { 'line:groceries': 50_000, 'saver:rainy': 30_000, 'line:eating': 25_000 }
  draft.removals = ['saver:holiday']
  draft.creates = [
    {
      tempId: 't1',
      section: 'spending',
      name: 'Pets',
      amountCents: 5_000,
      categoryIds: ['c1'],
      saverAccountId: null,
    },
    {
      tempId: 't2',
      section: 'shared',
      name: 'Gifts',
      amountCents: 8_000,
      categoryIds: [],
      saverAccountId: 'house',
    },
  ]
  const view = buildPayView({ ...example(), draft })
  expect(changedKeys(view, saved)).toEqual(['line:groceries', 'saver:rainy'])
  expect(draftChanges(view, saved, draft, '2026-10-30', 'every-pay')).toEqual({
    payDate: '2026-10-30',
    applyTo: 'every-pay',
    savers: { set: [{ saverAccountId: 'rainy', amountCents: 30_000 }], remove: ['holiday'] },
    limits: [{ lineId: 'groceries', amountCents: 50_000 }],
    lines: {
      create: [
        {
          budget: 'personal',
          kind: 'spending',
          name: 'Pets',
          amountCents: 5_000,
          categoryIds: ['c1'],
          saverAccountId: null,
        },
        {
          budget: 'joint',
          kind: 'spending',
          name: 'Gifts',
          amountCents: 8_000,
          categoryIds: [],
          saverAccountId: 'house',
        },
      ],
      update: [],
      archive: [],
    },
  })
})

test('draftChanges archives removed limits and passes line updates', () => {
  const saved = buildPayView(example())
  const draft = startDraft(saved)
  draft.removals = ['line:eating']
  draft.updates = { groceries: { name: 'Food' } }
  const view = buildPayView({ ...example(), draft })
  const out = draftChanges(view, saved, draft, '2026-10-30', 'every-pay')
  expect(out.lines.archive).toEqual(['eating'])
  expect(out.lines.update).toEqual([{ lineId: 'groceries', name: 'Food' }])
  expect(bucket(view, 'line:groceries')!.name).toBe('Food')
  // eating's 21275 is now other spending: 51000 + 25000 = 76000 budget, 19830 + 21275 spent
  expect(view.limitsCents).toBe(40_000)
  expect(view.spentCents).toBe(69_745)
})

test('isStructural counts adds, removals and edits, not amounts alone, and reads what would be sent', () => {
  const saved = buildPayView(example())
  const structural = (over: Partial<PayDraft>) => {
    const draft = { ...startDraft(saved), ...over }
    const view = buildPayView({ ...example(), draft })
    return isStructural(draftChanges(view, saved, draft, '2026-10-30', 'every-pay'), saved)
  }
  expect(structural({ amounts: { 'line:groceries': 1 } })).toBe(false)
  expect(structural({ removals: ['saver:rainy'] })).toBe(true)
  expect(structural({ removals: ['line:eating'] })).toBe(true)
  expect(structural({ updates: { groceries: { name: 'x' } } })).toBe(true)
  const create: DraftBucket = {
    tempId: 't',
    section: 'spending',
    name: 'n',
    amountCents: 0,
    categoryIds: ['c'],
    saverAccountId: null,
  }
  expect(structural({ creates: [create] })).toBe(true)
  // A new Saver is only a savers.set entry, but it is still an addition.
  const newSaver: DraftBucket = {
    tempId: 's',
    section: 'yours',
    name: 'x',
    amountCents: 500,
    categoryIds: [],
    saverAccountId: 'spare',
  }
  expect(structural({ creates: [newSaver] })).toBe(true)
  // Entries for buckets that have gone send nothing, so they are not structural.
  expect(structural({ removals: ['line:gone'], updates: { gone: { name: 'x' } } })).toBe(false)
})

test('a removed Saver with a personal fund line also archives that line', () => {
  const input = example()
  const withFund: Input = {
    ...input,
    period: {
      ...input.period,
      lines: [...input.period.lines, line('fund-rainy', { kind: 'fund', saverAccountId: 'rainy', amountCents: 25_000 })],
    },
  }
  const saved = buildPayView(withFund)
  // The plan item is Saver-kind, so it has no line id of its own: the bucket still carries the fund line's.
  expect(bucket(saved, 'saver:rainy')!.lineId).toBe('fund-rainy')
  const draft = startDraft(saved)
  draft.removals = ['saver:rainy', 'saver:house']
  const out = draftChanges(buildPayView({ ...withFund, draft }), saved, draft, '2026-10-30', 'every-pay')
  expect(out.savers.remove).toEqual(['rainy', 'house'])
  expect(out.lines.archive).toEqual(['fund-rainy'])
})

test('removing a Saver that a spending limit is linked to also archives that limit', () => {
  const input = example()
  const linked: Input = {
    ...input,
    period: {
      ...input.period,
      lines: [...input.period.lines, line('trip', { saverAccountId: 'rainy', amountCents: 3_000 })],
    },
  }
  const saved = buildPayView(linked)
  const draft = startDraft(saved)
  draft.removals = ['saver:rainy']
  const out = draftChanges(buildPayView({ ...linked, draft }), saved, draft, '2026-10-30', 'every-pay')
  expect(out.savers.remove).toEqual(['rainy'])
  // Left active, the limit would bring the Saver straight back.
  expect(out.lines.archive).toEqual(['trip'])
})

describe('a personal limit paid from a Saver', () => {
  const input = example()
  const rent = (over: Partial<LineStatusDto> = {}) =>
    line('rent', { name: 'Rent', amountCents: 80_000, spentCents: 10_000, categoryIds: ['rent'], ...over })

  test('stays in Spending with a caption while tried, and sends the link', () => {
    const saved = buildPayView(input)
    const draft = startDraft(saved)
    draft.updates = { groceries: { saverAccountId: 'spare' } }
    const view = buildPayView({ ...input, accounts: [...input.accounts, account('spare', 'INDIVIDUAL')], draft })
    expect(view.sections[0].buckets.map((b) => b.key)).toContain('line:groceries')
    expect(bucket(view, 'line:groceries')!.caption).toBe('Paid from spare Saver')
    expect(draftChanges(view, saved, draft, '2026-10-30', 'every-pay').lines.update).toEqual([
      { lineId: 'groceries', saverAccountId: 'spare' },
    ])
    // Choosing No Saver again is a change back to nothing.
    draft.updates = { groceries: { saverAccountId: null } }
    expect(bucket(buildPayView({ ...input, draft }), 'line:groceries')!.caption).toBeNull()
  })

  test('sets its limit in limits, and clearing its Saver is an update, never a Saver amount', () => {
    const withCar: Input = {
      ...input,
      plan: plan([
        ...input.plan!.items,
        item({ id: 'item-car', targetKind: 'line', lineId: 'car', resolvedSaverId: 'car', amountCents: 5_000 }),
      ]),
      period: {
        ...input.period,
        lines: [...input.period.lines, line('car', { name: 'Car', amountCents: 10_000, spentCents: 3_000, saverAccountId: 'car' })],
      },
      accounts: [...input.accounts, account('car', 'INDIVIDUAL', 80_000)],
    }
    const saved = buildPayView(withCar)
    expect(bucket(saved, 'saver:car')).toMatchObject({ lineName: 'Car', limitCents: 10_000, amountCents: 5_000 })
    const draft = startDraft(saved)
    draft.updates = { car: { amountCents: 12_000, saverAccountId: null } }
    const view = buildPayView({ ...withCar, draft })
    expect(bucket(view, 'saver:car')).toMatchObject({ limitCents: 12_000, saverAccountId: null })
    expect(draftChanges(view, saved, draft, '2026-10-30', 'every-pay')).toEqual({
      payDate: '2026-10-30',
      applyTo: 'every-pay',
      savers: { set: [], remove: [] },
      limits: [{ lineId: 'car', amountCents: 12_000 }],
      lines: { create: [], update: [{ lineId: 'car', saverAccountId: null }], archive: [] },
    })
  })

  test("still sends a change to its row's amount once its Saver is cleared", () => {
    const withCar: Input = {
      ...input,
      plan: plan([
        ...input.plan!.items,
        item({ id: 'item-car', targetKind: 'line', lineId: 'car', resolvedSaverId: 'car', amountCents: 5_000 }),
      ]),
      period: {
        ...input.period,
        lines: [...input.period.lines, line('car', { name: 'Car', amountCents: 10_000, saverAccountId: 'car' })],
      },
      accounts: [...input.accounts, account('car', 'INDIVIDUAL', 80_000)],
    }
    const saved = buildPayView(withCar)
    const draft = startDraft(saved)
    draft.updates = { car: { saverAccountId: null } }
    draft.amounts = { 'saver:car': 7_000 }
    const out = draftChanges(buildPayView({ ...withCar, draft }), saved, draft, '2026-10-30', 'every-pay')
    expect(out.savers.set).toEqual([{ saverAccountId: 'car', amountCents: 7_000 }])
    expect(out.lines.update).toEqual([{ lineId: 'car', saverAccountId: null }])
  })

  test('is shown under Your Savers at its own amount after Apply, even with no plan item', () => {
    const applied: Input = {
      ...input,
      period: { ...input.period, lines: [...input.period.lines, rent({ saverAccountId: 'spare' })] },
      accounts: [...input.accounts, account('spare', 'INDIVIDUAL')],
    }
    const view = buildPayView(applied)
    expect(view.sections.find((s) => s.id === 'spending')!.buckets.map((b) => b.key)).not.toContain('line:rent')
    expect(view.sections.find((s) => s.id === 'yours')!.buckets.map((b) => b.key)).toContain('saver:spare')
    expect(bucket(view, 'saver:spare')).toMatchObject({ amountCents: 80_000, lineId: 'rent' })
    expect(view.saversCents).toBe(296_000 + 80_000)
  })
})

describe('the draft totals match what Apply would save', () => {
  type View = ReturnType<typeof buildPayView>
  const totals = (v: View) => ({
    savers: v.saversCents,
    spendingMoney: v.spendingMoneyCents,
    limits: v.limitsCents,
    otherBudget: v.otherBudgetCents,
    otherSpent: bucket(v, 'other')!.spentCents,
    spent: v.spentCents,
    leftToSpend: v.leftToSpendCents,
    yours: v.sections.find((s) => s.id === 'yours')!.totalCents,
    joint: v.sections.find((s) => s.id === 'joint')!.totalCents,
  })
  const withSpare = (input: Input): Input => ({ ...input, accounts: [...input.accounts, account('spare', 'INDIVIDUAL')] })
  /** The line with the Saver the server would now have linked, and any plan item on it resolving to that Saver. */
  const applied = (input: Input, lineId: string, saverId: string | null): Input => ({
    ...input,
    plan: plan(input.plan!.items.map((i) => (i.lineId === lineId ? { ...i, resolvedSaverId: saverId } : i))),
    period: {
      ...input.period,
      lines: input.period.lines.map((l) => (l.lineId === lineId ? { ...l, saverAccountId: saverId } : l)),
    },
  })

  test('a limit given a Saver counts at its plan item amount, and its row stays put', () => {
    const input = withSpare(example())
    const draft = { ...startDraft(buildPayView(input)), updates: { groceries: { saverAccountId: 'spare' } } }
    const v = buildPayView({ ...input, draft })
    // Savers 296000 + 40000; spending money 76000; limits lose Groceries, leaving 25000; its 28640 moves to Other spending.
    expect(totals(v)).toEqual({
      savers: 336_000,
      spendingMoney: 76_000,
      limits: 25_000,
      otherBudget: 51_000,
      otherSpent: 48_470,
      spent: 69_745,
      leftToSpend: 6_255,
      yours: 65_000,
      joint: 271_000,
    })
    expect(totals(v)).toEqual(totals(buildPayView(applied(input, 'groceries', 'spare'))))
    expect(v.sections.find((s) => s.id === 'spending')!.buckets.map((b) => b.key)).toContain('line:groceries')
    expect(bucket(v, 'line:groceries')!.caption).toBe('Paid from spare Saver')
    expect(bucket(v, 'saver:spare')).toBeUndefined()
  })

  test('a limit given a Saver with no plan item counts at its own amount', () => {
    const input = withSpare(example())
    const draft = { ...startDraft(buildPayView(input)), updates: { eating: { saverAccountId: 'spare' } } }
    const v = buildPayView({ ...input, draft })
    // Savers 296000 + 25000; spending money 91000; spent is unchanged at 69745.
    expect(v.saversCents).toBe(321_000)
    expect(v.leftToSpendCents).toBe(21_255)
    expect(totals(v)).toEqual(totals(buildPayView(applied(input, 'eating', 'spare'))))
  })

  test('a limit whose plan item differs from it counts at the plan item amount', () => {
    const input = withSpare(example())
    const planned: Input = {
      ...input,
      plan: plan(input.plan!.items.map((i) => (i.lineId === 'groceries' ? { ...i, amountCents: 30_000 } : i))),
    }
    const draft = { ...startDraft(buildPayView(planned)), updates: { groceries: { saverAccountId: 'spare' } } }
    const v = buildPayView({ ...planned, draft })
    expect(v.saversCents).toBe(326_000)
    expect(totals(v)).toEqual(totals(buildPayView(applied(planned, 'groceries', 'spare'))))
  })

  test('clearing a Saver takes the row out of the Savers and puts its limit back', () => {
    const input = example()
    const linked: Input = {
      ...input,
      plan: plan([
        ...input.plan!.items,
        item({ id: 'item-car', targetKind: 'line', lineId: 'car', resolvedSaverId: 'car', amountCents: 5_000 }),
      ]),
      period: {
        ...input.period,
        lines: [...input.period.lines, line('car', { name: 'Car', amountCents: 10_000, spentCents: 3_000, saverAccountId: 'car' })],
      },
      accounts: [...input.accounts, account('car', 'INDIVIDUAL', 80_000)],
    }
    const draft = { ...startDraft(buildPayView(linked)), updates: { car: { saverAccountId: null } } }
    const v = buildPayView({ ...linked, draft })
    // Savers back to 296000; spending money 116000; limits 65000 + 10000; 72745 spent, as before.
    expect(totals(v)).toEqual({
      savers: 296_000,
      spendingMoney: 116_000,
      limits: 75_000,
      otherBudget: 41_000,
      otherSpent: 19_830,
      spent: 72_745,
      leftToSpend: 43_255,
      yours: 25_000,
      joint: 271_000,
    })
    expect(totals(v)).toEqual(totals(buildPayView(applied(linked, 'car', null))))
    expect(bucket(v, 'saver:car')).toMatchObject({ amountCents: 5_000, saverAccountId: null })
    expect(bucket(v, 'line:car')).toBeUndefined()
  })

  test('a new limit with a Saver counts at its amount', () => {
    const input = withSpare(example())
    const draft = withCreate(startDraft(buildPayView(input)), {
      tempId: 't',
      section: 'spending',
      name: 'Rent',
      amountCents: 80_000,
      categoryIds: ['rent'],
      saverAccountId: 'spare',
    })
    const v = buildPayView({ ...input, draft })
    // Savers 296000 + 80000; spending money 36000; limits stay 65000; 69745 spent.
    expect(v.saversCents).toBe(376_000)
    expect(v.limitsCents).toBe(65_000)
    expect(v.otherBudgetCents).toBe(-29_000)
    expect(v.overPayCents).toBe(29_000)
    expect(v.leftToSpendCents).toBe(-33_745)
    expect(bucket(v, 'new:t')!.caption).toBe('Paid from spare Saver')
    const after: Input = {
      ...input,
      period: {
        ...input.period,
        lines: [...input.period.lines, line('rent', { name: 'Rent', amountCents: 80_000, saverAccountId: 'spare' })],
      },
    }
    expect(totals(v)).toEqual(totals(buildPayView(after)))
  })
})

test('a Saver removed and then added again is only set', () => {
  const saved = buildPayView(example())
  const draft = withCreate(startDraft(saved), {
    tempId: 's',
    section: 'yours',
    name: 'x',
    amountCents: 9_000,
    categoryIds: [],
    saverAccountId: 'rainy',
  })
  draft.removals = ['saver:rainy']
  const out = draftChanges(buildPayView({ ...example(), draft }), saved, draft, '2026-10-30', 'every-pay')
  expect(out.savers).toEqual({ set: [{ saverAccountId: 'rainy', amountCents: 9_000 }], remove: [] })
})

test('a name update never renames a Saver, only limits', () => {
  const input = example()
  const fund: Input = {
    ...input,
    period: {
      ...input.period,
      lines: [...input.period.lines, line('fund-rainy', { kind: 'fund', name: 'Rainy fund', saverAccountId: 'rainy' })],
    },
  }
  const draft = startDraft(buildPayView(fund))
  draft.updates = { 'fund-rainy': { name: 'Renamed' }, groceries: { name: 'Food' } }
  const view = buildPayView({ ...fund, draft })
  expect(bucket(view, 'saver:rainy')!.name).toBe('rainy Saver')
  expect(bucket(view, 'line:groceries')!.name).toBe('Food')
  const out = draftChanges(view, buildPayView(fund), draft, '2026-10-30', 'every-pay')
  expect(out.lines.update).toEqual([{ lineId: 'groceries', name: 'Food' }])
})

describe('a bucket created in the draft', () => {
  const made: DraftBucket = {
    tempId: 't1',
    section: 'spending',
    name: 'Pets',
    amountCents: 5_000,
    categoryIds: ['c1'],
    saverAccountId: null,
  }

  test('keeps its place and slider range as its amount changes', () => {
    const saved = buildPayView(example())
    const draft = withCreate(startDraft(saved), made)
    expect(draft.baseline['new:t1']).toBe(5_000)
    const keys = (d: PayDraft) => buildPayView({ ...example(), draft: d }).sections[0].buckets.map((b) => b.key)
    expect(keys(draft)).toEqual(['line:groceries', 'line:eating', 'new:t1', 'other'])
    // Dragged above Groceries, it still sorts by the amount it was created with.
    expect(keys({ ...draft, amounts: { 'new:t1': 90_000 } })).toEqual(['line:groceries', 'line:eating', 'new:t1', 'other'])
  })

  test('is gone, with everything about it, once taken back out', () => {
    const draft = withCreate(startDraft(buildPayView(example())), made)
    draft.amounts = { 'new:t1': 9_000 }
    draft.texts = { 'new:t1': '90' }
    const out = withoutCreate(draft, 't1')
    expect(out.creates).toEqual([])
    expect(out.baseline['new:t1']).toBeUndefined()
    expect(out.amounts).toEqual({})
    expect(out.texts).toEqual({})
  })
})

describe('saverOptions', () => {
  const mine = (id: string) => account(id, 'INDIVIDUAL')
  const theirs = { ...account('theirs', 'INDIVIDUAL'), ownerUserId: 'u2' }
  const accounts = [mine('rainy'), mine('spare'), mine('gs'), account('house', 'JOINT'), account('cabin', 'JOINT'), theirs]
  const lines = [
    { lineId: 'trip', name: 'Trip', kind: 'spending', saverAccountId: 'gs' },
    { lineId: 'cover', name: 'Cabin cover', kind: 'spending', saverAccountId: 'cabin' },
  ] as const
  const options = (section: Parameters<typeof saverOptions>[0], l: Parameters<typeof saverOptions>[2] = lines) =>
    saverOptions(section, buildPayView(example()), l, accounts, 'u1')

  test('Your Savers lists your Savers, with those in the plan disabled and saying so', () => {
    expect(options('yours')).toEqual([
      { id: 'gs', name: 'gs Saver', disabledReason: 'Used by Trip' },
      { id: 'rainy', name: 'rainy Saver', disabledReason: 'Already in your plan' },
      { id: 'spare', name: 'spare Saver', disabledReason: null },
    ])
  })

  test('Joint Savers lists joint Savers; one backing a shared limit can still be paid into', () => {
    expect(options('joint')).toEqual([
      { id: 'cabin', name: 'cabin Saver', disabledReason: null },
      { id: 'house', name: 'house Saver', disabledReason: 'Already in your plan' },
    ])
  })

  test('a joint Saver backing a shared limit can be added back after it is removed', () => {
    const saved = buildPayView(example())
    const draft = { ...startDraft(saved), removals: ['saver:house'] }
    const view = buildPayView({ ...example(), draft })
    const backing = [{ lineId: 'food', name: 'Shared food', kind: 'spending', saverAccountId: 'house' }] as const
    expect(saverOptions('joint', view, backing, accounts, 'u1').find((o) => o.id === 'house')!.disabledReason).toBeNull()
  })

  test("a partner's personal Savers are never listed", () => {
    for (const section of ['spending', 'yours', 'joint', 'shared'] as const) {
      expect(options(section).map((o) => o.id)).not.toContain('theirs')
    }
  })

  test('a Saver linked to a limit says who uses it', () => {
    expect(options('yours').find((o) => o.id === 'gs')).toMatchObject({ disabledReason: 'Used by Trip' })
    expect(options('shared').find((o) => o.id === 'cabin')).toMatchObject({
      disabledReason: 'Used by Cabin cover',
    })
  })

  test('a joint Saver on a personal limit says Add on Shared limits', () => {
    expect(options('spending').find((o) => o.id === 'house')).toEqual({
      id: 'house',
      name: 'house Saver',
      disabledReason: 'Add on Shared limits',
    })
    expect(options('spending').find((o) => o.id === 'spare')!.disabledReason).toBeNull()
  })

  test('linking a limit to a Saver already in the plan is disabled, so it never reaches the server', () => {
    expect(options('spending').find((o) => o.id === 'rainy')!.disabledReason).toBe('Already in your plan')
  })

  test('a joint Saver you pay into can still back a shared limit', () => {
    expect(options('shared').find((o) => o.id === 'house')!.disabledReason).toBeNull()
  })

  test('a Saver added in the draft counts as in the plan', () => {
    const draft = withCreate(startDraft(buildPayView(example())), {
      tempId: 's',
      section: 'yours',
      name: 'x',
      amountCents: 500,
      categoryIds: [],
      saverAccountId: 'spare',
    })
    const view = buildPayView({ ...example(), draft })
    expect(saverOptions('yours', view, [], accounts, 'u1').find((o) => o.id === 'spare')!.disabledReason).toBe('Already in your plan')
  })
})

test('a draft key for a bucket that no longer exists is ignored by the view and by draftChanges', () => {
  // The draft began when Eating out and the House Saver existed; both are gone now.
  const draft = startDraft(buildPayView(example()))
  draft.amounts = { 'line:eating': 90_000, 'saver:house': 1, 'line:groceries': 50_000 }
  draft.removals = ['saver:house', 'line:eating']
  draft.updates = { eating: { name: 'Gone' } }
  const input = example()
  const now: Input = {
    ...input,
    plan: plan(input.plan!.items.filter((i) => i.resolvedSaverId !== 'house')),
    period: { ...input.period, lines: input.period.lines.filter((l) => l.lineId !== 'eating') },
    draft,
  }
  const view = buildPayView(now)
  const saved = buildPayView({ ...now, draft: null })
  // Savers 25000 + 71000; groceries raised to 50000; eating's spend is not in the lines any more.
  expect(view.saversCents).toBe(96_000)
  expect(view.limitsCents).toBe(50_000)
  expect(changedKeys(view, saved)).toEqual(['line:groceries'])
  const out = draftChanges(view, saved, draft, '2026-10-30', 'this-pay')
  expect(out.savers).toEqual({ set: [], remove: [] })
  expect(out.limits).toEqual([{ lineId: 'groceries', amountCents: 50_000 }])
  expect(out.lines).toEqual({ create: [], update: [], archive: [] })
})

describe('the changed-key rule', () => {
  const savedView = () => buildPayView(example())

  test('a row is changed when it differs from what is saved now, not from where Edit began', () => {
    // Edit began with Eating out at 25000; a refetch has since saved 26000.
    const draft = startDraft(savedView())
    const input = example()
    const refetched: Input = {
      ...input,
      period: {
        ...input.period,
        lines: input.period.lines.map((l) => (l.lineId === 'eating' ? { ...l, amountCents: 26_000 } : l)),
      },
    }
    const saved = buildPayView(refetched)
    expect(changedKeys(buildPayView({ ...refetched, draft }), saved)).toEqual([])
    draft.amounts = { 'line:eating': 25_000 }
    expect(changedKeys(buildPayView({ ...refetched, draft }), saved)).toEqual(['line:eating'])
    draft.amounts = { 'line:eating': 26_000 }
    expect(changedKeys(buildPayView({ ...refetched, draft }), saved)).toEqual([])
  })

  test('a row added after Edit began, once touched, is counted and sent', () => {
    const draft = startDraft(savedView())
    const input = example()
    const refetched: Input = {
      ...input,
      period: { ...input.period, lines: [...input.period.lines, line('pets', { amountCents: 5_000 })] },
    }
    const saved = buildPayView(refetched)
    draft.amounts = { 'line:pets': 9_000 }
    const view = buildPayView({ ...refetched, draft })
    expect(draft.baseline['line:pets']).toBeUndefined()
    expect(changedKeys(view, saved)).toEqual(['line:pets'])
    expect(draftChanges(view, saved, draft, '2026-10-30', 'every-pay').limits).toEqual([{ lineId: 'pets', amountCents: 9_000 }])
  })

  test('a row with no baseline sorts by its saved amount, so a slider cannot move it', () => {
    const draft = startDraft(savedView())
    const input = example()
    const refetched: Input = {
      ...input,
      period: { ...input.period, lines: [...input.period.lines, line('pets', { amountCents: 5_000 })] },
    }
    const order = (amount: number) =>
      buildPayView({ ...refetched, draft: { ...draft, amounts: { 'line:pets': amount } } })
        .sections.flatMap((s) => s.buckets)
        .map((b) => b.key)
    expect(order(500_000)).toEqual(order(5_000))
  })
})

test('a $0 pay gives finite percents and no NaN', () => {
  const v = buildPayView({
    plan: null,
    period: period({
      incomeCents: 0,
      lines: [line('groceries', { amountCents: 10_000, spentCents: 5_000 }), line('zero', { amountCents: 0, spentCents: 100 })],
      notBudgetedCents: 2_000,
    }),
    jointPeriod: null,
    accounts: [],
    goals: [],
  })
  expect(v.spendingMoneyCents).toBe(0)
  expect(v.otherBudgetCents).toBe(-10_000)
  expect(v.overPayCents).toBe(10_000)
  expect(v.leftToSpendCents).toBe(-7_100)
  for (const b of v.sections.flatMap((s) => s.buckets)) expect(Number.isFinite(b.percent)).toBe(true)
  expect(bucket(v, 'other')!.percent).toBe(0)
  expect(bucket(v, 'line:zero')!.percent).toBe(0)
  expect(bucket(v, 'line:zero')!.state).toBe('over')
})

test('a Saver caption has its balance and goal', () => {
  const goal: GoalDto = {
    accountId: 'rainy',
    saverName: 'rainy Saver',
    balanceCents: 120_000,
    ownerUserId: 'u1',
    goal: { kind: 'save', name: 'Buffer', targetCents: 500_000, targetDate: null },
    progress: 0.24,
    status: 'reached',
    neededCents: null,
    neededPer: null,
    behindCents: null,
    projectedDate: null,
    toGoCents: null,
    expectedProgress: null,
    belowCents: null,
    recentRateCents: null,
    debtFallCents: null,
    followedDebtName: null,
    reachedOn: null,
    celebrate: false,
    ownerName: null,
    debt: null,
    plan: null,
    cadence: null,
    saverOutCents: null,
    sparkline: null,
    today: '2026-10-30',
    canEdit: true,
    accountMissing: false,
  }
  const b = bucket(buildPayView({ ...example(), goals: [goal] }), 'saver:rainy')!
  expect(b.caption).toBe('Balance $1,200.00 · Buffer · Reached ✓')
  expect(b.moved).toEqual({ check: 'done', movedCents: 25_000 })
  expect(b.name).toBe('rainy Saver')
})

describe('Standard pay', () => {
  const standardExample = (draft?: Partial<PayDraft>) => {
    const base = example(draft)
    return { ...base, period: { ...base.period, isCurrent: false }, standard: { hasUsual: true } }
  }
  const spendingSpent = (v: ReturnType<typeof buildPayView>) =>
    v.sections.find((s) => s.id === 'spending')!.buckets.reduce((sum, b) => sum + (b.spentCents ?? 0), 0)

  test('rows add up to the headline', () => {
    for (const draft of [undefined, { amounts: { 'line:groceries': 45_000 } }]) {
      const v = buildPayView(standardExample(draft))
      expect(v.spendingMoneyCents - spendingSpent(v)).toBe(v.leftToSpendCents)
    }
  })

  test('raising a limit leaves the headline alone and lowers Other spending', () => {
    const before = buildPayView(standardExample())
    const after = buildPayView(standardExample({ amounts: { 'line:groceries': 50_000 } }))
    expect(after.leftToSpendCents).toBe(before.leftToSpendCents)
    expect(bucket(after, 'other')!.amountCents).toBe(bucket(before, 'other')!.amountCents! - 10_000)
  })

  test('raising a Saver lowers the headline', () => {
    const before = buildPayView(standardExample())
    const after = buildPayView(standardExample({ amounts: { 'saver:rainy': 35_000 } }))
    expect(after.leftToSpendCents).toBe(before.leftToSpendCents - 10_000)
  })

  test('a limit paid from a Saver and covered by moved-back money cancels out', () => {
    const v = buildPayView({
      plan: plan([saverItem('car', 20_000)]),
      period: period({
        isCurrent: false,
        movedBackCents: 20_000,
        notBudgetedCents: 5_000,
        lines: [line('carlimit', { amountCents: 20_000, spentCents: 20_000, saverAccountId: 'car' })],
      }),
      jointPeriod: null,
      accounts: [account('car', 'INDIVIDUAL')],
      goals: [],
      standard: { hasUsual: true },
    })
    expect(v.leftToSpendCents).toBe(412_000 - 20_000 - 5_000)
  })

  test('Saver row caption reads Usually $X of $Y', () => {
    const input = (hasUsual: boolean): Input => ({
      plan: plan([saverItem('car', 20_000)]),
      period: period({ isCurrent: false, lines: [line('carlimit', { amountCents: 20_000, spentCents: 15_000, saverAccountId: 'car' })] }),
      jointPeriod: null,
      accounts: [account('car', 'INDIVIDUAL')],
      goals: [],
      standard: { hasUsual },
    })
    expect(bucket(buildPayView(input(true)), 'saver:car')!.caption).toBe('Balance $1,000.00 · Usually $150.00 of $200.00')
    expect(bucket(buildPayView(input(false)), 'saver:car')!.caption).toBe('Balance $1,000.00')
  })

  test('standardHeadline returns each label and amount', () => {
    const v = buildPayView(standardExample())
    expect(standardHeadline(v, true)).toEqual({ label: 'Usually left over', cents: v.leftToSpendCents })
    expect(standardHeadline(v, false)).toEqual({ label: 'Left after limits', cents: v.otherBudgetCents })
  })

  test('pace is null', () => {
    expect(buildPayView(standardExample()).pace).toBeNull()
  })
})
