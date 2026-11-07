import type {
  AccountDto,
  BudgetPeriodDto,
  GoalDto,
  LineInputDto,
  LineKind,
  LineStatusDto,
  PayChangesInput,
  PayPlanDto,
  PlanItemDto,
} from '../../shared/types'
import { money } from '../components/budgets/format'
import { goalStatusText } from '../components/goals/format'
import { accountColorToken } from './group-accounts'

export type BucketKind = 'limit' | 'other' | 'plain' | 'saver' | 'shared-limit' | 'shared-other'
export type SectionId = 'spending' | 'yours' | 'joint' | 'shared'

export interface Bucket {
  key: string // `line:<lineId>`, `saver:<accountId>`, `plain:<lineId>`, `new:<tempId>`, 'other' or 'shared-other'
  kind: BucketKind
  name: string
  caption: string | null // balance, goal, coverage, or "Whatever is left of your pay"
  amountCents: number | null // null for shared-other
  editable: boolean // false for other, shared-other and plain
  spentCents: number | null
  leftCents: number | null
  state: 'ok' | 'warning' | 'over' | null
  percent: number // finite, 0 when there is no amount
  lineId: string | null
  /** The kind of the line behind the row: a Saver's fund line, or the limit linked to it. */
  lineKind: LineKind | null
  /** The line's own name, which a Saver row doesn't show. */
  lineName: string | null
  /** The limit of a spending line paid from this Saver, apart from what the plan moves into it. */
  limitCents: number | null
  saverAccountId: string | null
  moved: { check: 'done' | 'partial' | 'pending'; movedCents: number } | null
  saverMissing: boolean
  /** The row's line colour for limits, the account colour for Savers. */
  colorToken: string
  categoryIds: string[]
}

export interface PaySection {
  id: SectionId
  label: string
  totalCents: number
  buckets: Bucket[]
}

export interface PayView {
  payCents: number
  payIsExpected: boolean
  saversCents: number
  movedBackCents: number
  spendingMoneyCents: number
  limitsCents: number
  otherBudgetCents: number
  spentCents: number
  leftToSpendCents: number
  overPayCents: number // 0 unless otherBudget is below 0
  movedCount: number
  saverCount: number
  pace: 'on-pace' | 'fast' | 'over' | null // null for past periods
  sections: PaySection[]
  /** Every bucket key the saved data has, before the draft removes any. */
  readonly liveKeys: readonly string[]
}

export interface DraftBucket {
  tempId: string
  section: SectionId
  name: string
  amountCents: number
  categoryIds: string[]
  saverAccountId: string | null
}

export interface PayDraft {
  baseline: Record<string, number> // bucket key → amount when Edit began
  amounts: Record<string, number> // only touched keys
  texts: Record<string, string> // the number box's raw text, while typing
  creates: DraftBucket[]
  updates: Record<string, Partial<LineInputDto>> // by lineId
  removals: string[] // bucket keys
}

const WARNING_RATIO = 0.85
const OTHER_COLOR = 'cat-slate'
const SECTION_LABELS: Record<SectionId, string> = {
  spending: 'Stays in Spending',
  yours: 'Your Savers',
  joint: 'Joint Savers you pay into',
  shared: 'Shared spending limits',
}
const SECTION_ORDER: SectionId[] = ['spending', 'yours', 'joint', 'shared']

function progress(amountCents: number, spentCents: number) {
  const ratio = amountCents > 0 ? spentCents / amountCents : spentCents > 0 ? Infinity : 0
  const state: Bucket['state'] = ratio > 1 ? 'over' : ratio >= WARNING_RATIO ? 'warning' : 'ok'
  return { leftCents: amountCents - spentCents, state, percent: amountCents > 0 ? ratio * 100 : 0 }
}

function bucket(over: Partial<Bucket> & Pick<Bucket, 'key' | 'kind' | 'name'>): Bucket {
  return {
    caption: null,
    amountCents: null,
    editable: true,
    spentCents: null,
    leftCents: null,
    state: null,
    percent: 0,
    lineId: null,
    lineKind: null,
    lineName: null,
    limitCents: null,
    saverAccountId: null,
    moved: null,
    saverMissing: false,
    colorToken: OTHER_COLOR,
    categoryIds: [],
    ...over,
  }
}

