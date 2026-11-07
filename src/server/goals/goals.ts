import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sum, type SQL } from 'drizzle-orm'
import type { ArchivedGoalDto, GoalDebtOptionDto, GoalDto, GoalKind, GoalsDto, Scope } from '../../shared/types'
import { listBudgetRows, budgetPayEvents } from '../budgets/budgets'
import { addMonthsClamped, localDate, periodRangeUtc, type LocalDate } from '../budgets/dates'
import { BudgetError } from '../budgets/errors'
import { getSchedule, listPayEvents } from '../budgets/pay-schedule'
import { getTemplate } from '../budgets/plans'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { AccountRow, DebtRow, GoalRow } from '../db/schema'
import { scopeAccountIds } from '../queries/scope'
import { canSee, canSeeAccount, partnerOf } from '../sharing/policy'
import { debtFall, debtLeft } from './debt-goal'
import { goalSparkline } from './history'
import { bufferStatus, expectedProgress, goalStatus, type Cadence } from '../../shared/goals/pace'

const RECENT_PERIODS = 3

/** The cadence plus the paydays it was built from, which the recent-rate periods need. */
export type RecentCadence = { kind: 'month' } | (Extract<Cadence, { kind: 'pay' }> & { payDates: LocalDate[] })

/** The owner's paydays (Joint Savers: the Joint anchor's), or calendar months without a pay schedule. */
export function goalCadence(db: Db, saver: AccountRow, today: LocalDate): RecentCadence {
  let userId: string | null = null
  let dates: LocalDate[] = []
  if (saver.ownership === 'JOINT') {
    const joint = listBudgetRows(db).find((b) => b.kind === 'joint')
    userId = joint?.anchorUserId ?? null
    dates = joint ? budgetPayEvents(db, joint).map((e) => e.payDate) : []
  } else if (saver.ownerUserId) {
    userId = saver.ownerUserId
    dates = listPayEvents(db, userId).map((e) => e.payDate)
  }
  const schedule = userId ? getSchedule(db, userId) : undefined
  const payDates = dates.filter((d) => d <= today).sort()
  const last = payDates.at(-1)
  if (!schedule || !last) return { kind: 'month' }
  return { kind: 'pay', frequencyDays: schedule.frequencyDays, lastPayDate: last, payDates }
}

/** The up-to-3 most recent completed `[start, end)` periods. */
export function recentPeriods(cadence: RecentCadence, today: LocalDate): [LocalDate, LocalDate][] {
  const periods: [LocalDate, LocalDate][] = []
  if (cadence.kind === 'pay') {
    const d = cadence.payDates
    for (let i = 0; i + 1 < d.length; i++) periods.push([d[i]!, d[i + 1]!])
  } else {
    const thisMonth = `${today.slice(0, 7)}-01`
    for (let k = RECENT_PERIODS; k >= 1; k--) {
      periods.push([addMonthsClamped(thisMonth, -k, 1), addMonthsClamped(thisMonth, -k + 1, 1)])
    }
  }
  return periods.slice(-RECENT_PERIODS)
}

/** A Saver's matching transactions per period over the last 3 completed periods, round-ups excluded. */
function recentAverage(
  db: Db,
  accountId: string,
  cadence: RecentCadence,
  today: LocalDate,
  tz: string,
  matching?: SQL,
): number {
  const recent = recentPeriods(cadence, today)
  if (recent.length === 0) return 0
  const total = recent.reduce((acc, [start, end]) => {
    const range = periodRangeUtc(start, end, tz)
    const row = db
      .select({ cents: sum(s.transactions.amountCents) })
      .from(s.transactions)
      .where(
        and(
          eq(s.transactions.accountId, accountId),
          isNull(s.transactions.deletedAt),
          or(isNull(s.transactions.transactionType), ne(s.transactions.transactionType, 'Round Up')),
          gte(s.transactions.createdAt, range.start),
          lt(s.transactions.createdAt, range.end),
          matching,
        ),
      )
      .get()
    return acc + Number(row?.cents ?? 0)
  }, 0)
  return total / recent.length
}

