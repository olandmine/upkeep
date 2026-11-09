import { infiniteQueryOptions, keepPreviousData, queryOptions, type QueryClient } from '@tanstack/react-query'
import type {
  AccountDto,
  BudgetDto,
  BudgetPeriodDto,
  CategoryDto,
  DebtBalancePoint,
  DebtDetailDto,
  DebtRange,
  DebtDto,
  GettingStartedDto,
  GoalDebtOptionDto,
  GoalDetailDto,
  GoalsDto,
  GoalRange,
  NetWorthDto,
  NetWorthRange,
  OverviewDto,
  PayEventDto,
  PayFlowDto,
  PayFlowGroup,
  PayFlowMode,
  PayFlowRange,
  PayoffPlanDto,
  PayPlanDto,
  PayScheduleDto,
  PlanTemplateDto,
  Scope,
  SpendingHistoryDto,
  StandardPayDto,
  SyncStatusDto,
  TransactionPage,
  TransactionRepaymentDto,
  TxFilters,
  UserDto,
} from '../../shared/types'
import { ApiError, client, unwrap } from './api'

/**
 * The first requests run in route guards (fetchQuery, which doesn't retry by default). If the API
 * is still starting or briefly unreachable, keep trying for a few seconds instead of dead-ending;
 * a real answer like 401 is final.
 */
const retryTransient = {
  retry: (count: number, err: Error) => !(err instanceof ApiError && err.status < 500) && count < 5,
  retryDelay: (attempt: number) => Math.min(500 * 2 ** attempt, 4_000),
}

export const setupStatusQuery = queryOptions({
  queryKey: ['setup-status'],
  queryFn: () => unwrap<{ needsSetup: boolean }>(client.api.setup.status.$get()),
  staleTime: Infinity,
  ...retryTransient,
})

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => unwrap<UserDto>(client.api.me.$get()),
  staleTime: 5 * 60_000,
  ...retryTransient,
})

export const usersQuery = queryOptions({
  queryKey: ['users'],
  queryFn: () => unwrap<UserDto[]>(client.api.users.$get()),
  staleTime: 5 * 60_000,
})

export const syncStatusQuery = queryOptions({
  queryKey: ['sync-status'],
  queryFn: () => unwrap<SyncStatusDto>(client.api.sync.status.$get()),
  refetchInterval: (q) => (q.state.data?.connections.some((c) => c.running) ? 2_000 : 10_000),
})

export const gettingStartedQuery = queryOptions({
  queryKey: ['getting-started'],
  queryFn: () => unwrap<GettingStartedDto>(client.api['getting-started'].$get()),
  staleTime: 0,
  refetchInterval: (q) => (q.state.data?.show ? 10_000 : false),
})

export const categoriesQuery = queryOptions({
  queryKey: ['categories'],
  queryFn: () => unwrap<CategoryDto[]>(client.api.categories.$get()),
  staleTime: 10 * 60_000,
})

export const tagsQuery = queryOptions({
  queryKey: ['tags'],
  queryFn: () => unwrap<string[]>(client.api.tags.$get()),
})

export const accountsQuery = (scope: Scope) =>
  queryOptions({
    queryKey: ['accounts', scope],
    queryFn: () => unwrap<AccountDto[]>(client.api.accounts.$get({ query: { scope } })),
  })

export const accountQuery = (id: string) =>
  queryOptions({
    queryKey: ['account', id],
    queryFn: () => unwrap<AccountDto>(client.api.accounts[':id'].$get({ param: { id } })),
  })

/** TxFilters → query-string values (numbers and booleans as strings, undefined dropped). */
export function toQueryParams(f: TxFilters): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') out[k] = String(v)
  return out
}

export const transactionsQuery = (filters: TxFilters) =>
  infiniteQueryOptions({
    queryKey: ['transactions', filters],
    queryFn: ({ pageParam }) =>
      unwrap<TransactionPage>(
        client.api.transactions.$get({ query: { ...toQueryParams(filters), ...(pageParam ? { cursor: pageParam } : {}) } }),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

export const overviewQuery = (month: string | undefined, scope: Scope) =>
  queryOptions({
    queryKey: ['overview', month ?? 'current', scope],
    queryFn: () => unwrap<OverviewDto>(client.api.overview.$get({ query: { scope, ...(month ? { month } : {}) } })),
  })

export const budgetsQuery = queryOptions({
  queryKey: ['budgets'],
  queryFn: () => unwrap<BudgetDto[]>(client.api.budgets.$get()),
})

/** The period containing `date` (default: today). 404 means the budget has no pay periods yet. */
export const budgetPeriodQuery = (budgetId: string, date?: string) =>
  queryOptions({
    queryKey: ['budget-period', budgetId, date ?? 'current'],
    queryFn: () =>
      unwrap<BudgetPeriodDto>(
        client.api.budgets[':id'].period.$get({ param: { id: budgetId }, query: date ? { date } : {} }),
      ),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  })

export const payPlanQuery = (userId: string, payDate: string) =>
  queryOptions({
    queryKey: ['pay-plan', userId, payDate],
    queryFn: () => unwrap<PayPlanDto>(client.api.plans[':userId'][':payDate'].$get({ param: { userId, payDate } })),
  })

/** What a normal pay usually leaves; null until there is a plan and a finished pay to base it on. */
export const standardPayQuery = (userId: string) =>
  queryOptions({
    queryKey: ['standard-pay', userId],
    queryFn: () => unwrap<StandardPayDto | null>(client.api.budgets['standard-pay'][':userId'].$get({ param: { userId } })),
  })

/** Recent spending on your own budget or Joint. 404 means it has no pay periods yet. */
export const spendingHistoryQuery = (budgetId: string) =>
  queryOptions({
    queryKey: ['spending-history', budgetId],
    queryFn: () =>
      unwrap<SpendingHistoryDto>(client.api.budgets[':id']['spending-history'].$get({ param: { id: budgetId } })),
  })

export const planTemplateQuery = queryOptions({
  queryKey: ['plan-template'],
  queryFn: () => unwrap<PlanTemplateDto | null>(client.api['plan-template'].$get()),
})

export const payScheduleQuery = queryOptions({
  queryKey: ['pay-schedule'],
  queryFn: () => unwrap<PayScheduleDto | null>(client.api['pay-schedule'].$get()),
})

export const payEventsQuery = (userId: string) =>
  queryOptions({
    queryKey: ['pay-events', userId],
    queryFn: () => unwrap<PayEventDto[]>(client.api['pay-events'].$get({ query: { userId } })),
  })

/** After a transaction edit (e.g. its category): its Budget row and every budget figure may change. */
export function invalidateAfterTransactionEdit(queryClient: QueryClient, transactionId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['budget-line', transactionId] }),
    queryClient.invalidateQueries({ queryKey: ['budget-period'] }),
    queryClient.invalidateQueries({ queryKey: ['standard-pay'] }),
  ])
}

