// DTOs shared by the API and the web app.

import type { Accent } from './accent'
import type { SharingLevel } from './sharing'

export type NegativeStyle = 'minus' | 'parentheses'

export interface UserDto {
  id: string
  username: string
  displayName: string
  upDisplayName: string | null
  negativeStyle: NegativeStyle
  accent: Accent
  /** How much of their finances this person shows the other; null until they choose. */
  sharingLevel: SharingLevel | null
  /** True once this person has connected Up or skipped the Connect Up screen. */
  connectUpAnswered: boolean
  /** True once this person has dismissed the Getting started card. */
  gettingStartedHidden: boolean
}

export type ConnectionStatus = 'ok' | 'unauthorized' | 'error'

export interface SyncStatusDto {
  connections: {
    userId: string
    displayName: string
    status: ConnectionStatus
    lastSyncedAt: string | null
    lastError: string | null
    lastFailedAt: string | null
    backfillCompletedAt: string | null
    running: { kind: string; startedAt: string; transactionsUpserted: number } | null
  }[]
}

export type Scope = 'everyone' | 'me' | 'partner' | 'joint'
export type TransactionStatus = 'HELD' | 'SETTLED'

export interface AccountDto {
  id: string
  displayName: string
  accountType: string
  ownership: 'INDIVIDUAL' | 'JOINT'
  ownerUserId: string | null
  ownerName: string | null
  balanceCents: number
  currency: string
  colorIndex: number
}

export interface TransactionDto {
  id: string
  accountId: string
  accountName: string
  status: TransactionStatus
  amountCents: number
  currency: string
  foreignAmountCents: number | null
  foreignCurrency: string | null
  description: string
  message: string | null
  rawText: string | null
  categoryId: string | null
  parentCategoryId: string | null
  isCategorizable: boolean
  roundUpCents: number | null
  cashbackCents: number | null
  cardMethod: string | null
  cardSuffix: string | null
  transferAccountId: string | null
  isTransfer: boolean
  performingCustomer: string | null
  performedByUserId: string | null
  createdAt: string
  settledAt: string | null
  deletedAt: string | null
  tags: string[]
}

export interface TxFilters {
  q?: string
  accountId?: string
  scope?: Scope
  categoryId?: string
  /** Any of these categories, or their children (a budget line's categories). */
  categoryIds?: string[]
  tag?: string
  status?: TransactionStatus
  from?: string
  to?: string
  minCents?: number
  maxCents?: number
  includeTransfers?: boolean
}

export interface TransactionPage {
  items: TransactionDto[]
  nextCursor: string | null
}

export interface CategoryDto {
  id: string
  name: string
  parentId: string | null
  colorToken: string
}

export interface MonthTotals {
  spentCents: number
  incomeCents: number
  netCents: number
}

export interface OverviewDto {
  totalBalanceCents: number
  homeLoanCents: number | null
  month: MonthTotals
  previousMonth: MonthTotals
  balancesByAccount: { accountId: string; displayName: string; colorIndex: number; balanceCents: number }[]
  spendingByParent: { parentId: string | null; name: string; colorToken: string; cents: number }[]
  topCategories: { categoryId: string | null; name: string; parentId: string | null; colorToken: string; cents: number }[]
  monthly: { month: string; spentCents: number; incomeCents: number }[]
  recent: TransactionDto[]
}

export type GettingStartedKey =
  | 'connect-up'
  | 'password'
  | 'handle'
  | 'partner'
  | 'budget'
  | 'joint-budget'
  | 'debt'
  | 'goal'
export interface GettingStartedItemDto {
  key: GettingStartedKey
  state: 'done' | 'open' | 'locked'
  optional: boolean
}
export interface GettingStartedDto {
  /** The card is showing: not hidden, and a counted item isn't done. */
  show: boolean
  items: GettingStartedItemDto[]
}

// Budgets & planning

export type BudgetKind = 'personal' | 'joint'
export type LineKind = 'spending' | 'fund'

export interface BudgetDto {
  id: string
  kind: BudgetKind
  ownerUserId: string | null
  name: string
  anchorUserId: string | null
  hasPeriods: boolean
  canEdit: boolean
  setup: 'ready' | 'needs-pay' | 'partner-not-connected'
}