function limitBucket(key: string, kind: 'limit' | 'shared-limit', l: LineStatusDto): Bucket {
  const p = progress(l.amountCents, l.spentCents)
  let caption: string | null = null
  if (kind === 'shared-limit' && l.coverage && l.saverName) {
    caption = l.coverage.state === 'covered' ? `${l.saverName} covers it` : `Short ${money(l.coverage.shortCents)}`
  }
  return bucket({
    key,
    kind,
    name: l.name,
    caption,
    amountCents: l.amountCents,
    spentCents: l.spentCents,
    ...p,
    lineId: l.lineId,
    lineKind: l.kind,
    lineName: l.name,
    saverAccountId: l.saverAccountId,
    saverMissing: l.saverMissing,
    colorToken: l.colorToken,
    categoryIds: l.categoryIds,
  })
}

/** Re-works a bucket's progress after the draft changed its amount. */
function withAmount(b: Bucket, amountCents: number): Bucket {
  if (b.kind === 'saver' || b.spentCents === null) return { ...b, amountCents }
  return { ...b, amountCents, ...progress(amountCents, b.spentCents) }
}

/**
 * Largest first, by the amount when Edit began so rows don't move under a slider; Other spending is last.
 * A row Edit didn't begin with uses its saved amount, which a slider can't change.
 */
function sortBuckets(list: Bucket[], draft: PayDraft | null, saved: Map<string, number | null>): Bucket[] {
  const size = (b: Bucket) => draft?.baseline[b.key] ?? (draft ? saved.get(b.key) : b.amountCents) ?? b.amountCents ?? -Infinity
  const rank = (b: Bucket) => (b.kind === 'other' || b.kind === 'shared-other' ? 1 : 0)
  return [...list].sort((a, b) => rank(a) - rank(b) || size(b) - size(a))
}

/**
 * What a Saver row paying for a limit will move once Apply has written the draft's changes to that limit. A changed
 * amount is sent for the Saver chosen, or for the one it had if cleared. Otherwise a plan item on the line goes with
 * the line, one on the Saver stays with the Saver, and with neither the limit's own amount is what moves.
 */
function saverAmountAfterApply(b: Bucket, saved: Bucket, it: PlanItemDto | undefined): number {
  const amount = b.amountCents ?? 0
  const changed = b.amountCents !== saved.amountCents
  const staysOnSaver = it?.targetKind === 'saver'
  if (b.saverAccountId === null) return changed || staysOnSaver ? amount : 0
  const moved = changed || it?.targetKind === 'line' ? amount : (b.limitCents ?? 0)
  if (b.saverAccountId === saved.saverAccountId) return staysOnSaver ? amount : moved
  return (staysOnSaver ? (saved.amountCents ?? 0) : 0) + moved
}

