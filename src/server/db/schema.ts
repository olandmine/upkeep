import { ACCENTS } from '../../shared/accent'
import { SHARING_LEVELS } from '../../shared/sharing'
import { foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Money: integer cents. Timestamps: UTC ISO-8601 strings. Up rows keep raw_json.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  upDisplayName: text('up_display_name'),
  negativeStyle: text('negative_style', { enum: ['minus', 'parentheses'] }).notNull().default('minus'),
  accent: text('accent', { enum: ACCENTS }).notNull().default('amber'),
  sharingLevel: text('sharing_level', { enum: SHARING_LEVELS }),
  connectUpAnswered: integer('connect_up_answered', { mode: 'boolean' }).notNull().default(false),
  upHandleLeftBlank: integer('up_handle_left_blank', { mode: 'boolean' }).notNull().default(false),
  givenPassword: text('given_password', { enum: ['kept', 'changed'] }),
  gettingStartedHidden: integer('getting_started_hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // sha256 of the cookie token
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})

export const upConnections = sqliteTable('up_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenCiphertext: text('token_ciphertext').notNull(),
  status: text('status', { enum: ['ok', 'unauthorized', 'error'] }).notNull(),
  lastError: text('last_error'),
  lastSyncedAt: text('last_synced_at'),
  backfillCompletedAt: text('backfill_completed_at'),
  /** Start time of the last run that walked every transaction up to "now": the incremental resumes from here. */
  syncedThrough: text('synced_through'),
  lastReconciledAt: text('last_reconciled_at'),
  createdAt: text('created_at').notNull(),
})

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(), // Up account id
  displayName: text('display_name').notNull(),
  accountType: text('account_type').notNull(), // TRANSACTIONAL | SAVER | HOME_LOAN
  ownership: text('ownership').notNull(), // INDIVIDUAL | JOINT
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  balanceCents: integer('balance_cents').notNull(),
  currency: text('currency').notNull(),
  colorIndex: integer('color_index').notNull(),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  upCreatedAt: text('up_created_at').notNull(),
  rawJson: text('raw_json').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const accountConnections = sqliteTable(
  'account_connections',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => upConnections.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.connectionId] })],
)

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(), // Up transaction id
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    status: text('status', { enum: ['HELD', 'SETTLED'] }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    foreignAmountCents: integer('foreign_amount_cents'),
    foreignCurrency: text('foreign_currency'),
    description: text('description').notNull(),
    message: text('message'),
    rawText: text('raw_text'),
    categoryId: text('category_id'),
    parentCategoryId: text('parent_category_id'),
    isCategorizable: integer('is_categorizable', { mode: 'boolean' }).notNull(),
    roundUpCents: integer('round_up_cents'),
    cashbackCents: integer('cashback_cents'),
    cardMethod: text('card_method'),
    cardSuffix: text('card_suffix'),
    transferAccountId: text('transfer_account_id'),
    isTransfer: integer('is_transfer', { mode: 'boolean' }).notNull(),
    performingCustomer: text('performing_customer'),
    performedByUserId: text('performed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Up's attributes.transactionType: "Purchase", "Transfer", "Round Up"...; null while HELD. */
    transactionType: text('transaction_type'),
    createdAt: text('created_at').notNull(),
    settledAt: text('settled_at'),
    deletedAt: text('deleted_at'),
    rawJson: text('raw_json').notNull(),
    syncedAt: text('synced_at').notNull(),
  },
  (t) => [
    index('transactions_account_created_idx').on(t.accountId, t.createdAt),
    index('transactions_created_id_idx').on(t.createdAt, t.id),
    index('transactions_category_idx').on(t.categoryId),
    index('transactions_status_idx').on(t.status),
  ],
)

export const transactionTags = sqliteTable(
  'transaction_tags',
  {
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.label] })],
)

export const tags = sqliteTable('tags', {
  label: text('label').primaryKey(),
})

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(), // Up category slug
  name: text('name').notNull(),
  parentId: text('parent_id'),
})