/** Average net inflow per period over the last 3 completed periods, round-ups excluded. */
export function recentRate(
  db: Db,
  accountId: string,
  cadence: RecentCadence,
  today: LocalDate,
  tz: string,
): number {
  return recentAverage(db, accountId, cadence, today, tz)
}

/** Average money out of the Saver per period over the same periods, as a positive amount. */
function recentOut(db: Db, accountId: string, cadence: RecentCadence, today: LocalDate, tz: string): number {
  return Math.round(Math.abs(recentAverage(db, accountId, cadence, today, tz, lt(s.transactions.amountCents, 0))))
}

/** What one person's template puts into each Saver, per their own pay, and how often they're paid. */
type PersonPlan = { bySaver: Map<string, number>; frequencyDays: number | null }

/** Each person's plan, read the first time it's asked for and kept for the rest of the request. */
export function planLookup(db: Db) {
  const people = new Map<string, PersonPlan>()
  return (userId: string): PersonPlan => {
    let person = people.get(userId)
    if (!person) {
      const bySaver = new Map<string, number>()
      for (const item of getTemplate(db, userId)?.items ?? []) {
        if (item.resolvedSaverId) {
          bySaver.set(item.resolvedSaverId, (bySaver.get(item.resolvedSaverId) ?? 0) + item.amountCents)
        }
      }
      person = { bySaver, frequencyDays: getSchedule(db, userId)?.frequencyDays ?? null }
      people.set(userId, person)
    }
    return person
  }
}

type PlanLookup = ReturnType<typeof planLookup>

/** What a person's plan puts into the Saver per the goal's cadence. Without a pay schedule, their amount as it is. */
function plannedCents(person: PersonPlan, saverId: string, cadence: Cadence): number {
  const cents = person.bySaver.get(saverId) ?? 0
  if (person.frequencyDays === null) return cents
  const days = cadence.kind === 'pay' ? cadence.frequencyDays : 365 / 12
  return Math.round((cents * days) / person.frequencyDays)
}

/**
 * The plan line's amounts. A joint Saver adds both people; a partner who hides finances is left out, and
 * `partial` is true whether or not they planned anything, so it says nothing about their plan.
 */
function goalPlan(
  db: Db,
  saver: AccountRow,
  cadence: Cadence,
  viewerId: string,
  planOf: PlanLookup,
): GoalDto['plan'] {
  const joint = saver.ownership === 'JOINT'
  const viewerPlans = joint || saver.ownerUserId === viewerId
  const otherId = (joint ? partnerOf(db, viewerId)?.id : viewerPlans ? null : saver.ownerUserId) ?? null
  const partial = otherId !== null && !canSee(db, viewerId, otherId, 'finances')
  const mineCents = viewerPlans ? plannedCents(planOf(viewerId), saver.id, cadence) : 0
  const partnerCents = otherId !== null && !partial ? plannedCents(planOf(otherId), saver.id, cadence) : 0
  const amountCents = mineCents + partnerCents
  if (amountCents === 0) return null
  return {
    amountCents,
    mineCents,
    partnerCents: partnerCents || null,
    partnerName: otherId !== null && partnerCents > 0 ? displayName(db, otherId) : null,
    partial,
  }
}

/** Up's Save Up Challenge Saver gets a $1,000 goal until its owner sets one; the name ignores emoji and case. */
const CHALLENGE = { name: 'Save Up Challenge', targetCents: 100_000, targetDate: null }

const isChallenge = (saver: AccountRow) =>
  saver.displayName
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim() === 'save up challenge'

/** The saved goal, else the built-in default; null when the Saver has neither. */
function effectiveGoal(
  saver: AccountRow | undefined,
  goal: GoalRow | undefined,
): { kind: GoalKind; name: string; targetCents: number; targetDate: LocalDate | null; isDefault: boolean } | null {
  if (goal) {
    const { kind, name, targetCents, targetDate } = goal
    return { kind, name, targetCents, targetDate, isDefault: false }
  }
  if (saver?.accountType === 'SAVER' && isChallenge(saver)) return { kind: 'save', ...CHALLENGE, isDefault: true }
  return null
}

/**
 * The debt a debt goal follows, with what's left on it today. Null for other kinds, and when the debt has gone or
 * the viewer can't see it (the link rules keep the latter from happening); the goal then keeps its stored target.
 */