export function buildPayView(input: {
  plan: PayPlanDto | null
  period: BudgetPeriodDto
  jointPeriod: BudgetPeriodDto | null
  accounts: AccountDto[]
  goals: GoalDto[]
  draft?: PayDraft | null
  /** Set for a Standard pay: a Saver paying for a limit says what is usually spent, or nothing without usual figures. */
  standard?: { hasUsual: boolean } | null
}): PayView {
  const { plan, period, jointPeriod, accounts, goals } = input
  const draft = input.draft ?? null
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const goalByAccount = new Map(goals.map((g) => [g.accountId, g]))
  const lineById = new Map(period.lines.map((l) => [l.lineId, l]))
  const lineBySaver = new Map(period.lines.flatMap((l) => (l.saverAccountId ? [[l.saverAccountId, l] as const] : [])))
  const planItems = plan?.items ?? []

  const spending: Bucket[] = []
  const yours: Bucket[] = []
  const joint: Bucket[] = []
  const shared: Bucket[] = []
  const savedKeys = new Set<string>()

  // Personal limits: spending lines with no Saver.
  for (const l of period.lines) {
    if (l.kind === 'spending' && !l.saverAccountId) spending.push(limitBucket(`line:${l.lineId}`, 'limit', l))
  }

  // Plan items. Buffer items are ignored everywhere.
  const saverBucket = (saverId: string, amountCents: number, line: LineStatusDto | undefined, it: PlanItemDto | null) => {
    const account = accountById.get(saverId)
    const goal = goalByAccount.get(saverId)
    const missing = !account || (line?.saverMissing ?? false)
    const balance = account ? account.balanceCents : (line?.saverBalanceCents ?? null)
    const parts: string[] = []
    if (missing) parts.push('Saver not found')
    else if (balance !== null) parts.push(`Balance ${money(balance)}`)
    if (goal?.goal) {
      parts.push(goal.goal.name)
      const status = goalStatusText(goal)
      if (status) parts.push(status)
    }
    const spends = line?.kind === 'spending'
    if (spends && !input.standard) parts.push(`${money(line.spentCents)} of ${money(line.amountCents)} spent`)
    else if (spends && input.standard?.hasUsual) parts.push(`Usually ${money(line.spentCents)} of ${money(line.amountCents)}`)
    const check = it?.check ?? null
    return bucket({
      key: `saver:${saverId}`,
      kind: 'saver',
      name: account?.displayName ?? line?.saverName ?? it?.targetName ?? 'Saver',
      caption: parts.length ? parts.join(' · ') : null,
      amountCents,
      spentCents: spends ? line.spentCents : null,
      lineId: line?.lineId ?? null,
      lineKind: line?.kind ?? null,
      lineName: line?.name ?? null,
      limitCents: spends ? line.amountCents : null,
      saverAccountId: saverId,
      moved: check && amountCents > 0 ? { check, movedCents: it?.movedCents ?? 0 } : null,
      saverMissing: missing,
      colorToken: account ? accountColorToken(account) : (line?.colorToken ?? OTHER_COLOR),
      categoryIds: line?.categoryIds ?? [],
    })
  }

  for (const it of planItems) {
    if (it.targetKind === 'buffer') continue
    const line = it.lineId ? lineById.get(it.lineId) : undefined
    const saverId = it.resolvedSaverId ?? (it.targetKind === 'saver' ? it.saverAccountId : null)
    if (saverId) {
      if (savedKeys.has(saverId)) continue
      savedKeys.add(saverId)
      // A Saver-kind plan item has no line of its own, but the fund line or limit linked to its Saver still belongs to the row.
      const b = saverBucket(saverId, it.amountCents, line ?? lineBySaver.get(saverId), it)
      ;(accountById.get(saverId)?.ownership === 'JOINT' ? joint : yours).push(b)
    } else if (it.targetKind === 'line' && it.lineId && !line) {
      // A joint line with no Saver: set aside, no spend of its own.
      spending.push(
        bucket({
          key: `plain:${it.lineId}`,
          kind: 'plain',
          name: it.targetName,
          amountCents: it.amountCents,
          editable: false,
          lineId: it.lineId,
        }),
      )
    }
  }

  // A personal fund line, or a limit linked to a Saver, with no plan item counts as going to its Saver at its own amount.
  for (const l of period.lines) {
    if (l.saverAccountId && !savedKeys.has(l.saverAccountId)) {
      savedKeys.add(l.saverAccountId)
      const b = saverBucket(l.saverAccountId, l.amountCents, l, null)
      ;(accountById.get(l.saverAccountId)?.ownership === 'JOINT' ? joint : yours).push(b)
    }
  }

  for (const l of jointPeriod?.lines ?? []) {
    if (l.kind === 'spending') shared.push(limitBucket(`line:${l.lineId}`, 'shared-limit', l))
  }
  if (jointPeriod) {
    shared.push(
      bucket({
        key: 'shared-other',
        kind: 'shared-other',
        name: 'Other spending',
        spentCents: jointPeriod.notBudgetedCents,
        editable: false,
      }),
    )
  }

  const all = [...spending, ...yours, ...joint, ...shared]
  const live = new Set(all.map((b) => b.key))
  const savedAmounts = new Map(all.map((b) => [b.key, b.amountCents]))

  // Apply the draft: removals, then amounts and line edits.
  const removed = new Set(draft?.removals ?? [])
  let removedLimitSpend = 0
  // A Saver given to a limit, or taken from one, leaves the row where it is until Apply. The totals don't wait: these
  // are what Apply will move between the Savers, the limits and Other spending, so they agree with the saved view.
  let pendingSaversCents = 0
  let pendingLimitsCents = 0
  let pendingLimitSpent = 0
  const paidFrom = (saverId: string | null) => {
    const name = saverId ? accountById.get(saverId)?.displayName : undefined
    return name ? `Paid from ${name}` : null
  }
  const adjust = (list: Bucket[]) => {
    const out: Bucket[] = []
    for (const original of list) {
      if (removed.has(original.key)) {
        if (original.kind === 'limit') removedLimitSpend += original.spentCents ?? 0
        continue
      }
      let b = original
      const amount = draft?.amounts[b.key]
      if (b.editable && amount !== undefined) b = withAmount(b, amount)
      const upd = b.lineId ? draft?.updates[b.lineId] : undefined
      if (upd && b.kind === 'saver' && b.lineKind === 'spending') {
        // The row itself only changes after Apply; until then the form shows what was chosen.
        b = {
          ...b,
          saverAccountId: upd.saverAccountId !== undefined ? upd.saverAccountId : b.saverAccountId,
          limitCents: upd.amountCents ?? b.limitCents,
        }
        const it = planItems.find((i) => i.resolvedSaverId === original.saverAccountId)
        pendingSaversCents += saverAmountAfterApply(b, original, it) - (b.amountCents ?? 0)
        if (b.saverAccountId === null) {
          pendingLimitsCents += b.limitCents ?? 0
          pendingLimitSpent += b.spentCents ?? 0
        }
      }
      if (upd && (b.kind === 'limit' || b.kind === 'shared-limit')) {
        b = {
          ...b,
          name: upd.name ?? b.name,
          categoryIds: upd.categoryIds ?? b.categoryIds,
          saverAccountId: upd.saverAccountId !== undefined ? upd.saverAccountId : b.saverAccountId,
        }
        // A personal limit tried against a Saver stays in Spending until Apply, saying where it is paid from.
        if (b.kind === 'limit' && upd.saverAccountId !== undefined) b.caption = paidFrom(upd.saverAccountId)
      }
      out.push(b)
    }
    return out
  }
  const adjusted = {
    spending: adjust(spending),
    yours: adjust(yours),
    joint: adjust(joint),
    shared: adjust(shared),
  }

  for (const c of draft?.creates ?? []) {
    const key = `new:${c.tempId}`
    if (removed.has(key)) continue
    const amountCents = draft!.amounts[key] ?? c.amountCents
    if (c.section === 'spending' || c.section === 'shared') {
      adjusted[c.section].push(
        bucket({
          key,
          kind: c.section === 'spending' ? 'limit' : 'shared-limit',
          name: c.name,
          caption: c.section === 'spending' ? paidFrom(c.saverAccountId) : null,
          amountCents,
          spentCents: 0,
          ...progress(amountCents, 0),
          saverAccountId: c.saverAccountId,
          categoryIds: c.categoryIds,
        }),
      )
    } else {
      const account = c.saverAccountId ? accountById.get(c.saverAccountId) : undefined
      adjusted[c.section].push(
        bucket({
          key,
          kind: 'saver',
          name: account?.displayName ?? c.name,
          caption: account ? `Balance ${money(account.balanceCents)}` : null,
          amountCents,
          saverAccountId: c.saverAccountId,
          colorToken: account ? accountColorToken(account) : OTHER_COLOR,
        }),
      )
    }
  }

  // A limit tried against a Saver already counts as what will go to that Saver: its plan item, or else its own amount.
  // Taking that Saver out of the plan takes the item too, as it will resolve to that Saver by then.
  for (const b of adjusted.spending) {
    if (b.kind !== 'limit' || !b.saverAccountId) continue
    const it = b.lineId && !removed.has(`saver:${b.saverAccountId}`) ? planItems.find((i) => i.lineId === b.lineId) : undefined
    pendingSaversCents += it?.amountCents ?? b.amountCents ?? 0
    pendingLimitsCents -= b.amountCents ?? 0
    pendingLimitSpent -= b.spentCents ?? 0
  }

  // The numbers.
  const sum = (list: Bucket[]) => list.reduce((s, b) => s + (b.amountCents ?? 0), 0)
  const payCents = plan?.incomeCents ?? period.incomeCents
  const yoursCents = sum(adjusted.yours) + pendingSaversCents
  const saversCents = yoursCents + sum(adjusted.joint)
  const spendingMoneyCents = payCents - saversCents + period.movedBackCents
  const limitsCents = sum(adjusted.spending) + pendingLimitsCents
  const otherBudgetCents = spendingMoneyCents - limitsCents
  const limitSpent = adjusted.spending.reduce((s, b) => s + (b.kind === 'limit' ? (b.spentCents ?? 0) : 0), pendingLimitSpent)
  const saverLinkedSpent = period.lines.reduce((s, l) => s + (l.saverAccountId ? l.spentCents : 0), 0)
  const otherSpentCents = period.notBudgetedCents + saverLinkedSpent + removedLimitSpend - pendingLimitSpent
  const spentCents = limitSpent + otherSpentCents
  const leftToSpendCents = spendingMoneyCents - spentCents

  adjusted.spending.push(
    bucket({
      key: 'other',
      kind: 'other',
      name: 'Other spending',
      caption: 'Whatever is left of your pay',
      amountCents: otherBudgetCents,
      editable: false,
      spentCents: otherSpentCents,
      ...progress(otherBudgetCents, otherSpentCents),
    }),
  )

  let pace: PayView['pace'] = null
  if (period.isCurrent) {
    if (leftToSpendCents < 0) pace = 'over'
    else pace = spentCents * period.daysTotal <= period.daysElapsed * spendingMoneyCents ? 'on-pace' : 'fast'
  }

  const savers = [...adjusted.yours, ...adjusted.joint]
  const totals: Record<SectionId, number> = {
    spending: spendingMoneyCents,
    yours: yoursCents,
    joint: sum(adjusted.joint),
    shared: sum(adjusted.shared),
  }
  const sections: PaySection[] = SECTION_ORDER.map((id) => ({
    id,
    label: SECTION_LABELS[id],
    totalCents: totals[id],
    buckets: sortBuckets(adjusted[id], draft, savedAmounts),
  })).filter((s) => draft || s.buckets.length > 0)

  return {
    payCents,
    payIsExpected: plan ? plan.incomeIsExpected : period.payNotSeen,
    saversCents,
    movedBackCents: period.movedBackCents,
    spendingMoneyCents,
    limitsCents,
    otherBudgetCents,
    spentCents,
    leftToSpendCents,
    overPayCents: Math.max(0, -otherBudgetCents),
    movedCount: savers.filter((b) => b.moved?.check === 'done').length,
    saverCount: savers.filter((b) => b.moved !== null).length,
    pace,
    sections,
    liveKeys: [...live],
  }
}

