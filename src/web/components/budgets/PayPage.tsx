import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  AccountDto,
  BudgetDto,
  BudgetPeriodDto,
  CategoryDto,
  GoalDto,
  LineInputDto,
  PayChangesInput,
  PayPlanDto,
  SpendingHistoryDto,
  StandardPayDto,
  UserDto,
} from '../../../shared/types'
import { UNCATEGORISED } from '../../../shared/categories'
import { errorMessage } from '../../lib/api'
import { canEditPeriod, canEditStandard } from '../../lib/budget-lines'
import { clearDrafts, useDraft } from '../../lib/draft'
import {
  buildPayView,
  changedKeys,
  draftChanges,
  isStructural,
  saverOptions,
  sliderMax,
  standardHeadline,
  startDraft,
  withCreate,
  withoutCreate,
  type Bucket,
  type PayDraft,
  type SectionId,
} from '../../lib/pay-view'
import { PlainLink, type LinkLike } from '../AppLink'
import { Money } from '../Money'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useToast } from '../ui/Toast'
import { BucketForm, type BucketFormValues } from './BucketForm'
import { BucketRow, type RowEdit } from './BucketRow'
import { BucketSection } from './BucketSection'
import { EditBar } from './EditBar'
import { addDays, money, parseDollars, shortDate } from './format'
import { PaySummary, SECTION_COLORS } from './PaySummary'
import { AnchorPicker } from './SetupWizard'

interface Props {
  /** The pay's plan; null when there isn't one yet, or while it loads. */
  plan: PayPlanDto | null
  accounts: AccountDto[]
  goals: GoalDto[]
  /** For the category pickers in the add and change forms. */
  categories?: CategoryDto[]
  /** Recent spending on the person's budget and on Joint, for what the add form suggests. */
  spendingHistory?: { personal?: SpendingHistoryDto; joint?: SpendingHistoryDto }
  /** Loading and failed plans show a message instead of the sections, and offer no Edit. */
  planState?: 'ready' | 'loading' | 'error'
  /** The person's budget, which decides whether Edit is offered. */
  budget?: BudgetDto
  period: BudgetPeriodDto
  /** The joint period running today on the current pay, or containing a past pay's start; null when Joint has none. */
  jointPeriod: BudgetPeriodDto | null
  /** Whether Joint is set up; when not, the shared section offers to set it up. */
  jointSetUp: boolean
  /** Set for the Standard pay view, which shows what a normal pay usually leaves; its plan and periods are the ones passed in. */
  standard?: StandardPayDto | null
  /** Savers in This pay's plan. In Standard pay, one that isn't also in Standard pay can't be linked to a limit: the server counts it as in two buckets. */
  thisPaySaverIds?: readonly string[]
  person: string
  viewerId: string | undefined
  payDate: string
  onSetUpJoint: () => void
  /** Joint's budget and the people it can follow, for the picker in Edit mode. It saves as soon as it changes. */
  jointBudget?: BudgetDto
  users?: UserDto[]
  onSetAnchor?: (userId: string) => Promise<void>
  /** Saves a set of changes, rejecting when it fails. The page shows the error and stays in Edit mode. */
  onApply: (changes: PayChangesInput) => Promise<void>
  /** Told when Edit mode starts and stops, so the page can lock what changes the pay on screen. */
  onEditingChange?: (editing: boolean) => void
  /** Where the Edit button goes, such as the page header's actions; without one it sits above the summary. */
  actionsSlot?: HTMLElement | null
  LinkComponent?: LinkLike
}

const lastDay = (p: BudgetPeriodDto) => addDays(p.end ?? p.nominalEnd, -1)

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Transactions for a scope over a period, optionally limited to some categories. */
function transactionsHref(scope: string, period: BudgetPeriodDto, categoryIds?: string[]) {
  const to = period.end ? addDays(period.end, -1) : todayIso()
  const params = new URLSearchParams({ scope })
  if (categoryIds?.length) params.set('categoryIds', categoryIds.join(','))
  params.set('from', period.start)
  params.set('to', to < period.start ? period.start : to)
  return `/transactions?${params}`
}

/** The transactions a spending history counts as uncategorised. */
function uncategorisedHref(scope: string, history: SpendingHistoryDto) {
  return `/transactions?${new URLSearchParams({ scope, categoryId: UNCATEGORISED, from: history.from, to: history.to })}`
}

