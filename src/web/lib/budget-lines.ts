import type { BudgetDto, BudgetPeriodDto } from '../../shared/types'

/** Template edits land on the current period, so only it offers Edit. */
export function canEditPeriod(budget: BudgetDto | undefined, period: BudgetPeriodDto | undefined): boolean {
  return Boolean(budget?.canEdit && budget.setup === 'ready' && period?.isCurrent)
}

/** Standard pay is the every-pay plan, so it needs no current period to offer Edit. */
export function canEditStandard(budget: BudgetDto | undefined): boolean {
  return Boolean(budget?.canEdit && budget.setup === 'ready')
}