/** The Standard pay headline: what is usually left over, or without usual spending what the limits leave. */
export function standardHeadline(view: PayView, hasUsual: boolean): { label: string; cents: number } {
  return hasUsual
    ? { label: 'Usually left over', cents: view.leftToSpendCents }
    : { label: 'Left after limits', cents: view.otherBudgetCents }
}

const editableBuckets = (view: PayView) => view.sections.flatMap((s) => s.buckets).filter((b) => b.editable)

/** A draft that starts from the view as it is now. */
export function startDraft(view: PayView): PayDraft {
  const baseline: Record<string, number> = {}
  for (const b of editableBuckets(view)) baseline[b.key] = b.amountCents ?? 0
  return { baseline, amounts: {}, texts: {}, creates: [], updates: {}, removals: [] }
}

/** The slider's top end: double the starting amount, or it plus $100, or $200, and never below the current amount. */
export function sliderMax(baselineCents: number, currentCents: number): number {
  const base = Math.max(baselineCents * 2, baselineCents + 10_000, 20_000)
  return Math.max(base, Math.ceil(currentCents / 500) * 500)
}

/**
 * Keys of rows whose amount differs from what is saved now. `saved` is the same view built without the draft,
 * so a refetch during an edit moves the comparison with it. Rows the saved view lacks (new ones) are not amount changes.
 */
