export type PlanState = 'ready' | 'loading' | 'error'

/**
 * What the pay page shows for the plan's query state. A refetch that fails keeps the data it had (TanStack Query v5
 * sets `isError` but leaves `data`), so the error replaces the page only when there is nothing to show.
 */
export function planStateOf(plan: { isLoading: boolean; isError: boolean; hasData: boolean }, jointLoading: boolean): PlanState {
  if (plan.isLoading || jointLoading) return 'loading'
  if (plan.isError && !plan.hasData) return 'error'
  return 'ready'
}
