import type { AccountDto, BudgetPeriodDto, LineStatusDto, PayPlanDto, PlanItemDto } from '../../src/shared/types'

export const account = (id: string, ownership: 'INDIVIDUAL' | 'JOINT', balanceCents = 100_000): AccountDto => ({
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

export const line = (id: string, over: Partial<LineStatusDto> = {}): LineStatusDto => ({
  lineId: id,
  kind: 'spending',
  name: id,
  amountCents: 0,
  categoryIds: [],
  colorToken: 'cat-blue',
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

export const item = (over: Partial<PlanItemDto> & { id: string }): PlanItemDto => ({
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

export const saverItem = (saver: string, amountCents: number, check: PlanItemDto['check'] = null, movedCents: number | null = null) =>
  item({ id: `item-${saver}`, saverAccountId: saver, resolvedSaverId: saver, amountCents, check, movedCents })

export const period = (over: Partial<BudgetPeriodDto> = {}): BudgetPeriodDto => ({
  budgetId: 'b1',
  start: '2026-10-30',
  end: null,
  nominalEnd: '2026-11-13',
  isCurrent: true,
  prevDate: null,
  nextDate: null,
  source: 'detected',
  payNotSeen: false,
  daysTotal: 14,
  daysElapsed: 10,
  incomeCents: 412_000,
  movedBackCents: 0,
  lines: [],
  notBudgetedCents: 0,
  totals: { limitCents: 0, spentCents: 0 },
  beforeSetup: false,
  ...over,
})

export const plan = (items: PlanItemDto[], over: Partial<PayPlanDto> = {}): PayPlanDto => ({
  userId: 'u1',
  payDate: '2026-10-30',
  incomeCents: 412_000,
  incomeIsExpected: false,
  allocatedCents: 0,
  customised: false,
  items,
  ...over,
})

/** Pay $4,120.00, Savers $2,960.00, spending money $1,160.00 with $697.45 spent. */
export const example = () => ({
  plan: plan([
    saverItem('rainy', 25_000, 'done', 25_000),
    saverItem('house', 200_000, 'pending', 0),
    saverItem('holiday', 71_000, 'partial', 20_000),
    item({ id: 'item-g', targetKind: 'line', lineId: 'groceries', amountCents: 40_000 }),
  ]),
  period: period({
    lines: [
      line('groceries', { name: 'Groceries', amountCents: 40_000, spentCents: 28_640, categoryIds: ['food'], state: 'ok' }),
      line('eating', { name: 'Eating out', amountCents: 25_000, spentCents: 21_275 }),
    ],
    notBudgetedCents: 19_830,
  }),
  jointPeriod: null as BudgetPeriodDto | null,
  accounts: [account('rainy', 'INDIVIDUAL', 120_000), account('house', 'JOINT'), account('holiday', 'JOINT')],
  goals: [],
})