export function changedKeys(view: PayView, saved: PayView): string[] {
  const savedAmount = new Map(editableBuckets(saved).map((b) => [b.key, b.amountCents]))
  return editableBuckets(view)
    .filter((b) => savedAmount.has(b.key) && b.amountCents !== savedAmount.get(b.key))
    .map((b) => b.key)
}

/**
 * Whether what would be sent adds, removes or renames something, which only makes sense for every pay.
 * Read from the changes themselves, so a draft entry for a bucket that has gone doesn't count. A Saver added in the
 * draft is only a `savers.set` entry, so it is told apart by being absent from what is saved.
 */
export function isStructural(changes: PayChangesInput, saved: PayView): boolean {
  const savedSavers = new Set(editableBuckets(saved).flatMap((b) => (b.kind === 'saver' && b.saverAccountId ? [b.saverAccountId] : [])))
  return (
    changes.savers.remove.length + changes.lines.create.length + changes.lines.update.length + changes.lines.archive.length > 0 ||
    changes.savers.set.some((s) => !savedSavers.has(s.saverAccountId))
  )
}

/** The draft with a new bucket in it. Its amount is also its fixed reference for row order and slider range. */
export function withCreate(draft: PayDraft, create: DraftBucket): PayDraft {
  return {
    ...draft,
    creates: [...draft.creates, create],
    baseline: { ...draft.baseline, [`new:${create.tempId}`]: create.amountCents },
  }
}