export interface LineStatusDto {
  lineId: string
  kind: LineKind
  name: string
  amountCents: number
  categoryIds: string[]
  colorToken: string
  saverAccountId: string | null
  saverName: string | null
  saverBalanceCents: number | null
  saverMissing: boolean
  spentCents: number
  /** Spending lines only. */
  remainingCents: number | null
  spentRatio: number | null
  state: 'ok' | 'warning' | 'over' | null
  /** Spending lines with a Saver only. */
  coverage: { state: 'covered' | 'short'; shortCents: number } | null
  /** Fund lines only. */
  contributedCents: number | null
  withdrawnCents: number | null
  contribution: 'funded' | 'partial' | 'none' | null
  /** Fund lines whose Saver has a goal. */
  goal: { name: string; percent: number; reached: boolean } | null
}

export interface BudgetPeriodDto {
  budgetId: string
  start: string
  end: string | null
  nominalEnd: string
  isCurrent: boolean
  prevDate: string | null
  nextDate: string | null
  source: 'detected' | 'scheduled'
  payNotSeen: boolean
  daysTotal: number
  daysElapsed: number
  incomeCents: number
  /** Money moved from Savers back into the owner's Spending this period; 0 for Joint. */
  movedBackCents: number
  lines: LineStatusDto[]
  notBudgetedCents: number
  totals: { limitCents: number; spentCents: number }
  beforeSetup: boolean
}

export type PlanTargetKind = 'line' | 'saver' | 'buffer'

export interface PlanItemInput {
  targetKind: PlanTargetKind
  lineId: string | null
  saverAccountId: string | null
  amountCents: number
}

/** A plan built from what Up moved after the last pay. Each item also names the Saver the money went to. */
export interface PlanProposalDto {
  expectedIncomeCents: number
  items: (PlanItemInput & { saverId: string })[]
}

export interface PlanItemDto extends PlanItemInput {
  id: string
  targetName: string
  resolvedSaverId: string | null
  check: 'done' | 'partial' | 'pending' | null
  movedCents: number | null
}

export interface PlanTemplateDto {
  expectedIncomeCents: number
  items: PlanItemDto[]
}

export interface PayPlanDto {
  userId: string
  payDate: string
  incomeCents: number
  incomeIsExpected: boolean
  allocatedCents: number
  customised: boolean
  items: PlanItemDto[]
}

/** What a normal pay usually leaves: the plan template and recent finished pays, medians, one-offs left out. */
export interface StandardPayDto {
  /** From the template, with incomeCents = usual pay and no moved checks. */
  plan: PayPlanDto
  /** Active lines at every-pay amounts; spentCents = usual; isCurrent false; start and end span the pays counted. */
  period: BudgetPeriodDto
  jointPeriod: BudgetPeriodDto | null
  /** Finished pays counted. */
  payCount: number
  /** payCount is at least 3. */
  hasUsual: boolean
  jointHasUsual: boolean
  /** False when usual pay fell back to the expected amount. */
  payIsMedian: boolean
}

/** Recent spending to suggest buckets from, over the dates a budget's last finished pays cover. */
export interface SpendingHistoryDto {
  /** First and last days counted. */
  from: string
  to: string
  payCount: number
  /** Most spent first, less refunds; the average per pay, to the nearest dollar. */
  categories: { categoryId: string; perPayCents: number }[]
  /** Spending with no category that Up lets you categorise. */
  uncategorised: { count: number; cents: number }
}

export interface PayScheduleDto {
  userId: string
  accountId: string
  accountName: string | null
  accountMissing: boolean
  descriptionMatch: string
  minAmountCents: number
  frequencyDays: number
}

export interface PayEventDto {
  payDate: string
  source: 'detected' | 'scheduled'
  transactionId: string | null
  amountCents: number | null
  extraCents: number
  payNotSeen: boolean
}

export interface PayCandidateDto {
  transaction: TransactionDto
  sameDescriptionCount: number
}

/** Body of POST /budgets/:id/lines (mirrors the server's LineInput). */
export interface LineInputDto {
  kind: LineKind
  name: string
  amountCents: number
  categoryIds: string[]
  saverAccountId: string | null
}