export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => upConnections.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['connect', 'backfill', 'incremental', 'reconcile', 'manual'] }).notNull(),
    status: text('status', { enum: ['running', 'ok', 'failed'] }).notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    transactionsUpserted: integer('transactions_upserted').notNull().default(0),
    transactionsDeleted: integer('transactions_deleted').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('sync_runs_connection_started_idx').on(t.connectionId, t.startedAt)],
)

// Budgets & planning. Local dates (pay dates, period starts) are YYYY-MM-DD text in the configured TZ.

export const paySchedules = sqliteTable('pay_schedules', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  descriptionMatch: text('description_match').notNull(),
  minAmountCents: integer('min_amount_cents').notNull(),
  frequencyDays: integer('frequency_days').notNull().default(14),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const payExclusions = sqliteTable(
  'pay_exclusions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionId: text('transaction_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.transactionId] })],
)

export const payEvents = sqliteTable(
  'pay_events',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    payDate: text('pay_date').notNull(),
    source: text('source', { enum: ['detected', 'scheduled'] }).notNull(),
    transactionId: text('transaction_id'),
    amountCents: integer('amount_cents'),
    /** JSON array of extra-income transaction ids in this pay's period. */
    extraTxIdsJson: text('extra_tx_ids_json').notNull().default('[]'),
    derivedAt: text('derived_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.payDate] })],
)

export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['personal', 'joint'] }).notNull(),
  ownerUserId: text('owner_user_id')
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  anchorUserId: text('anchor_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
})

export const budgetAnchorChanges = sqliteTable(
  'budget_anchor_changes',
  {
    budgetId: text('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    effectiveDate: text('effective_date').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.budgetId, t.effectiveDate] })],
)

export const budgetLines = sqliteTable(
  'budget_lines',
  {
    id: text('id').primaryKey(),
    budgetId: text('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['spending', 'fund'] }).notNull(),
    name: text('name').notNull(),
    amountCents: integer('amount_cents').notNull(),
    saverAccountId: text('saver_account_id'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('budget_lines_budget_idx').on(t.budgetId)],
)

export const budgetLineCategories = sqliteTable(
  'budget_line_categories',
  {
    lineId: text('line_id')
      .notNull()
      .references(() => budgetLines.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.lineId, t.categoryId] })],
)

export const periodLines = sqliteTable(
  'period_lines',
  {
    budgetId: text('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    periodStart: text('period_start').notNull(),
    lineId: text('line_id')
      .notNull()
      .references(() => budgetLines.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [primaryKey({ columns: [t.budgetId, t.periodStart, t.lineId] })],
)

/** The categories each snapshot line had, so past periods keep counting what they counted then. */
export const periodLineCategories = sqliteTable(
  'period_line_categories',
  {
    budgetId: text('budget_id').notNull(),
    periodStart: text('period_start').notNull(),
    lineId: text('line_id').notNull(),
    categoryId: text('category_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.budgetId, t.periodStart, t.lineId, t.categoryId] }),
    foreignKey({
      columns: [t.budgetId, t.periodStart, t.lineId],
      foreignColumns: [periodLines.budgetId, periodLines.periodStart, periodLines.lineId],
    }).onDelete('cascade'),
  ],
)

export const planTemplates = sqliteTable('plan_templates', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  expectedIncomeCents: integer('expected_income_cents').notNull(),
})

export const planTemplateItems = sqliteTable('plan_template_items', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  targetKind: text('target_kind', { enum: ['line', 'saver', 'buffer'] }).notNull(),
  lineId: text('line_id').references(() => budgetLines.id, { onDelete: 'cascade' }),
  saverAccountId: text('saver_account_id'),
  amountCents: integer('amount_cents').notNull(),
  sortOrder: integer('sort_order').notNull(),
})

export const payPlans = sqliteTable(
  'pay_plans',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    payDate: text('pay_date').notNull(),
    customised: integer('customised', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.payDate] })],
)

export const payPlanItems = sqliteTable(
  'pay_plan_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    payDate: text('pay_date').notNull(),
    targetKind: text('target_kind', { enum: ['line', 'saver', 'buffer'] }).notNull(),
    lineId: text('line_id').references(() => budgetLines.id, { onDelete: 'cascade' }),
    saverAccountId: text('saver_account_id'),
    amountCents: integer('amount_cents').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [index('pay_plan_items_plan_idx').on(t.userId, t.payDate)],
)

// Debts outside Up, payoff settings and Saver goals. Only what the user enters; balances are calculated.

export const debts = sqliteTable(
  'debts',
  {
    id: text('id').primaryKey(),
    /** Null = Joint. */
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['loan', 'credit_card', 'bnpl', 'ato', 'hecs'] }).notNull(),
    name: text('name').notNull(),
    /** How interest is worked out: built up daily, or on the balance when it's charged. */
    interestCalc: text('interest_calc', { enum: ['daily', 'on_charge'] }).notNull().default('on_charge'),
    interestCharge: text('interest_charge', { enum: ['daily', 'monthly', 'yearly'] }).notNull().default('monthly'),
    /** 1–31 when charged monthly; 29–31 clamp to the month's last day. */
    interestChargeDay: integer('interest_charge_day'),
    /** 'MM-DD' when charged yearly. */
    interestChargeDate: text('interest_charge_date'),
    repaymentCents: integer('repayment_cents').notNull(),
    repaymentFrequency: text('repayment_frequency', { enum: ['weekly', 'fortnightly', 'monthly'] }).notNull(),
    /** Through this date an imported statement is the whole history: no assumed or Up repayments. */
    historyThrough: text('history_through'),
    /** The account fee; none when null. */
    feeCents: integer('fee_cents'),
    feeFrequency: text('fee_frequency', { enum: ['weekly', 'fortnightly', 'monthly', 'yearly'] }),
    feeFrom: text('fee_from'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
)

export const debtBalances = sqliteTable(
  'debt_balances',
  {
    id: text('id').primaryKey(),
    debtId: text('debt_id')
      .notNull()
      .references(() => debts.id, { onDelete: 'cascade' }),
    asOf: text('as_of').notNull(),
    balanceCents: integer('balance_cents').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('debt_balances_debt_as_of_idx').on(t.debtId, t.asOf)],
)

/** Descriptions that mark a debt's repayments: each one belongs to one debt. */
export const debtRepaymentRules = sqliteTable(
  'debt_repayment_rules',
  {
    id: text('id').primaryKey(),
    debtId: text('debt_id')
      .notNull()
      .references(() => debts.id, { onDelete: 'cascade' }),
    /** Normalised description. */
    match: text('match').notNull(),
  },
  (t) => [uniqueIndex('debt_repayment_rules_match_idx').on(t.match)],
)

/** Who has agreed to a rule by marking their own transaction under it: on a joint debt, its reach into their personal accounts. */
export const debtRepaymentRulePeople = sqliteTable(
  'debt_repayment_rule_people',
  {
    ruleId: text('rule_id')
      .notNull()
      .references(() => debtRepaymentRules.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.userId] })],
)