/** The draft without a bucket added in it, and without anything it had set for that bucket. */
export function withoutCreate(draft: PayDraft, tempId: string): PayDraft {
  const key = `new:${tempId}`
  const without = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
  return {
    ...draft,
    creates: draft.creates.filter((c) => c.tempId !== tempId),
    baseline: without(draft.baseline),
    amounts: without(draft.amounts),
    texts: without(draft.texts),
  }
}

/**
 * The draft with each Saver set to what Up moved into it, added to the plan if it isn't there yet.
 * `saved` is the view without the draft, as a Saver removed in this edit comes back. Other rows stay as they are.
 */
export function withPaySplit(
  draft: PayDraft,
  saved: PayView,
  split: readonly { saverId: string; amountCents: number }[],
  accounts: AccountDto[],
  newId: () => string,
): PayDraft {
  let next = draft
  const setAmount = (key: string, cents: number) => {
    next = {
      ...next,
      amounts: { ...next.amounts, [key]: cents },
      texts: { ...next.texts, [key]: (cents / 100).toFixed(2) },
    }
  }
  for (const { saverId, amountCents } of split) {
    const key = `saver:${saverId}`
    const added = next.creates.find((c) => c.saverAccountId === saverId && (c.section === 'yours' || c.section === 'joint'))
    if (added) {
      setAmount(`new:${added.tempId}`, amountCents)
    } else if (saved.liveKeys.includes(key)) {
      next = { ...next, removals: next.removals.filter((k) => k !== key) }
      setAmount(key, amountCents)
    } else {
      const account = accounts.find((a) => a.id === saverId)
      if (!account) continue
      next = withCreate(next, {
        tempId: newId(),
        section: account.ownership === 'JOINT' ? 'joint' : 'yours',
        name: account.displayName,
        amountCents,
        categoryIds: [],
        saverAccountId: saverId,
      })
    }
  }
  return next
}