export function followedDebt(db: Db, goal: GoalRow | undefined, viewerId: string | null, today: LocalDate, tz: string) {
  if (goal?.kind !== 'debt' || !goal.debtId) return null
  const debt = db.select().from(s.debts).where(eq(s.debts.id, goal.debtId)).get()
  if (!debt || (viewerId !== null && !canSee(db, viewerId, debt.ownerUserId, 'finances'))) return null
  return { debt, ...debtLeft(db, debt, today, tz) }
}

export const displayName = (db: Db, userId: string) =>
  db.select({ name: s.users.displayName }).from(s.users).where(eq(s.users.id, userId)).get()?.name ??
  'someone else'

/** The refusal for someone acting on what another person owns. */
export const notYours = (db: Db, ownerId: string | null) =>
  new BudgetError(403, `Only ${ownerId ? displayName(db, ownerId) : 'its owner'} can edit that.`)

export const canEditSaver = (saver: AccountRow, viewerId: string) =>
  saver.ownership === 'JOINT' || saver.ownerUserId === viewerId

/** The local date a goal's start was set. Rows saved before goals had a start fall back to when they were made. */
export const goalStartDate = (saved: GoalRow, tz: string) => localDate(saved.startedAt || saved.createdAt, tz)

/** The reached date each Saver's celebration was last seen on by one person; read once per request. */
export type SeenLookup = Map<string, string>

export function seenLookup(db: Db, viewerId: string): SeenLookup {
  return new Map(
    db
      .select({ accountId: s.goalCelebrationsSeen.accountId, reachedOn: s.goalCelebrationsSeen.reachedOn })
      .from(s.goalCelebrationsSeen)
      .where(eq(s.goalCelebrationsSeen.userId, viewerId))
      .all()
      .map((r) => [r.accountId, r.reachedOn]),
  )
}

export function toGoalDto(
  db: Db,
  saver: AccountRow | undefined,
  saved: GoalRow | undefined,
  accountId: string,
  viewerId: string,
  today: LocalDate,
  tz: string,
  planOf: PlanLookup,
  seen: SeenLookup = seenLookup(db, viewerId),
): GoalDto {
  const goal = effectiveGoal(saver, saved)
  const base: GoalDto = {
    accountId,
    saverName: saver?.displayName ?? null,
    balanceCents: saver?.balanceCents ?? 0,
    ownerUserId: saver?.ownership === 'INDIVIDUAL' ? saver.ownerUserId : null,
    goal,
    debt: null,
    progress: 0,
    status: null,
    neededCents: null,
    neededPer: null,
    behindCents: null,
    projectedDate: null,
    toGoCents: null,
    expectedProgress: null,
    belowCents: null,
    recentRateCents: null,
    debtFallCents: null,
    followedDebtName: saved?.followedDebtName ?? null,
    reachedOn: saved?.reachedOn ?? null,
    celebrate: false,
    ownerName:
      saver?.ownership === 'INDIVIDUAL' && saver.ownerUserId && saver.ownerUserId !== viewerId
        ? displayName(db, saver.ownerUserId)
        : null,
    plan: null,
    cadence: null,
    saverOutCents: null,
    sparkline: null,
    today,
    canEdit: saver ? canEditSaver(saver, viewerId) : true,
    accountMissing: !saver,
  }
  if (!goal || !saver) return base

  const cadence = goalCadence(db, saver, today)
  const planned = {
    plan: goalPlan(db, saver, cadence, viewerId, planOf),
    // Without payDates, which only the recent periods need.
    cadence:
      cadence.kind === 'pay'
        ? { kind: cadence.kind, frequencyDays: cadence.frequencyDays, lastPayDate: cadence.lastPayDate }
        : cadence,
  }
  if (goal.kind === 'buffer') {
    const sparkline = goalSparkline(db, saver, 'buffer', goal.targetCents, null, today, tz)
    return { ...base, ...planned, ...bufferStatus(saver.balanceCents, goal.targetCents), sparkline }
  }

  const followed = followedDebt(db, saved, viewerId, today, tz)
  const targetCents = followed ? followed.leftCents : goal.targetCents
  // A debt goal's gap also closes as the debt falls.
  const fall = followed ? debtFall(followed.days, recentPeriods(cadence, today)) : null
  const rate = recentRate(db, saver.id, cadence, today, tz) + (fall ?? 0)
  const pace = goalStatus({
    balanceCents: saver.balanceCents,
    targetCents,
    targetDate: goal.targetDate,
    today,
    recentRateCents: rate,
    cadence,
  })
  const expected =
    saved && goal.targetDate && (pace.status === 'on-track' || pace.status === 'behind')
      ? expectedProgress({
          startCents: saved.startCents,
          startTargetCents: saved.startTargetCents ?? targetCents,
          startDate: goalStartDate(saved, tz),
          targetDate: goal.targetDate,
          today,
        })
      : null
  // The first read that finds it reached records the date. The built-in goal has no row to record on.
  let reachedOn = base.reachedOn
  if (saved && pace.status === 'reached' && reachedOn === null) {
    reachedOn = today
    db.update(s.goals).set({ reachedOn }).where(eq(s.goals.accountId, saved.accountId)).run()
  }
  return {
    ...base,
    ...planned,
    reachedOn,
    celebrate: pace.status === 'reached' && reachedOn !== null && seen.get(accountId) !== reachedOn,
    saverOutCents: followed && recentOut(db, saver.id, cadence, today, tz),
    sparkline: goalSparkline(db, saver, goal.kind, targetCents, followed, today, tz),
    goal: { ...goal, targetCents },
    debt: followed && {
      id: followed.debt.id,
      name: followed.debt.name,
      leftCents: followed.leftCents,
      startTargetCents: saved?.startTargetCents ?? followed.leftCents,
      paidOff: followed.leftCents === 0,
    },
    ...pace,
    toGoCents: pace.status === 'reached' ? null : targetCents - saver.balanceCents,
    expectedProgress: expected,
    recentRateCents: Math.round(rate),
    debtFallCents: fall,
  }
}