/** Body of PUT /budgets/pay-changes: a whole Edit-mode draft, applied in one transaction. */
export interface PayChangesInput {
  payDate: string
  applyTo: 'every-pay' | 'this-pay'
  savers: {
    set: { saverAccountId: string; amountCents: number }[]
    /** saverAccountIds */
    remove: string[]
  }
  limits: { lineId: string; amountCents: number }[]
  lines: {
    create: ({ budget: 'personal' | 'joint' } & LineInputDto)[]
    update: ({ lineId: string } & Partial<LineInputDto>)[]
    archive: string[]
  }
}

// Goals & debts

export type DebtKind = 'loan' | 'credit_card' | 'bnpl' | 'ato' | 'hecs'
export type RepaymentFrequency = 'weekly' | 'fortnightly' | 'monthly'

export interface DebtProjectionDto {
  payoffDate: string | null
  totalInterestCents: number
  /** Monthly shortfall when the repayment never pays it off. */
  shortfallCents: number | null
}

export interface DebtDto {
  id: string
  name: string
  kind: DebtKind
  ownerUserId: string | null
  ownerName: string
  /** The rate in force today. */
  rateBp: number
  interest: InterestSettingsDto
  repaymentCents: number
  repaymentFrequency: RepaymentFrequency
  fee: DebtFeeDto | null
  /** The descriptions that mark its repayments. */
  repaymentRules: DebtRepaymentRuleDto[]
  /** The charged balance: interest building up isn't in it until it's charged. */
  balanceCents: number
  /** Interest built up and not yet charged. */
  accruingCents: number
  /** The next day interest is charged. */
  nextChargeOn: string | null
  firstBalance: { asOf: string; balanceCents: number }
  paidOffOn: string | null
  projection: DebtProjectionDto | null
  /** No marked repayments: past repayments are assumed from the usual repayment. */
  estimated: boolean
  canEdit: boolean
}

export interface DebtRepaymentRuleDto {
  id: string
  /** Normalised description. */
  match: string
}

export interface DebtRepaymentDto {
  transactionId: string
  date: string
  amountCents: number
  description: string
  /** Marked on its own, not by a rule. */
  oneOff: boolean
}

export interface DebtBalancePoint {
  date: string
  balanceCents: number
}

export interface DebtDetailDto extends DebtDto {
  timeline: DebtBalancePoint[]
  balances: { id: string; asOf: string; balanceCents: number; correctionCents: number | null }[]
  rates: DebtRateDto[]
  /** Newest first. */
  activity: DebtActivityDto[]
  exclusions: DebtRepaymentDto[]
}

export interface DebtInputDto {
  name: string
  kind: DebtKind
  ownerUserId: string | null
  /** The first rate, from `asOf`. */
  rateBp: number
  /** Omitted: the kind's defaults. */
  interest?: InterestSettingsDto
  repaymentCents: number
  repaymentFrequency: RepaymentFrequency
  balanceCents: number
  asOf: string
  /** Omitted or null: no account fee. */
  fee?: DebtFeeDto | null
}

/** The rate changes through the rate history, not here. */
export type DebtPatchDto = Partial<Pick<DebtInputDto, 'name' | 'repaymentCents' | 'repaymentFrequency' | 'fee'>> & {
  interest?: InterestSettingsDto
}

export type PayoffStrategy = 'as-is' | 'avalanche' | 'snowball'

export interface PayoffScenarioDto {
  strategy: PayoffStrategy
  debtFreeMonth: string | null
  totalInterestCents: number
  debts: { id: string; name: string; payoffMonth: string | null }[]
  series: { month: string; totalCents: number }[]
}

export interface PayoffPlanDto {
  extraCents: number
  includeHecs: boolean
  canEdit: boolean
  scenarios: PayoffScenarioDto[]
  differences: string[]
}

export type GoalStatus = 'reached' | 'on-track' | 'behind' | 'date-passed' | 'projected' | 'not-growing' | 'topped-up' | 'below'

/** Save up to a target, keep a Saver topped up to a level, or cover what's left on a debt. */
export type GoalKind = 'save' | 'buffer' | 'debt'