export function draftChanges(
  view: PayView,
  saved: PayView,
  draft: PayDraft,
  payDate: string,
  applyTo: PayChangesInput['applyTo'],
): PayChangesInput {
  const buckets = editableBuckets(view)
  const savedByKey = new Map(editableBuckets(saved).map((b) => [b.key, b]))
  const changed = new Set(changedKeys(view, saved))
  const live = new Set(view.liveKeys)
  const readded = new Set(
    draft.creates.flatMap((c) => (c.saverAccountId && (c.section === 'yours' || c.section === 'joint') ? [c.saverAccountId] : [])),
  )
  const out: PayChangesInput = {
    payDate,
    applyTo,
    savers: { set: [], remove: [] },
    limits: [],
    lines: { create: [], update: [], archive: [] },
  }

  for (const b of buckets) {
    if (!changed.has(b.key)) continue
    if (b.kind === 'saver') {
      // A limit that lets go of its Saver leaves the row's amount going to the Saver it had.
      const saverAccountId = b.saverAccountId ?? savedByKey.get(b.key)?.saverAccountId
      if (saverAccountId) out.savers.set.push({ saverAccountId, amountCents: b.amountCents ?? 0 })
    } else if ((b.kind === 'limit' || b.kind === 'shared-limit') && b.lineId) {
      out.limits.push({ lineId: b.lineId, amountCents: b.amountCents ?? 0 })
    }
  }

  for (const key of draft.removals) {
    if (!live.has(key)) continue
    if (key.startsWith('saver:')) {
      const saverId = key.slice('saver:'.length)
      // Taken out and put back is just the new amount.
      if (readded.has(saverId)) continue
      out.savers.remove.push(saverId)
      // Its fund line, or the limit linked to it, would bring the Saver straight back, so it goes too.
      const fund = savedByKey.get(key)
      if (fund?.lineId) out.lines.archive.push(fund.lineId)
    } else if (key.startsWith('line:')) {
      out.lines.archive.push(key.slice('line:'.length))
    }
  }

  const limitLineIds = new Set(
    buckets.flatMap((b) => ((b.kind === 'limit' || b.kind === 'shared-limit' || b.lineKind === 'spending') && b.lineId ? [b.lineId] : [])),
  )
  for (const [lineId, patch] of Object.entries(draft.updates)) {
    if (!limitLineIds.has(lineId)) continue
    // The limit of a line paid from a Saver is an amount, not a rename.
    const { amountCents, ...rest } = patch
    if (amountCents !== undefined) out.limits.push({ lineId, amountCents })
    if (Object.keys(rest).length > 0) out.lines.update.push({ lineId, ...rest })
  }

  for (const c of draft.creates) {
    const key = `new:${c.tempId}`
    const b = buckets.find((x) => x.key === key)
    if (!b) continue
    if (c.section === 'spending' || c.section === 'shared') {
      out.lines.create.push({
        budget: c.section === 'spending' ? 'personal' : 'joint',
        kind: 'spending',
        name: c.name,
        amountCents: b.amountCents ?? 0,
        categoryIds: c.categoryIds,
        saverAccountId: c.saverAccountId,
      })
    } else if (c.saverAccountId) {
      out.savers.set.push({ saverAccountId: c.saverAccountId, amountCents: b.amountCents ?? 0 })
    }
  }
  return out
}

export interface SaverOption {
  id: string
  name: string
  /** Why it can't be chosen, or null when it can. */
  disabledReason: string | null
}

/**
 * The Savers a bucket form may offer, each saying why it can't be picked when that's so. `lines` are the active
 * budget lines (the one being edited left out). Savers already in the plan, or linked to a line, can't be chosen again:
 * the server rejects both. A partner's personal Savers are never listed.
 */
export function saverOptions(
  section: SectionId,
  view: PayView,
  lines: readonly Pick<LineStatusDto, 'lineId' | 'name' | 'kind' | 'saverAccountId'>[],
  accounts: AccountDto[],
  meId: string | undefined,
): SaverOption[] {
  const inPlan = new Set(
    view.sections
      .flatMap((s) => (s.id === 'yours' || s.id === 'joint' ? s.buckets : []))
      .flatMap((b) => (b.saverAccountId ? [b.saverAccountId] : [])),
  )
  const linkedTo = (id: string, kinds: readonly LineKind[]) => lines.find((l) => l.saverAccountId === id && kinds.includes(l.kind))
  const reason = (a: AccountDto): string | null => {
    if (section === 'spending' && a.ownership === 'JOINT') return 'Add on Shared limits'
    // A joint Saver backing a shared limit may also be one you pay into, so only your plan rules one out here.
    if (section !== 'joint') {
      // A fund line is how a Saver is in the plan; only a limit reads as "used".
      const used = linkedTo(a.id, section === 'yours' ? ['spending'] : ['spending', 'fund'])
      if (used) return `Used by ${used.name}`
    }
    return section !== 'shared' && inPlan.has(a.id) ? 'Already in your plan' : null
  }
  const wanted = (a: AccountDto) =>
    a.accountType === 'SAVER' &&
    (section === 'joint' || section === 'shared'
      ? a.ownership === 'JOINT'
      : a.ownership === 'JOINT'
        ? section === 'spending'
        : a.ownerUserId === meId)
  return accounts
    .filter(wanted)
    .map((a) => ({ id: a.id, name: a.displayName, disabledReason: reason(a) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