/** A goal whose Saver has gone has no owner to check, so it needs finances access to everyone else. */
const canSeeEveryone = (db: Db, viewerId: string) =>
  db
    .select({ id: s.users.id })
    .from(s.users)
    .where(ne(s.users.id, viewerId))
    .all()
    .every((u) => canSee(db, viewerId, u.id, 'finances'))

/**
 * The viewer's archived goals in a scope, newest archived first. Like the goals themselves they need finances on their
 * owner; a joint Saver's show to both people.
 */
function listArchived(db: Db, scope: Scope, viewerId: string): ArchivedGoalDto[] {
  const inScope = (owner: string | null) =>
    ({
      everyone: true,
      me: owner === viewerId,
      partner: owner !== null && owner !== viewerId,
      joint: owner === null,
    })[scope]
  return db
    .select()
    .from(s.archivedGoals)
    .orderBy(desc(s.archivedGoals.archivedAt))
    .all()
    .filter((r) => inScope(r.ownerUserId) && canSee(db, viewerId, r.ownerUserId, 'finances'))
    .map((r) => ({
      id: r.id,
      accountId: r.accountId,
      saverName: r.saverName,
      name: r.name,
      kind: r.kind,
      targetCents: r.targetCents,
      debtName: r.debtName,
      debtPaidOff: r.debtPaidOff,
      reachedOn: r.reachedOn,
      canEdit: r.ownerUserId === null || r.ownerUserId === viewerId,
    }))
}

/** Every Saver in scope with its goal; goals whose Saver is gone show under Everyone. Archived goals ride along. */
export function listGoals(db: Db, scope: Scope, viewerId: string, today: LocalDate, tz: string): GoalsDto {
  const ids = scopeAccountIds(db, scope, viewerId, 'finances')
  const savers = ids.length
    ? db
        .select()
        .from(s.accounts)
        .where(and(inArray(s.accounts.id, ids), eq(s.accounts.accountType, 'SAVER')))
        .orderBy(s.accounts.displayName)
        .all()
    : []
  const goals = new Map(
    db
      .select()
      .from(s.goals)
      .all()
      .map((g) => [g.accountId, g]),
  )
  const planOf = planLookup(db)
  const seen = seenLookup(db, viewerId)
  const result: GoalDto[] = savers.map((saver) =>
    toGoalDto(db, saver, goals.get(saver.id), saver.id, viewerId, today, tz, planOf, seen),
  )
  if (scope === 'everyone' && canSeeEveryone(db, viewerId)) {
    const known = new Set(
      db
        .select({ id: s.accounts.id })
        .from(s.accounts)
        .all()
        .map((a) => a.id),
    )
    for (const goal of goals.values()) {
      if (!known.has(goal.accountId))
        result.push(toGoalDto(db, undefined, goal, goal.accountId, viewerId, today, tz, planOf, seen))
    }
  }
  return { goals: result, archived: listArchived(db, scope, viewerId) }
}

