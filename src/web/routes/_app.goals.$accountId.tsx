import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GoalDetailDto, GoalDto, GoalKind, GoalRange } from '../../shared/types'
import { money, shortDate } from '../components/budgets/format'
import { monthLabel } from '../components/debts/format'
import { GoalChart } from '../components/goals/GoalChart'
import { GOAL_KINDS, GoalForm } from '../components/goals/GoalForm'
import { GoalPlan } from '../components/goals/GoalPlan'
import { Figure } from '../components/goals/GoalsList'
import { GOAL_STATUS_TONES } from '../components/goals/format'
import { GOAL_RANGES, targetName } from '../components/goals/goal-chart'
import { perOf, planLine } from '../components/goals/plan'
import { ReachedActions } from '../components/goals/ReachedActions'
import { nextStepText } from '../components/goals/summary'
import { useGoalActions } from '../components/goals/useGoalActions'
import { PrivateNotice } from '../components/sharing/PrivateNotice'
import { Page } from '../components/shell/PageHeader'
import { TransactionTable } from '../components/transactions/TransactionTable'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { ApiError } from '../lib/api'
import { cn } from '../lib/cn'
import { goalDebtsQuery, goalDetailQuery } from '../lib/queries'
import { keepScope } from '../lib/scope'

export const Route = createFileRoute('/_app/goals/$accountId')({
  validateSearch: (s: Record<string, unknown>): { range?: GoalRange } => ({
    range: GOAL_RANGES.some((r) => r.value === s.range) ? (s.range as GoalRange) : undefined,
  }),
  // /goals/a to /goals/b is the same component: without this its form, slider and tables carry over.
  remountDeps: ({ params }) => params,
  component: GoalPage,
})

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
const INLINE_LINK = `rounded-sm text-accent underline underline-offset-2 hover:decoration-2 ${FOCUS_RING}`

function BackLink() {
  return (
    <Link
      to="/goals"
      search={keepScope}
      className={cn('type-label rounded-sm text-fg-2 hover:text-fg', FOCUS_RING)}
    >
      ‹ Goals
    </Link>
  )
}

/** 'Reach by 31 Dec', with the year when it isn't the goal's own: a 2028 date would read as next February. */
function reachBy(g: GoalDto, date: string): string {
  const year = date.slice(0, 4)
  return `Reach by ${shortDate(date)}${year === g.today.slice(0, 4) ? '' : ` ${year}`}`
}

/**
 * The lines under the figures: the date this goal is heading for, or else what to do next. Reach by doesn't say
 * behind, so a behind goal (and an on-track one, for its amount) has its next step beneath it in its status colour;
 * every other status's next step is already the line.
 */
function dateFigure(g: GoalDto): { text: string; tone: string }[] {
  const plain = 'text-fg-2'
  const tone = g.status ? GOAL_STATUS_TONES[g.status] : plain
  if (!g.goal) return []
  if (g.status === 'projected' && g.projectedDate) {
    const month = monthLabel(g.projectedDate)
    return [{ text: g.goal.kind === 'debt' ? `Covered by ${month}` : `At this rate, ${month}`, tone: plain }]
  }
  if (g.goal.targetDate && (g.status === 'on-track' || g.status === 'behind')) {
    return [
      { text: reachBy(g, g.goal.targetDate), tone: plain },
      { text: nextStepText(g), tone },
    ]
  }
  return [{ text: nextStepText(g), tone }]
}

function Figures({ detail }: { detail: GoalDetailDto }) {
  const g = detail.goal
  const showToGo = g.goal && g.goal.kind !== 'buffer' && g.status !== 'reached' && g.toGoCents != null
  const lines = dateFigure(g).filter((l) => l.text)
  return (
    <Card className="p-4">
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        <Figure label="Saved" value={money(g.balanceCents)} />
        {g.goal && <Figure label={targetName(detail)} value={money(g.goal.targetCents)} />}
        {showToGo && (
          <Figure label={g.goal?.kind === 'debt' ? 'Gap' : 'To go'} value={money(g.toGoCents ?? 0)} />
        )}
      </div>
      {lines.map((l) => (
        <p key={l.text} className={cn('type-label mt-3', l.tone)}>
          {l.text}
        </p>
      ))}
    </Card>
  )
}

function PanelRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-line py-2">
      <dt className="type-body text-fg-2">{label}</dt>
      <dd className="num type-body text-fg">{children}</dd>
    </div>
  )
}

function DebtPanel({ goal: g, debt }: { goal: GoalDto; debt: NonNullable<GoalDetailDto['debt']> }) {
  return (
    <Card aria-labelledby="goal-debt" className="p-4">
      <CardHeader id="goal-debt" title="The debt it follows" />
      <p className="type-body mb-2">
        <Link to="/debts/$debtId" params={{ debtId: debt.id }} search={keepScope} className={INLINE_LINK}>
          {debt.name}
        </Link>
      </p>
      <dl>
        <PanelRow label="Left now">{money(debt.leftCents)}</PanelRow>
        <PanelRow label="When you set this">{money(debt.startTargetCents)}</PanelRow>
        <PanelRow label="Falling lately">
          {debt.fallCents > 0 ? `${money(debt.fallCents)} ${perOf(g)}` : 'Not falling lately'}
        </PanelRow>
        {!g.debt?.paidOff && debt.nextDue && (
          <PanelRow label="Next repayment">{shortDate(debt.nextDue)}</PanelRow>
        )}
      </dl>
    </Card>
  )
}

type Month = GoalDetailDto['months'][number]

function MonthSummary({ month }: { month: Month }) {
  return (
    <>
      <span className="type-body min-w-0 flex-1 text-fg">{monthLabel(month.month)}</span>
      <span className="num type-body text-fg-2">{`In ${money(month.inCents)}`}</span>
      <span className="num type-body text-fg-2">{`Out ${money(month.outCents)}`}</span>
    </>
  )
}

const MONTH_ROW =
  'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-raised px-4 py-3'

/** Its rows load only while it's open, so a year of months doesn't fetch twelve tables. */
function MonthDetails({ accountId, month, newest }: { accountId: string; month: Month; newest: boolean }) {
  const [open, setOpen] = useState(newest)
  const filters = useMemo(
    () => ({ accountId, from: month.fromIso, to: month.toIso }),
    [accountId, month.fromIso, month.toIso],
  )
  return (
    <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={cn(MONTH_ROW, FOCUS_RING, 'cursor-pointer list-none hover:bg-elevated')}>
        <ChevronRight
          aria-hidden
          size={14}
          className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-90"
        />
        <MonthSummary month={month} />
      </summary>
      {open && (
        <div className="mt-2">
          <TransactionTable filters={filters} emptyText={null} />
        </div>
      )}
    </details>
  )
}

