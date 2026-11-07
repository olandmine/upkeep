import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import type { DebtRepaymentDto, DebtRepaymentRuleDto, TransactionRepaymentDto } from '../../shared/types'
import { localDate, type LocalDate } from '../budgets/dates'
import { BudgetError } from '../budgets/errors'
import { normaliseDescription } from '../budgets/pay-schedule'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { DebtRow } from '../db/schema'
import { viewableAccountIds } from '../queries/scope'
import { canSee, shares } from '../sharing/policy'
import { canEditDebt, requireEditableDebt, startingPoints } from './debts'

/** A personal debt's repayments come from its owner's own accounts; a Joint debt's from any account. */
export function debtAccountIds(db: Db, debt: DebtRow): string[] {
  const where = debt.ownerUserId
    ? and(eq(s.accounts.ownership, 'INDIVIDUAL'), eq(s.accounts.ownerUserId, debt.ownerUserId))
    : or(
        eq(s.accounts.ownership, 'JOINT'),
        and(eq(s.accounts.ownership, 'INDIVIDUAL'), isNotNull(s.accounts.ownerUserId)),
      )
  return db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(where)
    .all()
    .map((r) => r.id)
}

const excludedIds = (db: Db, debtId: string) =>
  new Set(
    db
      .select({ id: s.debtRepaymentExclusions.transactionId })
      .from(s.debtRepaymentExclusions)
      .where(eq(s.debtRepaymentExclusions.debtId, debtId))
      .all()
      .map((r) => r.id),
  )

/** Which of these transactions sit on an account the viewer can't see transactions for; ids with no row aren't hidden. */
export function hiddenTransactionIds(db: Db, viewerId: string, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set()
  const visible = new Set(viewableAccountIds(db, viewerId, 'transactions'))
  return new Set(
    db
      .select({ id: s.transactions.id, accountId: s.transactions.accountId })
      .from(s.transactions)
      .where(inArray(s.transactions.id, ids))
      .all()
      .filter((r) => !visible.has(r.accountId))
      .map((r) => r.id),
  )
}

const notFound = () => new BudgetError(404, 'Transaction not found')

/** The descriptions that mark the debt's repayments, alphabetically. */
export function repaymentRules(db: Db, debtId: string): DebtRepaymentRuleDto[] {
  return db
    .select({ id: s.debtRepaymentRules.id, match: s.debtRepaymentRules.match })
    .from(s.debtRepaymentRules)
    .where(eq(s.debtRepaymentRules.debtId, debtId))
    .orderBy(asc(s.debtRepaymentRules.match))
    .all()
}

/** Every one-off: transaction id → the debt it counts toward. */
const oneOffs = (db: Db) =>
  new Map(
    db
      .select()
      .from(s.debtRepaymentLinks)
      .all()
      .map((r) => [r.transactionId, r.debtId]),
  )

/** Whether any transactions mark the debt's repayments; without them, past repayments are estimated. */
export function tracksRepayments(db: Db, debtId: string): boolean {
  return (
    repaymentRules(db, debtId).length > 0 ||
    db.select().from(s.debtRepaymentLinks).where(eq(s.debtRepaymentLinks.debtId, debtId)).get() !== undefined
  )
}

/**
 * Whether a rule of this debt counts a transaction with this description on this account. On a Joint debt, a
 * personal account's owner must have agreed to the rule or share their transactions, or anyone could read
 * that person's spending into the balance by adding a rule.
 */
function ruleCounter(
  db: Db,
  debt: DebtRow,
  rules: DebtRepaymentRuleDto[],
): (accountId: string, match: string) => boolean {
  const matches = new Set(rules.map((r) => r.match))
  if (debt.ownerUserId) return (_accountId, match) => matches.has(match)
  const owners = new Map(
    db
      .select({ id: s.accounts.id, ownerUserId: s.accounts.ownerUserId })
      .from(s.accounts)
      .where(eq(s.accounts.ownership, 'INDIVIDUAL'))
      .all()
      .map((a) => [a.id, a.ownerUserId]),
  )
  const agreed = new Set(
    db
      .select({ userId: s.debtRepaymentRulePeople.userId, match: s.debtRepaymentRules.match })
      .from(s.debtRepaymentRulePeople)
      .innerJoin(s.debtRepaymentRules, eq(s.debtRepaymentRules.id, s.debtRepaymentRulePeople.ruleId))
      .where(eq(s.debtRepaymentRules.debtId, debt.id))
      .all()
      .map((r) => `${r.userId}|${r.match}`),
  )
  return (accountId, match) => {
    if (!matches.has(match)) return false
    const owner = owners.get(accountId)
    return !owner || agreed.has(`${owner}|${match}`) || shares(db, owner, 'transactions')
  }
}

