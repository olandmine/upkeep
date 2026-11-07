import type { GoalDetailDto, GoalDto } from '../../src/shared/types'

export const goal = (over: Partial<GoalDto> = {}): GoalDto => ({
  accountId: 's1',
  saverName: 'Holiday Saver',
  balanceCents: 62_000,
  ownerUserId: 'u1',
  goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: '2026-12-31' },
  progress: 0.62,
  status: 'on-track',
  neededCents: 9_500,
  neededPer: 'pay',
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
  ...over,
})

/** The six-goal fixture from the goals revamp brief. */
export const sixGoals = (): GoalDto[] => [
  goal({
    accountId: 'tax',
    saverName: 'Tax Saver',
    balanceCents: 248_000,
    goal: { kind: 'debt', name: 'Tax', targetCents: 495_000, targetDate: '2027-03-31' },
    status: 'behind',
    neededCents: 24_700,
    behindCents: 4_700,
    recentRateCents: 20_000,
  }),
  goal({
    accountId: 'food',
    saverName: 'Food Saver',
    balanceCents: 36_000,
    goal: { kind: 'buffer', name: 'Food', targetCents: 40_000, targetDate: null },
    status: 'below',
    belowCents: 4_000,
    neededCents: null,
    neededPer: null,
  }),
  goal({
    accountId: 'hol',
    saverName: 'Holiday Saver',
    balanceCents: 245_000,
    goal: { kind: 'save', name: 'Holiday', targetCents: 600_000, targetDate: '2027-06-01' },
    status: 'on-track',
    neededCents: 25_400,
  }),
  goal({
    accountId: 'car',
    saverName: 'Car Saver',
    balanceCents: 890_000,
    goal: { kind: 'debt', name: 'Car', targetCents: 1_120_000, targetDate: null },
    status: 'projected',
    projectedDate: '2027-02-10',
    neededCents: null,
    neededPer: null,
  }),
  goal({
    accountId: 'emg',
    saverName: 'Emergency Saver',
    balanceCents: 1_200_000,
    goal: { kind: 'save', name: 'Emergency', targetCents: 1_000_000, targetDate: null },
    status: 'reached',
    progress: 1,
    neededCents: null,
    neededPer: null,
  }),
  goal({ accountId: 'rent', saverName: 'Rent Saver', balanceCents: 5_000, goal: null, status: null, progress: 0 }),
]

/** A save goal's page: two points, no paths, no months. */
export const goalDetail = (over: Partial<GoalDetailDto> = {}): GoalDetailDto => ({
  goal: goal({
    goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: null },
    status: 'not-growing',
    toGoCents: 38_000,
  }),
  range: '6m',
  points: [
    { date: '2026-10-23', balanceCents: 60_000, targetCents: 100_000 },
    { date: '2026-10-30', balanceCents: 62_000, targetCents: 100_000 },
  ],
  expected: null,
  projected: null,
  debt: null,
  months: [],
  transactionsHidden: false,
  ...over,
})

/** A debt goal with no date, closing from both ends: covered in Feb 2027. */
export const debtGoalDetail = (over: Partial<GoalDetailDto> = {}): GoalDetailDto =>
  goalDetail({
    goal: goal({
      balanceCents: 300_000,
      goal: { kind: 'debt', name: 'Car', targetCents: 800_000, targetDate: null },
      debt: { id: 'd1', name: 'Car loan', leftCents: 800_000, startTargetCents: 1_000_000, paidOff: false },
      status: 'projected',
      projectedDate: '2027-02-10',
      toGoCents: 500_000,
      recentRateCents: 100_000,
      debtFallCents: 45_000,
      cadence: { kind: 'month' },
    }),
    points: [
      { date: '2026-10-23', balanceCents: 290_000, targetCents: 810_000 },
      { date: '2026-10-30', balanceCents: 300_000, targetCents: 800_000 },
    ],
    projected: { date: '2027-02-10', saverCents: 575_000 },
    debt: {
      id: 'd1',
      name: 'Car loan',
      leftCents: 800_000,
      startTargetCents: 1_000_000,
      fallCents: 45_000,
      nextDue: '2026-11-01',
    },
    ...over,
  })