export interface GoalDto {
  accountId: string
  saverName: string | null
  balanceCents: number
  ownerUserId: string | null
  /**
   * `isDefault`: Upkeep's built-in goal, not one the user set (the Save Up Challenge Saver).
   * Debt goals: targetCents is what's left on the debt today.
   */
  goal: { kind: GoalKind; name: string; targetCents: number; targetDate: string | null; isDefault?: boolean } | null
  /** The debt a debt goal follows; `startTargetCents` is what was left when the goal's start was last set. */
  debt: { id: string; name: string; leftCents: number; startTargetCents: number; paidOff: boolean } | null
  progress: number
  status: GoalStatus | null
  neededCents: number | null
  neededPer: 'pay' | 'month' | null
  behindCents: number | null
  projectedDate: string | null
  /** Save up to and debt goals not yet reached. */
  toGoCents: number | null
  /** Where a dated goal should be by now (0..1); on-track and behind goals only. */
  expectedProgress: number | null
  /** Buffers below their level. */
  belowCents: number | null
  /** Per pay or month. Debt goals: the Saver's rate plus `debtFallCents`. Null for buffers. */
  recentRateCents: number | null
  /** Debt goals: how much the debt fell per period lately (negative when it grew). */
  debtFallCents: number | null
  /** Set when the debt this goal followed was deleted, until the goal is next saved. */
  followedDebtName: string | null
  /** The local date the goal was first found reached; null for buffers, built-in goals and goals not yet reached. */
  reachedOn: string | null
  /** Reached now, with a `reachedOn` this viewer hasn't seen. */
  celebrate: boolean
  /** The other person's name on their own Saver; null on your own and on joint ones. */
  ownerName: string | null
  /** What the plan templates put into this Saver, in the goal's cadence; null when nothing visible is planned. */
  plan: {
    amountCents: number
    mineCents: number
    partnerCents: number | null
    partnerName: string | null
    partial: boolean
  } | null
  cadence: { kind: 'pay'; frequencyDays: number; lastPayDate: string } | { kind: 'month' } | null
  /** Debt goals: average money out of the Saver per recent period, positive. */
  saverOutCents: number | null
  /** Oldest first, one per point; null when fewer than 2 points. `target` is null on save goals; null entries are before the debt began. */
  sparkline: { balance: number[]; target: (number | null)[] | null } | null
  /** The server's local date, for pace maths in the browser. */
  today: string
  canEdit: boolean
  accountMissing: boolean
}

/** A goal the owner archived once reached. `targetCents` is what it was measured against. */
export interface ArchivedGoalDto {
  id: string
  accountId: string
  saverName: string
  name: string
  kind: GoalKind
  targetCents: number
  debtName: string | null
  debtPaidOff: boolean
  reachedOn: string
  canEdit: boolean
}

/** The goals list: each Saver's goal, and the archived ones, newest archived first. */
export interface GoalsDto {
  goals: GoalDto[]
  archived: ArchivedGoalDto[]
}

/** A debt a Saver's goal may follow; `followedBy` names another Saver that already follows it. */
export interface GoalDebtOptionDto {
  id: string
  name: string
  leftCents: number
  followedBy: string | null
}

export type NetWorthRange = '6m' | '1y' | 'all'

/** Goal sparklines also use a shorter 3-month range. */
export type GoalRange = '3m' | NetWorthRange

/** The goal page. Everything here needs finances on the Saver's owner; rows need `transactions`. */
export interface GoalDetailDto {
  goal: GoalDto
  range: GoalRange
  /** Oldest first. `targetCents` is flat, or the debt's balance on debt goals; null with no goal, or before the debt began. */
  points: { date: string; balanceCents: number; targetCents: number | null }[]
  /** Straight line from the goal's start to its date; dated, unreached goals. */
  expected: { from: { date: string; cents: number }; to: { date: string; cents: number } } | null
  /** Where this rate takes the Saver, and the debt on debt goals; status 'projected' only. */
  projected: { date: string; saverCents: number } | null
  debt: {
    id: string
    name: string
    leftCents: number
    startTargetCents: number
    fallCents: number
    nextDue: string | null
  } | null
  /** Newest first, months with transactions only. `fromIso` and `toIso` bound the whole local month, `[from, to)`. */
  months: { month: string; fromIso: string; toIso: string; inCents: number; outCents: number }[]
  transactionsHidden: boolean
}

export interface NetWorthPointDto {
  date: string
  upCents: number
  debtCents: number
  netCents: number
}

export interface NetWorthDto {
  points: NetWorthPointDto[]
  historyFrom: string | null
  todayCents: number
  changeCents: number
}

export type TransactionRepaymentDto = { debtId: string; debtName: string; canEdit: boolean } | null