function requireEditableSaver(db: Db, accountId: string, viewerId: string): AccountRow | undefined {
  const saver = db.select().from(s.accounts).where(eq(s.accounts.id, accountId)).get()
  if (saver && !canSeeAccount(db, viewerId, saver, 'finances')) throw new BudgetError(404, 'Saver not found')
  if (saver && !canEditSaver(saver, viewerId)) {
    throw notYours(db, saver.ownerUserId)
  }
  return saver
}

/** A Saver the viewer may set a goal on. */
function requireGoalSaver(db: Db, accountId: string, viewerId: string): AccountRow {
  const saver = requireEditableSaver(db, accountId, viewerId)
  if (!saver) throw new BudgetError(404, 'Saver not found')
  if (saver.accountType !== 'SAVER') throw new BudgetError(400, 'Goals can only be set on Savers.')
  return saver
}

/** A personal Saver may follow its owner's debts or joint debts; a joint Saver only joint debts. */
function mayFollow(saver: AccountRow, debt: DebtRow): boolean {
  return debt.ownerUserId === null || (saver.ownership !== 'JOINT' && debt.ownerUserId === saver.ownerUserId)
}

/** The Saver's name, or "another Saver" when it has gone or the viewer can't see its goal. */
function saverNameFor(db: Db, accountId: string, viewerId: string): string {
  const saver = db.select().from(s.accounts).where(eq(s.accounts.id, accountId)).get()
  return saver && canSeeAccount(db, viewerId, saver, 'finances') ? saver.displayName : 'another Saver'
}

export interface GoalBody {
  kind?: GoalKind
  name: string
  targetCents?: number
  targetDate?: LocalDate | null
  debtId?: string
}

export function putGoal(
  db: Db,
  accountId: string,
  body: GoalBody,
  viewerId: string,
  now: Date,
  today: LocalDate,
  tz: string,
): void {
  const saver = requireGoalSaver(db, accountId, viewerId)
  const kind = body.kind ?? 'save'

  if (kind === 'debt') {
    if (!body.debtId) throw new BudgetError(400, 'Choose a debt.')
  } else {
    if (body.targetCents === undefined || body.targetCents <= 0) {
      throw new BudgetError(400, 'Target must be more than $0.')
    }
    if (kind === 'buffer' && body.targetDate) throw new BudgetError(400, 'A buffer has no date.')
  }

  let leftCents: number | null = null
  if (kind === 'debt') {
    // A hidden debt looks the same as a missing one, and is checked first so no later message confirms it exists.
    const debt = db.select().from(s.debts).where(eq(s.debts.id, body.debtId!)).get()
    if (!debt || !canSee(db, viewerId, debt.ownerUserId, 'finances')) throw new BudgetError(404, 'Debt not found')
    if (!mayFollow(saver, debt)) {
      throw new BudgetError(
        400,
        saver.ownership === 'JOINT'
          ? 'A joint Saver can only follow a joint debt.'
          : `This Saver can only follow ${saver.ownerUserId ? displayName(db, saver.ownerUserId) : 'its owner'}'s debts or joint debts.`,
      )
    }
    const follower = db
      .select({ accountId: s.goals.accountId })
      .from(s.goals)
      .where(and(eq(s.goals.debtId, debt.id), ne(s.goals.accountId, accountId)))
      .get()
    if (follower) {
      const name = saverNameFor(db, follower.accountId, viewerId)
      throw new BudgetError(400, `${name === 'another Saver' ? 'Another Saver' : name} already follows ${debt.name}.`)
    }
    leftCents = debtLeft(db, debt, today, tz).leftCents
  }

  const targetDate = kind === 'buffer' ? null : (body.targetDate ?? null)
  // A date that has already passed may be kept (editing a goal shouldn't force a new date), not newly set.
  const existing = db.select().from(s.goals).where(eq(s.goals.accountId, accountId)).get()
  if (targetDate && targetDate < today && targetDate !== existing?.targetDate) {
    throw new BudgetError(400, "Target date can't be in the past.")
  }

  // Debt goals store what's left as of this save; reads work the target out from the debt.
  const targetCents = leftCents ?? body.targetCents!
  const debtId = kind === 'debt' ? body.debtId! : null
  const stamp = now.toISOString()
  // The start moves to today's balance and target when the goal changes, not when it's only renamed.
  const resetStart =
    !existing ||
    existing.kind !== kind ||
    existing.targetDate !== targetDate ||
    existing.debtId !== debtId ||
    (kind !== 'debt' && existing.targetCents !== targetCents)
  const fields = {
    kind,
    name: body.name,
    targetCents,
    targetDate,
    debtId,
    followedDebtName: null,
    updatedAt: stamp,
    ...(resetStart
      ? { startCents: saver.balanceCents, startedAt: stamp, startTargetCents: leftCents, reachedOn: null }
      : {}),
  }
  db.transaction((tx) => {
    tx.insert(s.goals)
      .values({ accountId, ...fields, createdAt: stamp })
      .onConflictDoUpdate({ target: s.goals.accountId, set: fields })
      .run()
    // A goal reached again must celebrate again, even on the day it was first reached.
    if (resetStart) tx.delete(s.goalCelebrationsSeen).where(eq(s.goalCelebrationsSeen.accountId, accountId)).run()
  })
}