const fixed = (cents: number) => (cents / 100).toFixed(2)
const newTempId = () => Math.random().toString(36).slice(2, 10)
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
const PERSONAL: SectionId[] = ['spending', 'yours', 'joint']

/** The form that is open: adding to a section, or changing the bucket with that key. */
type OpenForm = { add: SectionId } | { change: string } | null

/** Everything under the header: the summary, then a section for each place the pay goes. */
export function PayPage(props: Props) {
  const { planState = 'ready' } = props
  if (planState === 'loading') {
    return (
      <Card aria-busy="true">
        <p className="text-fg-2">Loading this pay…</p>
      </Card>
    )
  }
  if (planState === 'error') {
    return (
      <Card>
        <p role="alert" className="text-fg-2">
          Couldn&apos;t load this pay. Try again in a moment.
        </p>
      </Card>
    )
  }
  // A draft is read from storage only when its component mounts, so each pay gets its own.
  return <PayBody key={`${props.person}:${props.payDate}:${props.standard ? 'standard' : 'pay'}`} {...props} />
}

function PayBody({
  plan,
  accounts,
  goals,
  categories = [],
  spendingHistory,
  budget,
  period,
  jointPeriod,
  jointSetUp,
  standard = null,
  person,
  viewerId,
  payDate,
  thisPaySaverIds,
  onSetUpJoint,
  jointBudget,
  users,
  onSetAnchor,
  onApply,
  onEditingChange,
  actionsSlot,
  LinkComponent = PlainLink,
}: Props) {
  const toast = useToast()
  const canEdit = person === viewerId && (standard ? canEditStandard(budget) : canEditPeriod(budget, period))
  // Standard pay has its own key, which doesn't start with This pay's, so clearing one leaves the other.
  const draftKey = canEdit ? `${standard ? 'budgets-standard' : 'budgets'}:${person}:${payDate}` : null
  const [draft, setDraft] = useDraft<PayDraft | null>(draftKey, null)
  const editing = canEdit && draft !== null
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState<OpenForm>(null)
  const inFlight = useRef(false)

  const viewInput = {
    plan,
    period,
    jointPeriod,
    accounts,
    goals,
    standard: standard ? { hasUsual: standard.hasUsual } : null,
  }
  const view = buildPayView({ ...viewInput, draft: editing ? draft : null })

  useEffect(() => {
    onEditingChange?.(editing)
    return () => onEditingChange?.(false)
  }, [editing, onEditingChange])
  // Not editing means no draft: forget what Discard or Apply left in storage.
  useEffect(() => {
    if (draftKey && draft === null) clearDrafts(draftKey)
  }, [draftKey, draft])

  const buckets = view.sections.flatMap((x) => x.buckets).filter((b) => b.editable)
  // Rows count as changed against what is saved now, so a refetch during an edit moves the comparison with it.
  const saved = buildPayView(viewInput)
  const savedAmount = new Map(
    saved.sections.flatMap((x) => x.buckets).map((b) => [b.key, b.amountCents ?? 0]),
  )
  const changed = editing ? new Set(changedKeys(view, saved)) : new Set<string>()
  const current = editing ? draft : null
  const changes = current ? draftChanges(view, saved, current, payDate, 'every-pay') : null
  const changeCount = changes
    ? changes.savers.set.length +
      changes.savers.remove.length +
      changes.limits.length +
      changes.lines.create.length +
      changes.lines.update.length +
      changes.lines.archive.length
    : 0
  const structural = changes ? isStructural(changes, saved) : false
  const invalid = (b: Bucket) =>
    draft?.texts[b.key] !== undefined && parseDollars(draft.texts[b.key]) === null
  const anyInvalid = buckets.some(invalid)

  const edit = (b: Bucket): RowEdit | null => {
    if (!current) return null
    const amount = b.amountCents ?? 0
    const set = (patch: (d: PayDraft) => PayDraft) => setDraft((d) => (d ? patch(d) : d))
    return {
      // The range comes from where Edit began; a row that wasn't there then uses its saved amount.
      max: sliderMax(current.baseline[b.key] ?? savedAmount.get(b.key) ?? amount, amount),
      text: current.texts[b.key] ?? fixed(amount),
      invalid: invalid(b),
      was: changed.has(b.key) ? (savedAmount.get(b.key) ?? null) : null,
      onMore: () => setOpen({ change: b.key }),
      onSlide: (cents) =>
        set((d) => ({
          ...d,
          amounts: { ...d.amounts, [b.key]: cents },
          texts: { ...d.texts, [b.key]: fixed(cents) },
        })),
      onText: (text) =>
        set((d) => {
          const cents = parseDollars(text)
          return {
            ...d,
            texts: { ...d.texts, [b.key]: text },
            amounts: cents === null ? d.amounts : { ...d.amounts, [b.key]: cents },
          }
        }),
    }
  }

  const apply = async (applyTo: PayChangesInput['applyTo']) => {
    if (!current || inFlight.current) return
    inFlight.current = true
    setPending(true)
    try {
      await onApply(draftChanges(view, saved, current, payDate, applyTo))
      // Cleared straight from storage too, in case the page has gone while the request ran.
      if (draftKey) clearDrafts(draftKey)
      setDraft(null)
      setOpen(null)
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  const patchDraft = (patch: (d: PayDraft) => PayDraft) => setDraft((d) => (d ? patch(d) : d))
  const savedBucket = new Map(saved.sections.flatMap((x) => x.buckets).map((b) => [b.key, b]))

  // Categories already taken, by bucket: personal buckets share one budget, shared limits are Joint's own.
  const takenBy = (section: SectionId, exceptKey?: string) => {
    const group: SectionId[] = section === 'shared' ? ['shared'] : PERSONAL
    const taken = new Map<string, string>()
    for (const s of view.sections) {
      if (!group.includes(s.id)) continue
      for (const b of s.buckets) {
        if (b.key !== exceptKey) for (const id of b.categoryIds) taken.set(id, b.name)
      }
    }
    return taken
  }
  // What ties up a Saver, as the page would have it once the draft is applied.
  const removedLines = new Set((current?.removals ?? []).flatMap((key) => savedBucket.get(key)?.lineId ?? []))
  const activeLines = [
    ...period.lines.filter((l) => !removedLines.has(l.lineId)),
    ...(jointPeriod?.lines ?? []).filter((l) => !removedLines.has(l.lineId)),
    ...(current?.creates ?? []).flatMap((c) =>
      c.saverAccountId && (c.section === 'spending' || c.section === 'shared')
        ? [
            {
              lineId: `new:${c.tempId}`,
              name: c.name,
              kind: 'spending' as const,
              saverAccountId: c.saverAccountId,
            },
          ]
        : [],
    ),
  ]
  // In Standard pay, Savers that only This pay's customised plan has: they look free here but the server counts them.
  const inStandard = new Set(
    view.sections.flatMap((s) => (s.id === 'yours' || s.id === 'joint' ? s.buckets : [])).flatMap((b) => (b.saverAccountId ? [b.saverAccountId] : [])),
  )
  const onlyInThisPay = new Set((thisPaySaverIds ?? []).filter((id) => !inStandard.has(id)))
  const saversFor = (section: SectionId, own?: Bucket) => {
    const ownLine = own ? (own.lineId ?? own.key) : null
    // A limit paid from a Saver is a limit, whichever section its row is in.
    const linked = own?.kind === 'saver' && own.lineKind === 'spending'
    const lines = activeLines.filter((l) => l.lineId !== ownLine)
    const asLimit = linked || section === 'spending'
    const options = saverOptions(linked ? 'spending' : section, view, lines, accounts, viewerId).map((o) =>
      standard && asLimit && !o.disabledReason && onlyInThisPay.has(o.id) ? { ...o, disabledReason: "In this pay's plan" } : o,
    )
    // Its own Saver is in the plan because of it, so it stays choosable.
    const ownSaver = linked ? savedBucket.get(own.key)?.saverAccountId : null
    return options.map((o) => (o.id === ownSaver ? { ...o, disabledReason: null } : o))
  }

  const addBucket = (section: SectionId, v: BucketFormValues) => {
    patchDraft((d) =>
      withCreate(d, {
        tempId: newTempId(),
        section,
        name: v.name,
        amountCents: v.amountCents,
        categoryIds: v.categoryIds,
        saverAccountId: v.saverAccountId,
      }),
    )
    setOpen(null)
  }
  const changeBucket = (b: Bucket, v: BucketFormValues) => {
    patchDraft((d) => {
      if (b.key.startsWith('new:')) {
        const creates = d.creates.map((c) =>
          `new:${c.tempId}` === b.key
            ? { ...c, name: v.name, categoryIds: v.categoryIds, saverAccountId: v.saverAccountId }
            : c,
        )
        return { ...d, creates }
      }
      const before = savedBucket.get(b.key)
      if (!b.lineId || !before) return d
      // Only what differs from what is saved is sent.
      const patch: Partial<LineInputDto> = {}
      if (v.name !== (before.lineName ?? before.name)) patch.name = v.name
      if (!sameSet(v.categoryIds, before.categoryIds)) patch.categoryIds = v.categoryIds
      if (v.saverAccountId !== before.saverAccountId) patch.saverAccountId = v.saverAccountId
      // A limit paid from a Saver has its own amount, separate from what the plan moves.
      if (b.kind === 'saver' && v.amountCents !== before.limitCents) patch.amountCents = v.amountCents
      const updates = { ...d.updates }
      if (Object.keys(patch).length > 0) updates[b.lineId] = patch
      else delete updates[b.lineId]
      return { ...d, updates }
    })
    setOpen(null)
  }
  const removeBucket = (b: Bucket) => {
    patchDraft((d) =>
      b.key.startsWith('new:')
        ? withoutCreate(d, b.key.slice('new:'.length))
        : { ...d, removals: [...d.removals, b.key] },
    )
    setOpen(null)
  }
  const form = editing ? open : null

  const ownScope = person === viewerId ? 'me' : 'partner'
  const historyFor = (section: SectionId) =>
    section === 'spending' ? spendingHistory?.personal : section === 'shared' ? spendingHistory?.joint : undefined
  const categoriseHrefFor = (section: SectionId) => {
    const history = historyFor(section)
    return history ? uncategorisedHref(section === 'shared' ? 'joint' : ownScope, history) : undefined
  }
  const paceOf = (p: BudgetPeriodDto | null) =>
    p?.isCurrent && p.daysTotal > 0 ? (p.daysElapsed / p.daysTotal) * 100 : null
  const pacePercent = paceOf(period)
  // Shared limits run on the joint period's days, and a past pay shows no pace at all.
  const sharedPacePercent = period.isCurrent ? paceOf(jointPeriod) : null

  const hrefFor = (b: Bucket): string | null => {
    switch (b.kind) {
      case 'saver':
        return b.saverAccountId ? `/accounts/${b.saverAccountId}` : null
      case 'plain':
        return null
      case 'shared-limit':
      case 'shared-other':
        return jointPeriod
          ? transactionsHref('joint', jointPeriod, b.kind === 'shared-limit' ? b.categoryIds : undefined)
          : null
      case 'other':
        return transactionsHref(ownScope, period)
      default:
        return transactionsHref(ownScope, period, b.categoryIds)
    }
  }

  // Standard pay's usual figure for a row: none without enough pays, and none for a limit not yet applied.
  const usualOf = (section: SectionId, b: Bucket): 'shown' | 'hidden' | undefined => {
    if (!standard) return undefined
    if (b.key.startsWith('new:')) return 'hidden'
    return (section === 'shared' ? standard.jointHasUsual : standard.hasUsual) ? 'shown' : 'hidden'
  }

  const jointDiffers =
    jointPeriod && (jointPeriod.start !== period.start || lastDay(jointPeriod) !== lastDay(period))
  const jointNote =
    jointPeriod && jointDiffers && !standard
      ? `Joint pay ${shortDate(jointPeriod.start)} – ${shortDate(lastDay(jointPeriod))}`
      : undefined

  return (
    <>
      {editing ? (
        <EditBar
          view={view}
          changeCount={changeCount}
          structural={structural}
          pending={pending}
          canApply={changeCount > 0 && !anyInvalid && !pending}
          onDiscard={() => {
            setDraft(null)
            setOpen(null)
          }}
          headline={standard ? standardHeadline(view, standard.hasUsual) : undefined}
          everyPayOnly={Boolean(standard)}
          onApplyOnce={() => void apply('this-pay')}
          onApplyAll={() => void apply('every-pay')}
        />
      ) : (
        canEdit &&
        (() => {
          const button = <Button onClick={() => setDraft(startDraft(buildPayView(viewInput)))}>Edit</Button>
          return actionsSlot ? (
            createPortal(button, actionsSlot)
          ) : (
            <div className="flex justify-end">{button}</div>
          )
        })()
      )}
      <PaySummary view={view} period={period} payDate={payDate} standard={standard} />
      {/* Without Joint there is nothing to add to; the prompt below stands in for the shared section. */}
      {view.sections
        .filter((s) => jointSetUp || s.id !== 'shared')
        .map((s) => (
          <BucketSection
            key={s.id}
            label={s.label}
            color={SECTION_COLORS[s.id]}
            totalCents={
              s.id === 'shared' && !s.buckets.some((b) => b.kind === 'shared-limit')
                ? undefined
                : s.totalCents
            }
            totalNote={s.id === 'shared' ? 'a fortnight' : 'per pay'}
            footer={
              s.id === 'spending' ? (
                <li
                  data-testid="spending-total"
                  className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-x-3 gap-y-2 border-t border-line-2 bg-sunken px-4 py-2.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_112px] sm:gap-x-6"
                >
                  <div className="order-1 font-semibold text-fg">
                    Total
                    {view.movedBackCents > 0 && (
                      <div className="type-caption num font-medium text-fg-3">{`${standard ? 'usually includes' : 'includes'} ${money(view.movedBackCents)} moved back from Savers`}</div>
                    )}
                  </div>
                  <div className="type-label num order-3 col-span-2 flex flex-wrap justify-between gap-x-3 font-semibold sm:order-2 sm:col-span-1">
                    {standard ? (
                      <>
                        <span className="text-fg">
                          {standard.hasUsual
                            ? `${money(standardHeadline(view, true).cents)} usually left over`
                            : `${money(standardHeadline(view, false).cents)} left after limits`}
                        </span>
                        {standard.hasUsual && (
                          <span className="text-fg-3">{`${money(view.spentCents)} usually spent`}</span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-fg">{`${money(view.leftToSpendCents)} ${period.isCurrent ? 'left to spend' : 'left over'}`}</span>
                        <span className="text-fg-3">{`${money(view.spentCents)} spent`}</span>
                      </>
                    )}
                  </div>
                  <Money
                    cents={view.spendingMoneyCents}
                    className="type-heading order-2 text-right sm:order-3"
                  />
                </li>
              ) : undefined
            }
            note={s.id === 'shared' ? jointNote : undefined}
            add={
              editing
                ? {
                    onAdd: () => setOpen({ add: s.id }),
                    open:
                      form && 'add' in form && form.add === s.id ? (
                        <BucketForm
                          section={s.id}
                          categories={categories}
                          savers={saversFor(s.id)}
                          taken={takenBy(s.id)}
                          history={historyFor(s.id)}
                          categoriseHref={categoriseHrefFor(s.id)}
                          LinkComponent={LinkComponent}
                          onSave={(v) => addBucket(s.id, v)}
                          onCancel={() => setOpen(null)}
                        />
                      ) : null,
                  }
                : undefined
            }
          >
            {s.buckets.map((b) =>
              form && 'change' in form && form.change === b.key ? (
                <li key={b.key} className="border-t border-line first:border-t-0">
                  <BucketForm
                    section={s.id}
                    bucket={b}
                    categories={categories}
                    savers={saversFor(s.id, b)}
                    taken={takenBy(s.id, b.key)}
                    onSave={(v) => changeBucket(b, v)}
                    onRemove={() => removeBucket(b)}
                    onCancel={() => setOpen(null)}
                  />
                </li>
              ) : (
                <BucketRow
                  key={b.key}
                  bucket={b}
                  edit={edit(b)}
                  href={hrefFor(b)}
                  pacePercent={b.kind === 'shared-limit' ? sharedPacePercent : pacePercent}
                  usual={usualOf(s.id, b)}
                  LinkComponent={LinkComponent}
                />
              ),
            )}
            {s.id === 'shared' && editing && jointBudget && users && onSetAnchor && (
              <li className="border-t border-line px-4 py-3">
                <AnchorPicker
                  users={users}
                  anchorUserId={jointBudget.anchorUserId}
                  onChange={(id) =>
                    void onSetAnchor(id).catch((err: unknown) => toast(errorMessage(err), 'error'))
                  }
                />
              </li>
            )}
          </BucketSection>
        ))}
      {!jointSetUp && (
        <BucketSection label="Shared spending limits" color={SECTION_COLORS.shared}>
          <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <span className="text-fg-2">
              Joint isn&apos;t set up yet, so there are no shared limits to show.
            </span>
            <Button variant="secondary" onClick={onSetUpJoint}>
              Set up Joint
            </Button>
          </li>
        </BucketSection>
      )}
    </>
  )
}