/**
 * The debt's repayments, oldest first: outflows (not internal transfers) on its accounts whose description
 * matches one of its rules, plus the transactions marked for it one by one. A one-off counts
 * only toward its own debt, even when its description matches another debt's rule.
 * `window` (UTC instants, `to` exclusive) limits them to one stretch of time, such as a pay cycle.
 */
export function matchedRepayments(
  db: Db,
  debt: DebtRow,
  firstAsOf: LocalDate,
  tz: string,
  window?: { from: string; to: string | null },
): DebtRepaymentDto[] {
  const rules = repaymentRules(db, debt.id)
  const linked = oneOffs(db)
  const mine = new Set([...linked].filter(([, debtId]) => debtId === debt.id).map(([id]) => id))
  if (rules.length === 0 && mine.size === 0) return []
  const accountIds = debtAccountIds(db, debt)
  if (accountIds.length === 0) return []
  const excluded = excludedIds(db, debt.id)
  const ruleCounts = ruleCounter(db, debt, rules)
  return db
    .select({
      id: s.transactions.id,
      accountId: s.transactions.accountId,
      createdAt: s.transactions.createdAt,
      amountCents: s.transactions.amountCents,
      description: s.transactions.description,
      transferAccountId: s.transactions.transferAccountId,
    })
    .from(s.transactions)
    .where(
      and(
        inArray(s.transactions.accountId, accountIds),
        isNull(s.transactions.deletedAt),
        lt(s.transactions.amountCents, 0),
        window ? gte(s.transactions.createdAt, window.from) : undefined,
        window?.to ? lt(s.transactions.createdAt, window.to) : undefined,
      ),
    )
    .orderBy(asc(s.transactions.createdAt))
    .all()
    .filter(
      (r) =>
        mine.has(r.id) ||
        (r.transferAccountId === null &&
          !linked.has(r.id) &&
          !excluded.has(r.id) &&
          ruleCounts(r.accountId, normaliseDescription(r.description))),
    )
    .map((r) => ({
      transactionId: r.id,
      date: localDate(r.createdAt, tz),
      amountCents: -r.amountCents,
      description: r.description,
      oneOff: mine.has(r.id),
    }))
    .filter((r) => r.date >= firstAsOf)
}

/**
 * "This is a repayment". With `matchFuture`, the transaction's description becomes another of
 * the debt's rules; without, only this transaction counts toward the debt.
 */
export function markRepayment(
  db: Db,
  debtId: string,
  transactionId: string,
  matchFuture: boolean,
  viewerId: string,
): void {
  const debt = requireEditableDebt(db, debtId, viewerId)
  const tx = db.select().from(s.transactions).where(eq(s.transactions.id, transactionId)).get()
  if (!tx || hiddenTransactionIds(db, viewerId, [tx.id]).size > 0) throw notFound()
  if (!debtAccountIds(db, debt).includes(tx.accountId)) {
    throw new BudgetError(400, `That transaction isn't on ${debt.name}'s accounts.`)
  }
  if (tx.amountCents >= 0) throw new BudgetError(400, 'Only money going out can be a repayment.')
  const match = normaliseDescription(tx.description)
  if (matchFuture) {
    const rule = db.select().from(s.debtRepaymentRules).where(eq(s.debtRepaymentRules.match, match)).get()
    if (rule && rule.debtId !== debt.id) {
      const other = db.select().from(s.debts).where(eq(s.debts.id, rule.debtId)).get()
      // Naming a debt would tie this description to it, so that takes seeing its owner's transactions.
      const name = other && canSee(db, viewerId, other.ownerUserId, 'transactions') ? other.name : 'another debt'
      throw new BudgetError(400, `That description already marks repayments for ${name}.`)
    }
  }
  db.transaction((t) => {
    if (matchFuture) {
      t.insert(s.debtRepaymentRules).values({ id: crypto.randomUUID(), debtId: debt.id, match }).onConflictDoNothing().run()
      // Marking your own transaction agrees for your own accounts.
      const { id: ruleId } = t.select().from(s.debtRepaymentRules).where(eq(s.debtRepaymentRules.match, match)).get()!
      t.insert(s.debtRepaymentRulePeople).values({ ruleId, userId: viewerId }).onConflictDoNothing().run()
      // The rule covers it now.
      t.delete(s.debtRepaymentLinks)
        .where(and(eq(s.debtRepaymentLinks.transactionId, transactionId), eq(s.debtRepaymentLinks.debtId, debt.id)))
        .run()
    } else {
      t.insert(s.debtRepaymentLinks)
        .values({ transactionId, debtId: debt.id })
        .onConflictDoUpdate({ target: s.debtRepaymentLinks.transactionId, set: { debtId: debt.id } })
        .run()
    }
    // Marking a transaction says it is a repayment, so it can't stay excluded.
    t.delete(s.debtRepaymentExclusions)
      .where(
        and(
          eq(s.debtRepaymentExclusions.debtId, debt.id),
          eq(s.debtRepaymentExclusions.transactionId, transactionId),
        ),
      )
      .run()
  })
}