/** Debts this Saver's goal may follow, by name, with what's left and which other Saver follows each. */
export function listGoalDebts(
  db: Db,
  accountId: string,
  viewerId: string,
  today: LocalDate,
  tz: string,
): GoalDebtOptionDto[] {
  const saver = requireGoalSaver(db, accountId, viewerId)
  const followers = new Map(
    db
      .select({ accountId: s.goals.accountId, debtId: s.goals.debtId })
      .from(s.goals)
      .where(isNotNull(s.goals.debtId))
      .all()
      .map((g) => [g.debtId!, g.accountId]),
  )
  return db
    .select()
    .from(s.debts)
    .all()
    .filter((d) => mayFollow(saver, d) && canSee(db, viewerId, d.ownerUserId, 'finances'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => {
      const by = followers.get(d.id)
      return {
        id: d.id,
        name: d.name,
        leftCents: debtLeft(db, d, today, tz).leftCents,
        followedBy: by === undefined || by === accountId ? null : saverNameFor(db, by, viewerId),
      }
    })
}

export function deleteGoal(db: Db, accountId: string, viewerId: string): void {
  const saver = requireEditableSaver(db, accountId, viewerId)
  // A goal whose Saver has gone is hidden from the viewer by the same rule as in listGoals.
  if (!saver && !canSeeEveryone(db, viewerId)) throw new BudgetError(404, 'Saver not found')
  db.transaction((tx) => {
    tx.delete(s.goals).where(eq(s.goals.accountId, accountId)).run()
    tx.delete(s.goalCelebrationsSeen).where(eq(s.goalCelebrationsSeen.accountId, accountId)).run()
  })
}

/** The Fund line caption: "{name} goal {percent}%"; a debt goal measures against what's left on the debt. */
export function goalCaption(
  db: Db,
  accountId: string,
  today: LocalDate,
  tz: string,
): { name: string; percent: number; reached: boolean } | null {
  const saver = db.select().from(s.accounts).where(eq(s.accounts.id, accountId)).get()
  const saved = db.select().from(s.goals).where(eq(s.goals.accountId, accountId)).get()
  const goal = effectiveGoal(saver, saved)
  if (!goal || !saver) return null
  const targetCents = followedDebt(db, saved, null, today, tz)?.leftCents ?? goal.targetCents
  const progress = targetCents <= 0 ? 1 : Math.max(saver.balanceCents, 0) / targetCents
  return { name: goal.name, percent: Math.min(100, Math.floor(progress * 100)), reached: progress >= 1 }
}