// Goals & debts

export const debtsQuery = (scope: Scope) =>
  queryOptions({
    queryKey: ['debts', scope],
    queryFn: () => unwrap<DebtDto[]>(client.api.debts.$get({ query: { scope } })),
  })

export const debtsTimelineQuery = (scope: Scope, range: DebtRange) =>
  queryOptions({
    // Under 'debts', so invalidateAfterDebtEdit refreshes it.
    queryKey: ['debts', scope, 'timeline', range],
    queryFn: () => unwrap<DebtBalancePoint[]>(client.api.debts.timeline.$get({ query: { scope, range } })),
    // The last range stays on screen, with its buttons, until the next one arrives.
    placeholderData: keepPreviousData,
  })

export const debtQuery = (id: string) =>
  queryOptions({
    queryKey: ['debt', id],
    queryFn: () => unwrap<DebtDetailDto>(client.api.debts[':id'].$get({ param: { id } })),
  })

export const payoffPlanQuery = (scope: Scope) =>
  queryOptions({
    queryKey: ['payoff-plan', scope],
    queryFn: () => unwrap<PayoffPlanDto>(client.api['payoff-plan'].$get({ query: { scope } })),
  })

export const goalsQuery = (scope: Scope) =>
  queryOptions({
    queryKey: ['goals', scope],
    queryFn: () => unwrap<GoalsDto>(client.api.goals.$get({ query: { scope } })),
  })

/** Under ['goals'], so whatever refreshes the goals list refreshes the goal page too. */
export const goalDetailQuery = (accountId: string, range: GoalRange) =>
  queryOptions({
    queryKey: ['goals', 'detail', accountId, range],
    queryFn: () =>
      unwrap<GoalDetailDto>(client.api.goals[':accountId'].$get({ param: { accountId }, query: { range } })),
  })

export const goalDebtsQuery = (accountId: string) =>
  queryOptions({
    queryKey: ['goal-debts', accountId],
    queryFn: () =>
      unwrap<GoalDebtOptionDto[]>(client.api.goals[':accountId'].debts.$get({ param: { accountId } })),
  })

export const netWorthQuery = (scope: Scope, range: NetWorthRange) =>
  queryOptions({
    queryKey: ['net-worth', scope, range],
    queryFn: () => unwrap<NetWorthDto>(client.api['net-worth'].$get({ query: { scope, range } })),
  })

export const transactionRepaymentQuery = (id: string) =>
  queryOptions({
    queryKey: ['transaction-repayment', id],
    queryFn: () =>
      unwrap<TransactionRepaymentDto>(client.api.transactions[':id'].repayment.$get({ param: { id } })),
  })

/** Anything that changes a debt's balance moves the plan, net worth and the drawer's Repayment row too. */
export function invalidateAfterDebtEdit(queryClient: QueryClient) {
  return Promise.all(
    ['debts', 'debt', 'payoff-plan', 'net-worth', 'transaction-repayment', 'goals'].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  )
}

// Visuals

/** The pay flow for the cycle containing `date` (default: today). */
export const payFlowQuery = (
  scope: Scope,
  mode: PayFlowMode,
  group: PayFlowGroup,
  date?: string,
  range: PayFlowRange = 'pay',
) =>
  queryOptions({
    queryKey: ['pay-flow', scope, mode, group, range, date ?? 'today'],
    queryFn: () =>
      unwrap<PayFlowDto>(
        client.api['pay-flow'].$get({
          query: { scope, mode, group, ...(range !== 'pay' ? { range } : {}), ...(date ? { date } : {}) },
        }),
      ),
  })

/** Saved box positions for one view, keyed `{scope}:{mode}:{group}`; `{}` when none is saved. */
export const flowLayoutQuery = (key: string) =>
  queryOptions({
    queryKey: ['flow-layout', key],
    queryFn: () =>
      unwrap<{ positions: Record<string, { x: number; y: number }> }>(
        client.api['flow-layouts'][':key'].$get({ param: { key } }),
      ),
  })