export function removeRepaymentRule(db: Db, debtId: string, ruleId: string, viewerId: string): void {
  requireEditableDebt(db, debtId, viewerId)
  const removed = db
    .delete(s.debtRepaymentRules)
    .where(and(eq(s.debtRepaymentRules.id, ruleId), eq(s.debtRepaymentRules.debtId, debtId)))
    .run()
  if (removed.changes === 0) throw new BudgetError(404, 'Repayment rule not found')
}

/** "Not a repayment": a one-off is simply unmarked; a rule's match is excluded, which can be undone. */
export function excludeRepayment(db: Db, debtId: string, transactionId: string, viewerId: string): void {
  requireEditableDebt(db, debtId, viewerId)
  if (hiddenTransactionIds(db, viewerId, [transactionId]).size > 0) throw notFound()
  const unmarked = db
    .delete(s.debtRepaymentLinks)
    .where(and(eq(s.debtRepaymentLinks.transactionId, transactionId), eq(s.debtRepaymentLinks.debtId, debtId)))
    .run()
  const tx = db.select().from(s.transactions).where(eq(s.transactions.id, transactionId)).get()
  const matchesRule = tx && repaymentRules(db, debtId).some((r) => r.match === normaliseDescription(tx.description))
  if (unmarked.changes > 0 && !matchesRule) return
  db.insert(s.debtRepaymentExclusions).values({ debtId, transactionId }).onConflictDoNothing().run()
}

export function undoRepaymentExclusion(
  db: Db,
  debtId: string,
  transactionId: string,
  viewerId: string,
): void {
  requireEditableDebt(db, debtId, viewerId)
  if (hiddenTransactionIds(db, viewerId, [transactionId]).size > 0) throw notFound()
  db.delete(s.debtRepaymentExclusions)
    .where(
      and(
        eq(s.debtRepaymentExclusions.debtId, debtId),
        eq(s.debtRepaymentExclusions.transactionId, transactionId),
      ),
    )
    .run()
}

export function listRepaymentExclusions(db: Db, debt: DebtRow, viewerId: string, tz: string): DebtRepaymentDto[] {
  const all = [...excludedIds(db, debt.id)]
  const hidden = hiddenTransactionIds(db, viewerId, all)
  const ids = all.filter((id) => !hidden.has(id))
  if (ids.length === 0) return []
  return db
    .select()
    .from(s.transactions)
    .where(inArray(s.transactions.id, ids))
    .orderBy(asc(s.transactions.createdAt))
    .all()
    .map((r) => ({
      transactionId: r.id,
      date: localDate(r.createdAt, tz),
      amountCents: -r.amountCents,
      description: r.description,
      oneOff: false,
    }))
}

/** The debt a transaction counts toward as a repayment, for the transaction drawer. */
export function transactionRepayment(
  db: Db,
  transactionId: string,
  viewerId: string,
  tz: string,
): TransactionRepaymentDto {
  const tx = db.select().from(s.transactions).where(eq(s.transactions.id, transactionId)).get()
  if (!tx) return null
  // A one-off wins over another debt's rule, as in matchedRepayments.
  const oneOff = db.select().from(s.debtRepaymentLinks).where(eq(s.debtRepaymentLinks.transactionId, tx.id)).get()
  const rule = db
    .select()
    .from(s.debtRepaymentRules)
    .where(eq(s.debtRepaymentRules.match, normaliseDescription(tx.description)))
    .get()
  const debtId = oneOff?.debtId ?? rule?.debtId
  const debt = debtId ? db.select().from(s.debts).where(eq(s.debts.id, debtId)).get() : undefined
  const first = debt && startingPoints(db, debt.id)[0]
  if (!debt || !first || !canSee(db, viewerId, debt.ownerUserId, 'finances')) return null
  if (!matchedRepayments(db, debt, first.asOf, tz).some((r) => r.transactionId === tx.id)) return null
  return { debtId: debt.id, debtName: debt.name, canEdit: canEditDebt(debt, viewerId) }
}
