import { eq } from 'drizzle-orm'
import type { PayoffPlanDto, Scope } from '../../shared/types'
import type { LocalDate } from '../budgets/dates'
import { BudgetError } from '../budgets/errors'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { canSee, partnerOf } from '../sharing/policy'
import { debtsInScope, settingsOf, toDebtDto } from './debts'
import { payoffDifferences, simulatePayoff, type PayoffDebt } from './payoff'
import { monthlyEquivalent } from './schedule'

/** Settings key per scope: 'everyone', 'joint' or 'user:<id>' (Mine and the partner's share one row per person). */
export function payoffScopeKey(scope: Scope, viewerId: string, partnerId: string | null): string {
  if (scope === 'me') return `user:${viewerId}`
  if (scope === 'partner') return `user:${partnerId ?? 'none'}`
  return scope
}

function settingsFor(db: Db, key: string) {
  return (
    db.select().from(s.payoffSettings).where(eq(s.payoffSettings.scope, key)).get() ?? {
      scope: key,
      extraCents: 0,
      includeHecs: false,
    }
  )
}

const nextMonth = (today: LocalDate) => {
  const [y, m] = today.split('-').map(Number) as [number, number]
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export function getPayoffPlan(
  db: Db,
  scope: Scope,
  viewerId: string,
  today: LocalDate,
  tz: string,
): PayoffPlanDto {
  const partner = partnerOf(db, viewerId)
  // Their stored plan is their finances: without access it reads as the defaults.
  const settings =
    scope === 'partner' && partner && !canSee(db, viewerId, partner.id, 'finances')
      ? { scope: 'hidden', extraCents: 0, includeHecs: false }
      : settingsFor(db, payoffScopeKey(scope, viewerId, partner?.id ?? null))
  const debts: PayoffDebt[] = debtsInScope(db, scope, viewerId)
    .filter((d) => settings.includeHecs || d.kind !== 'hecs')
    .map((d) => ({ row: d, dto: toDebtDto(db, d, viewerId, today, tz) }))
    .filter(({ dto }) => dto.balanceCents > 0)
    .map(({ row, dto }) => ({
      id: row.id,
      name: row.name,
      interest: settingsOf(row),
      rateBp: dto.rateBp,
      balanceCents: dto.balanceCents,
      monthlyCents: monthlyEquivalent(row.repaymentCents, row.repaymentFrequency),
      feeMonthlyCents: dto.fee ? monthlyEquivalent(dto.fee.amountCents, dto.fee.frequency) : 0,
    }))
  const start = nextMonth(today)
  const scenarios = (['as-is', 'avalanche', 'snowball'] as const).map((strategy) =>
    simulatePayoff(debts, settings.extraCents, strategy, start),
  )
  return {
    extraCents: settings.extraCents,
    includeHecs: settings.includeHecs,
    canEdit: scope !== 'partner',
    scenarios,
    differences: payoffDifferences(scenarios, debts),
  }
}

export function putPayoffSettings(
  db: Db,
  scope: Scope,
  viewerId: string,
  body: { extraCents: number; includeHecs: boolean },
): void {
  const partner = partnerOf(db, viewerId)
  if (scope === 'partner')
    throw new BudgetError(403, `Only ${partner?.name ?? 'your partner'} can edit that.`)
  const key = payoffScopeKey(scope, viewerId, partner?.id ?? null)
  db.insert(s.payoffSettings)
    .values({ scope: key, ...body })
    .onConflictDoUpdate({ target: s.payoffSettings.scope, set: body })
    .run()
}
