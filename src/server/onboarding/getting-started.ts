import { and, eq, isNull, or } from 'drizzle-orm'
import type { GettingStartedDto, GettingStartedItemDto } from '../../shared/types'
import { ensureBudgets, listBudgetRows, usersInOrder } from '../budgets/budgets'
import { budgetSetup } from '../budgets/setup'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { UserRow } from '../db/schema'
import { getConnectionByUser } from '../sync/connections'

export interface GettingStartedFacts {
  hidden: boolean
  connected: boolean
  historyImported: boolean
  givenPassword: 'kept' | 'changed' | null
  handleLeftBlank: boolean
  hasHandle: boolean
  isFirstUser: boolean
  hasSecondLogin: boolean
  budgetPlanned: boolean
  hasJointAccount: boolean
  jointBudgetPlanned: boolean
  hasDebt: boolean
  hasGoal: boolean
}

/** The checklist for one person: who sees each row, when it's done, and when it's locked. */
export function gettingStarted(f: GettingStartedFacts): GettingStartedDto {
  const row = (
    key: GettingStartedItemDto['key'],
    done: boolean,
    locked = false,
    optional = false,
  ): GettingStartedItemDto => ({ key, state: done ? 'done' : locked ? 'locked' : 'open', optional })
  const needsHistory = !f.historyImported

  const items: GettingStartedItemDto[] = [row('connect-up', f.connected)]
  if (f.givenPassword) items.push(row('password', f.givenPassword === 'changed'))
  if (f.handleLeftBlank) items.push(row('handle', f.hasHandle))
  if (f.isFirstUser) items.push(row('partner', f.hasSecondLogin))
  items.push(row('budget', f.budgetPlanned, needsHistory))
  if (f.hasJointAccount) items.push(row('joint-budget', f.jointBudgetPlanned, needsHistory))
  items.push(row('debt', f.hasDebt, false, true))
  items.push(row('goal', f.hasGoal, needsHistory, true))

  return { show: !f.hidden && items.some((i) => !i.optional && i.state !== 'done'), items }
}

/** Reads only the viewer's own and joint data: nothing about the partner's personal money. */
export function gatherFacts(db: Db, user: UserRow): GettingStartedFacts {
  ensureBudgets(db, new Date())
  const connection = getConnectionByUser(db, user.id)
  const users = usersInOrder(db)
  const budgets = listBudgetRows(db)
  const personal = budgets.find((b) => b.kind === 'personal' && b.ownerUserId === user.id)
  const joint = budgets.find((b) => b.kind === 'joint')

  const hasBucket = (budgetId: string) =>
    Boolean(
      db
        .select({ id: s.budgetLines.id })
        .from(s.budgetLines)
        .where(and(eq(s.budgetLines.budgetId, budgetId), isNull(s.budgetLines.archivedAt)))
        .get(),
    )
  const hasSavedPlan = Boolean(
    db
      .select({ id: s.planTemplateItems.id })
      .from(s.planTemplateItems)
      .where(eq(s.planTemplateItems.userId, user.id))
      .get(),
  )
  const hasJointAccount = Boolean(
    db
      .select({ id: s.accounts.id })
      .from(s.accounts)
      .where(and(eq(s.accounts.ownership, 'JOINT'), eq(s.accounts.hidden, false)))
      .get(),
  )
  const hasDebt = Boolean(
    db
      .select({ id: s.debts.id })
      .from(s.debts)
      .where(or(eq(s.debts.ownerUserId, user.id), isNull(s.debts.ownerUserId)))
      .get(),
  )
  const liveGoal = db
    .select({ accountId: s.goals.accountId })
    .from(s.goals)
    .innerJoin(s.accounts, eq(s.accounts.id, s.goals.accountId))
    .where(or(eq(s.accounts.ownerUserId, user.id), eq(s.accounts.ownership, 'JOINT')))
    .get()
  const archivedGoal = db
    .select({ id: s.archivedGoals.id })
    .from(s.archivedGoals)
    .where(or(eq(s.archivedGoals.ownerUserId, user.id), isNull(s.archivedGoals.ownerUserId)))
    .get()

  return {
    hidden: user.gettingStartedHidden,
    connected: Boolean(connection),
    historyImported: Boolean(connection?.backfillCompletedAt),
    givenPassword: user.givenPassword,
    handleLeftBlank: user.upHandleLeftBlank,
    hasHandle: Boolean(user.upDisplayName?.trim()),
    isFirstUser: users[0]?.id === user.id,
    hasSecondLogin: users.length > 1,
    budgetPlanned: personal ? budgetSetup(db, personal) === 'ready' && (hasBucket(personal.id) || hasSavedPlan) : false,
    hasJointAccount,
    jointBudgetPlanned: joint ? budgetSetup(db, joint) === 'ready' && hasBucket(joint.id) : false,
    hasDebt,
    hasGoal: Boolean(liveGoal ?? archivedGoal),
  }
}