function MoneyInAndOut({ detail }: { detail: GoalDetailDto }) {
  const { months, transactionsHidden, goal } = detail
  return (
    <section aria-labelledby="goal-money" className="flex flex-col gap-3">
      <h2 id="goal-money" className="type-heading">
        Money in and out
      </h2>
      {transactionsHidden && <PrivateNotice needs="transactions" />}
      {months.length === 0 && (
        <Card className="p-4">
          <p className="type-body text-fg-3">No money in or out in this range.</p>
        </Card>
      )}
      {months.length > 0 && (
        <ul className="flex flex-col gap-2">
          {months.map((m, i) => (
            <li key={m.month}>
              {transactionsHidden ? (
                <div className={MONTH_ROW}>
                  <MonthSummary month={m} />
                </div>
              ) : (
                <MonthDetails accountId={goal.accountId} month={m} newest={i === 0} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function GoalPage() {
  const { accountId } = Route.useParams()
  const { range = '6m' } = Route.useSearch()
  const navigate = useNavigate()
  // The last range stays on screen, with the range buttons under focus, until the next one arrives.
  const query = useQuery({
    ...goalDetailQuery(accountId, range),
    placeholderData: (prev) => (prev?.goal.accountId === accountId ? prev : undefined),
  })
  const { error, isError } = query
  // A range that fails has no placeholder to fall back on, so the page holds on to the last one that loaded.
  const [lastLoaded, setLastLoaded] = useState(query.data)
  if (query.data && query.data !== lastLoaded) setLastLoaded(query.data)
  const data = query.data ?? (lastLoaded?.goal.accountId === accountId ? lastLoaded : undefined)
  const { save, remove, markSeen, setNewTarget, archive } = useGoalActions()
  // Opening the page records a celebration as seen, once per goal and reached date, however often this re-renders or refetches.
  const seen = useRef(new Set<string>())
  const celebrate = data?.goal.celebrate
  const reachedOn = data?.goal.reachedOn
  useEffect(() => {
    const key = `${accountId}:${reachedOn}`
    if (!celebrate || seen.current.has(key)) return
    seen.current.add(key)
    markSeen.mutate(accountId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `markSeen` is a new object each render and isn't a trigger.
  }, [accountId, celebrate, reachedOn])
  const [editing, setEditing] = useState(false)
  const [editKind, setEditKind] = useState<GoalKind>('save')
  // The debts a Saver can follow matter only while its form is open on the debt kind.
  const debts = useQuery({ ...goalDebtsQuery(accountId), enabled: editing && editKind === 'debt' })

  // A 404 wins over data already on screen: it can mean the owner has since hidden this Saver.
  if (error instanceof ApiError && error.status === 404) {
    return (
      <Page title="Goal" showScope={false}>
        <p className="type-body text-fg-2">Goal not found.</p>
        <div>
          <BackLink />
        </div>
      </Page>
    )
  }
  if (!data) {
    return (
      <Page title="Goal" showScope={false}>
        <div>
          <BackLink />
        </div>
        {isError && <p className="type-body text-negative">Couldn&apos;t load this goal.</p>}
      </Page>
    )
  }

  const g = data.goal
  const close = () => setEditing(false)
  const startEdit = () => {
    setEditKind(g.goal?.kind ?? 'save')
    setEditing(true)
  }
  const kindLabel = GOAL_KINDS.find((k) => k.kind === g.goal?.kind)?.label
  // GoalPlan draws nothing for someone who can't edit when nothing is planned, which would leave a bare heading.
  const showPlan = g.goal && g.status !== 'reached' && (g.canEdit || planLine(g) !== null)

  return (
    <Page
      title={g.goal?.name ?? g.saverName ?? 'Goal'}
      showScope={false}
      actions={
        g.canEdit && !editing && <Button onClick={startEdit}>{g.goal ? 'Edit goal' : 'Set goal'}</Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <BackLink />
        {g.goal && g.saverName && <Badge>{g.saverName}</Badge>}
        {kindLabel && <Badge>{kindLabel}</Badge>}
      </div>
      {editing && (
        <Card>
          <CardHeader title={g.goal ? `Edit ${g.goal.name}` : `Goal for ${g.saverName}`} />
          <GoalForm
            goal={g.goal}
            followedDebtId={g.debt?.id}
            debts={debts.data}
            onKindChange={setEditKind}
            saverName={g.saverName ?? ''}
            onSave={(body) => save.mutate({ accountId, body }, { onSuccess: close })}
            onRemove={
              g.goal && !g.goal.isDefault ? () => remove.mutate(accountId, { onSuccess: close }) : undefined
            }
            onCancel={close}
          />
        </Card>
      )}
      <Figures detail={data} />
      <ReachedActions
        goal={g}
        onNewTarget={(targetCents) => setNewTarget.mutateAsync({ accountId, targetCents })}
        onArchive={() =>
          archive.mutate(accountId, { onSuccess: () => void navigate({ to: '/goals', search: keepScope }) })
        }
      />
      <Card className="flex flex-col gap-3 p-4">
        {isError && data.range !== range && (
          <p className="type-body text-negative">Couldn&apos;t load this range.</p>
        )}
        <GoalChart
          detail={data}
          range={range}
          onRange={(next) =>
            void navigate({
              to: '.',
              search: ((prev: Record<string, unknown>) => ({
                ...prev,
                range: next === '6m' ? undefined : next,
              })) as never,
              replace: true,
            })
          }
        />
      </Card>
      {data.debt && <DebtPanel goal={g} debt={data.debt} />}
      {showPlan && (
        <Card aria-labelledby="goal-plan" className="p-4">
          <CardHeader id="goal-plan" title={g.plan && g.plan.mineCents === 0 ? 'The plan' : 'Your plan'} />
          <GoalPlan goal={g} alwaysOpen />
        </Card>
      )}
      <MoneyInAndOut detail={data} />
    </Page>
  )
}