export type PayFlowMode = 'actual' | 'planned'
export type PayFlowGroup = 'budget' | 'accounts'
/** Pay: one pay cycle. Month and year are calendar ones; FY is the Australian financial year (1 July). */
export type PayFlowRange = 'pay' | 'month' | 'year' | 'fy'

export interface PayFlowNodeDto {
  id: string
  kind: 'pay' | 'account' | 'outside-account' | 'line' | 'saver' | 'debt' | 'sink' | 'source'
  label: string
  caption: string | null
  amountCents: number
  colorToken: string
  href: string | null
  /** Actual · Accounts: what an in-scope account spent, shown on its box rather than as a box of its own. */
  spentCents?: number
  /** Actual · Accounts: interest an in-scope account earned, shown in its info box rather than as a line. */
  interestCents?: number
  /** Accounts views: money in starts on the left; Spending accounts and money out end on the right. */
  side?: 'in' | 'out'
}

export interface PayFlowEdgeDto {
  id: string
  from: string
  to: string
  amountCents: number
}

export interface PayFlowDto {
  state: 'ready' | 'needs-pay' | 'no-plan' | 'partner-not-connected' | 'private'
  cycle: { start: string; end: string | null; prevDate: string | null; nextDate: string | null; isCurrent: boolean } | null
  baseCents: number
  baseLabel: 'pay' | 'money in'
  overAllocatedCents: number | null
  nodes: PayFlowNodeDto[]
  edges: PayFlowEdgeDto[]
}

// Debt activity: interest settings, rates and the ledger

export type InterestCalc = 'daily' | 'on_charge'
export type InterestCharge = 'daily' | 'monthly' | 'yearly'

export type FeeFrequency = RepaymentFrequency | 'yearly'

/** A fixed account fee: charged on `from` and every period after, while something is owed. */
export interface DebtFeeDto {
  amountCents: number
  frequency: FeeFrequency
  from: string
}

export interface InterestSettingsDto {
  calc: InterestCalc
  charge: InterestCharge
  /** 1–31 when charged monthly. */
  chargeDay: number | null
  /** 'MM-DD' when charged yearly. */
  chargeDate: string | null
}

export interface DebtRateDto {
  id: string
  fromDate: string
  rateBp: number
}

export type DebtEntryKind = 'added' | 'payment'

/** What importing an ATO HELP statement would do. */
export interface HelpImportSummaryDto {
  rows: number
  /** The earliest effective date. */
  from: string
  /** The closing balance's date. */
  to: string
  added: { count: number; cents: number }
  credits: { count: number; cents: number }
  /** 1 June indexation charges above $0. */
  indexationYears: number
  /** The statement's closing balance. */
  closingCents: number
  /** Where the ledger lands on `to` from the import alone; equal to `closingCents` when the file was read right. */
  replayCents: number
  /** What the debt has now, all of which the import replaces. */
  replaces: { balances: number; rates: number; entries: number; edits: number }
}

/** A HECS debt added from an ATO HELP statement: its history is the statement's. */
export interface HelpDebtInputDto {
  name: string
  ownerUserId: string | null
  repaymentCents: number
  repaymentFrequency: RepaymentFrequency
  /** Used only when the statement has no indexation. */
  rateBp: number
  csv: string
}

export interface DebtEntryInputDto {
  kind: DebtEntryKind
  /** Not in the future. */
  date: string
  /** More than 0. */
  amountCents: number
  /** At most 100 characters. */
  note: string | null
}

interface ActivityBase {
  /** `interest:<chargeDate>`, `repayment:<transactionId>`, `entry:<id>`, `check:<id>`, `rate:<id>` or `assumed:<date>`. */
  key: string
  date: string
  /** Positive raises the debt. */
  amountCents: number
  balanceAfterCents: number
}

export type DebtActivityDto = ActivityBase &
  (
    | {
        kind: 'interest'
        chargeDate: string
        periodStart: string
        periodEnd: string
        calculatedCents: number
        edited: boolean
      }
    | { kind: 'repayment'; transactionId: string; description: string; oneOff: boolean }
    | { kind: 'assumed' }
    | { kind: 'fee' }
    | { kind: 'added' | 'payment'; entryId: string; note: string | null }
    | { kind: 'check'; balanceId: string; correctionCents: number | null }
    | { kind: 'rate'; rateId: string; rateBp: number }
  )