/** Single transactions marked as a repayment without a rule: each counts toward one debt. */
export const debtRepaymentLinks = sqliteTable('debt_repayment_links', {
  transactionId: text('transaction_id').primaryKey(),
  debtId: text('debt_id')
    .notNull()
    .references(() => debts.id, { onDelete: 'cascade' }),
})

export const debtRepaymentExclusions = sqliteTable(
  'debt_repayment_exclusions',
  {
    debtId: text('debt_id')
      .notNull()
      .references(() => debts.id, { onDelete: 'cascade' }),
    transactionId: text('transaction_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.debtId, t.transactionId] })],
)

/** A debt's yearly rate (or HECS indexation) from a date, in basis points: 6.49% = 649. */
export const debtRates = sqliteTable(
  'debt_rates',
  {
    id: text('id').primaryKey(),
    debtId: text('debt_id')
      .notNull()
      .references(() => debts.id, { onDelete: 'cascade' }),
    fromDate: text('from_date').notNull(),
    rateBp: integer('rate_bp').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('debt_rates_debt_from_idx').on(t.debtId, t.fromDate)],
)

/** Added to debt (raises the balance) or a payment made outside Up (lowers it). */
export const debtEntries = sqliteTable(
  'debt_entries',
  {
    id: text('id').primaryKey(),
    debtId: text('debt_id')
      .notNull()
      .references(() => debts.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['added', 'payment'] }).notNull(),
    date: text('date').notNull(),
    amountCents: integer('amount_cents').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('debt_entries_debt_date_idx').on(t.debtId, t.date)],
)

/** An interest charge set to what the lender charged; for daily charging, keyed by the month's last day. */
export const debtInterestEdits = sqliteTable(
  'debt_interest_edits',
  {
    debtId: text('debt_id')
      .notNull()
      .references(() => debts.id, { onDelete: 'cascade' }),
    chargeDate: text('charge_date').notNull(),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [primaryKey({ columns: [t.debtId, t.chargeDate] })],
)

export const payoffSettings = sqliteTable('payoff_settings', {
  /** 'everyone' | 'joint' | 'user:<id>' */
  scope: text('scope').primaryKey(),
  extraCents: integer('extra_cents').notNull().default(0),
  includeHecs: integer('include_hecs', { mode: 'boolean' }).notNull().default(false),
})

/** Where one person dragged the pay-flow boxes; key is '<scope>:<actual|planned>:<budget|accounts>'. */
export const flowLayouts = sqliteTable(
  'flow_layouts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    /** JSON of box id to { x, y }. */
    positionsJson: text('positions_json').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
)

export const goals = sqliteTable(
  'goals',
  {
    /** No FK: a goal outlives a Saver that disappears, and shows "Saver not found". */
    accountId: text('account_id').primaryKey(),
    name: text('name').notNull(),
    targetCents: integer('target_cents').notNull(),
    targetDate: text('target_date'),
    /** save: grow a Saver to the target; buffer: keep a Saver above it; debt: pay a debt down to zero. */
    kind: text('kind', { enum: ['save', 'buffer', 'debt'] })
      .notNull()
      .default('save'),
    /** The debt a debt goal follows. No onDelete: deleteDebt converts the goals that follow the debt (to plain save goals) before removing it. */
    debtId: text('debt_id').references(() => debts.id),
    /** The balance the goal started from. */
    startCents: integer('start_cents').notNull().default(0),
    startedAt: text('started_at').notNull().default(''),
    startTargetCents: integer('start_target_cents'),
    followedDebtName: text('followed_debt_name'),
    /** The local date the goal was first found reached. A save that resets the start clears it; a later dip doesn't. */
    reachedOn: text('reached_on'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('goals_debt_idx').on(t.debtId)],
)

/** Which reached date each person has seen the celebration for. No FK on the account, as for `goals`. */
export const goalCelebrationsSeen = sqliteTable(
  'goal_celebrations_seen',
  {
    accountId: text('account_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reachedOn: text('reached_on').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.userId] })],
)

/** Goals the user archived once reached. Kept apart from `goals`, so its Saver is free for a new goal. */
export const archivedGoals = sqliteTable('archived_goals', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  /** Null for a joint Saver's goal. */
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  saverName: text('saver_name').notNull(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['save', 'buffer', 'debt'] }).notNull(),
  targetCents: integer('target_cents').notNull(),
  debtName: text('debt_name'),
  debtPaidOff: integer('debt_paid_off', { mode: 'boolean' }).notNull().default(false),
  reachedOn: text('reached_on').notNull(),
  archivedAt: text('archived_at').notNull(),
})

export type UserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert
export type SessionRow = typeof sessions.$inferSelect
export type ConnectionRow = typeof upConnections.$inferSelect
export type NewConnectionRow = typeof upConnections.$inferInsert
export type AccountRow = typeof accounts.$inferSelect
export type NewAccountRow = typeof accounts.$inferInsert
export type TransactionRow = typeof transactions.$inferSelect
export type NewTransactionRow = typeof transactions.$inferInsert
export type CategoryRow = typeof categories.$inferSelect
export type SyncRunRow = typeof syncRuns.$inferSelect
export type PayScheduleRow = typeof paySchedules.$inferSelect
export type PayEventRow = typeof payEvents.$inferSelect
export type BudgetRow = typeof budgets.$inferSelect
export type BudgetLineRow = typeof budgetLines.$inferSelect
export type DebtRow = typeof debts.$inferSelect
export type DebtBalanceRow = typeof debtBalances.$inferSelect
export type GoalRow = typeof goals.$inferSelect
export type ArchivedGoalRow = typeof archivedGoals.$inferSelect
