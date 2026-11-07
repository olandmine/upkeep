import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { levelAllows } from '../../shared/sharing'
import type { AccountDto, BudgetDto, PayCandidateDto, PayChangesInput, PayEventDto, PlanItemInput } from '../../shared/types'
import { SearchLink } from '../components/AppLink'
import { PayPage } from '../components/budgets/PayPage'
import { PayPills } from '../components/budgets/PayPills'
import { PayViewToggle } from '../components/budgets/PayViewToggle'
import { PeriodHeader } from '../components/budgets/PeriodHeader'
import { SetupWizard } from '../components/budgets/SetupWizard'
import { PrivateNotice } from '../components/sharing/PrivateNotice'
import { Page } from '../components/shell/PageHeader'
import { Card } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { client, errorMessage, unwrap } from '../lib/api'
import { planStateOf } from '../lib/plan-state'
import {
  accountsQuery,
  budgetPeriodQuery,
  budgetsQuery,
  categoriesQuery,
  goalsQuery,
  meQuery,
  payPlanQuery,
  spendingHistoryQuery,
  standardPayQuery,
  usersQuery,
} from '../lib/queries'
import { usePartnerSharing } from '../lib/sharing'

interface BudgetsSearch {
  person?: string
  date?: string
  view?: 'standard'
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)

export const Route = createFileRoute('/_app/budgets')({
  validateSearch: (s: Record<string, unknown>): BudgetsSearch => ({ person: str(s.person), date: date(s.date), view: s.view === 'standard' ? 'standard' : undefined }),
  component: BudgetsPage,
})

/** Savers a budget's lines may link: the owner's own Savers, or joint Savers for Joint. */
function linkableSavers(budget: BudgetDto, accounts: AccountDto[]) {
  return accounts.filter(
    (a) =>
      a.accountType === 'SAVER' &&
      (budget.kind === 'joint' ? a.ownership === 'JOINT' : a.ownership === 'INDIVIDUAL' && a.ownerUserId === budget.ownerUserId),
  )
}

function BudgetsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const toast = useToast()
  /** Keeps the wizard open after marking pay (which makes the budget "ready") until it finishes. */
  const [wizardFor, setWizardFor] = useState<string | null>(null)
  /** True while amounts are being edited, which locks the controls that change the pay on screen. */
  const [editing, setEditing] = useState(false)
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null)

  const sharing = usePartnerSharing()
  const { data: me } = useQuery(meQuery)
  const { data: users = [] } = useQuery(usersQuery)
  const { data: budgets = [] } = useQuery(budgetsQuery)
  const { data: categories = [] } = useQuery(categoriesQuery)
  const { data: accounts = [] } = useQuery(accountsQuery('everyone'))
  const { data: goals = [] } = useQuery({ ...goalsQuery('everyone'), select: (d) => d.goals })

  const person = search.person ?? me?.id
  const partner = users.find((u) => u.id !== me?.id)
  // The partner's pay when their sharing level keeps it from you: no budget, period or plan is asked for.
  const hidden = Boolean(partner && person === partner.id && sharing && !levelAllows(sharing.level, 'finances'))
  const budget = hidden ? undefined : budgets.find((b) => b.kind === 'personal' && b.ownerUserId === person)
  const joint = budgets.find((b) => b.kind === 'joint')
  const ready = budget?.setup === 'ready'
  const jointReady = joint?.setup === 'ready'

  // The wizard runs for your own budget or Joint; someone else's unset budget just says so.
  const personalWizard =
    budget && !ready && (budget.ownerUserId === me?.id || budget.setup === 'partner-not-connected') ? budget : undefined
  const wizardBudget = budgets.find((b) => b.id === wizardFor) ?? personalWizard
  const { data: candidates = [] } = useQuery({
    queryKey: ['pay-candidates'],
    queryFn: () => unwrap<PayCandidateDto[]>(client.api['pay-candidates'].$get()),
    enabled: Boolean(wizardBudget?.kind === 'personal' && wizardBudget.setup !== 'partner-not-connected'),
  })
  const { data: proposal } = useQuery({
    queryKey: ['plan-proposal'],
    queryFn: () =>
      unwrap<{ expectedIncomeCents: number; items: PlanItemInput[] } | null>(client.api['plan-template']['from-last-pay'].$post()),
    enabled: Boolean(wizardFor && wizardBudget?.id === wizardFor && wizardBudget.kind === 'personal'),
  })

  const { data: period, isError } = useQuery({
    ...budgetPeriodQuery(budget?.id ?? '', search.date),
    enabled: Boolean(budget && ready),
  })
  const { data: plan, isLoading: planLoading, isError: planError } = useQuery({
    ...payPlanQuery(person ?? '', period?.start ?? ''),
    enabled: Boolean(person && period),
  })
  // Joint periods follow the anchor's pay: the current pay shows the one running today, a past pay the one its start falls in.
  const { data: jointPeriod, isLoading: jointLoading } = useQuery({
    ...budgetPeriodQuery(joint?.id ?? '', period?.isCurrent ? undefined : period?.start),
    enabled: Boolean(joint && jointReady && period),
  })

  // Only Edit mode adds buckets, and it's only ever your own pay.
  const { data: personalHistory } = useQuery({ ...spendingHistoryQuery(budget?.id ?? ''), enabled: Boolean(editing && budget) })
  const { data: jointHistory } = useQuery({ ...spendingHistoryQuery(joint?.id ?? ''), enabled: Boolean(editing && joint && jointReady) })

  // Whether there is a Standard pay to offer, so the toggle knows whether to appear.
  const standardQuery = useQuery({ ...standardPayQuery(person ?? ''), enabled: Boolean(person && ready) })
  const standardData = standardQuery.data ?? null
  const showStandard = search.view === 'standard' && standardData !== null

  // Savers in This pay's plan, which Standard pay can't offer to a limit when its own plan lacks them.
  const thisPaySaverIds = (plan?.items ?? []).flatMap((i) =>
    i.targetKind === 'buffer' ? [] : (i.targetKind === 'saver' ? i.saverAccountId : i.resolvedSaverId) ?? [],
  )

  const go = (next: BudgetsSearch) => void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })
  const refresh = () =>
    Promise.all(
      [['budget-period'], ['pay-plan'], ['standard-pay'], ['plan-template'], ['budgets']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    )
  const mutation = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => refresh(),
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const onApply = async (changes: PayChangesInput) => {
    await unwrap(client.api.budgets['pay-changes'].$put({ json: changes }))
    await refresh()
    toast(changes.applyTo === 'every-pay' ? 'Applied to every pay' : 'Applied to this pay', 'success')
  }

  const wizard = wizardBudget && (
    <SetupWizard
      key={wizardBudget.id}
      budget={wizardBudget}
      users={users}
      candidates={candidates}
      savers={linkableSavers(wizardBudget, accounts)}
      categories={categories}
      proposal={
        proposal && wizardBudget.kind === 'personal'
          ? {
              expectedIncomeCents: proposal.expectedIncomeCents,
              items: proposal.items.map((i) => ({
                ...i,
                targetName:
                  (i.lineId ? period?.lines.find((l) => l.lineId === i.lineId)?.name : undefined) ??
                  accounts.find((a) => a.id === i.saverAccountId)?.displayName ??
                  'Saver',
              })),
            }
          : null
      }
      onMarkPay={async (transactionId) => {
        try {
          await unwrap(client.api['pay-schedule'].$put({ json: { transactionId } }))
        } catch (err) {
          toast(errorMessage(err), 'error')
          throw err
        }
        setWizardFor(wizardBudget.id)
        const events = await unwrap<PayEventDto[]>(client.api['pay-events'].$get({ query: { userId: me!.id } }))
        await refresh()
        return { count: events.length, since: events.at(-1)?.payDate ?? null }
      }}
      onSetAnchor={async (anchorUserId) => {
        await mutation.mutateAsync(() =>
          unwrap(client.api.budgets[':id'].$patch({ param: { id: wizardBudget.id }, json: { anchorUserId } })),
        )
      }}
      onCreateLines={async (inputs) => {
        setWizardFor(wizardBudget.id)
        try {
          for (const json of inputs) await unwrap(client.api.budgets[':id'].lines.$post({ param: { id: wizardBudget.id }, json }))
        } catch (err) {
          toast(errorMessage(err), 'error')
          throw err
        } finally {
          await refresh()
          await queryClient.invalidateQueries({ queryKey: ['plan-proposal'] })
        }
      }}
      onSavePlan={async (planInput) => {
        await mutation.mutateAsync(() => unwrap(client.api['plan-template'].$put({ json: planInput })))
      }}
      onDone={() => {
        setWizardFor(null)
        void refresh()
      }}
    />
  )

  const pills = [
    { id: me?.id, label: 'Your pay' },
    ...(partner ? [{ id: partner.id, label: `${partner.displayName}'s pay` }] : []),
  ]
  // With view=standard, the Standard pay's own request decides the loading and error messages until it has answered.
  const planState = showStandard
    ? 'ready'
    : search.view === 'standard' && standardQuery.data === undefined
      ? planStateOf({ isLoading: standardQuery.isLoading, isError: standardQuery.isError, hasData: false }, false)
      : planStateOf({ isLoading: planLoading, isError: planError, hasData: plan !== undefined }, jointLoading)
  // A failed request keeps the toggle too, so the person can get back to This pay.
  const standardFailed = search.view === 'standard' && standardQuery.isError && standardQuery.data === undefined
  const showToggle = Boolean(ready && !wizardBudget && (standardData || standardFailed))

  return (
    <Page title="Budgets" showScope={false} actions={<div ref={setActionsSlot} />}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <PayPills
          pills={pills}
          person={person}
          disabled={editing}
          onSelect={(id) => {
            setWizardFor(null)
            go({ person: id === me?.id ? undefined : id, date: undefined })
          }}
        />
        {/* The toggle stays put as it switches: last on its row, and above the period when they wrap. */}
        <div className="flex w-full flex-wrap-reverse items-center justify-end gap-x-4 gap-y-3 lg:w-auto">
          {showStandard && standardData && !wizardBudget && (
            <span className="type-caption flex min-h-8 items-center text-fg-3">
              {standardData.hasUsual ? `Based on your last ${standardData.payCount} finished pays` : 'Not enough finished pays yet'}
            </span>
          )}
          {period && !wizardBudget && !showStandard && (
            <PeriodHeader
              period={period}
              onPrev={() => period.prevDate && go({ date: period.prevDate })}
              onNext={() => period.nextDate && go({ date: period.nextDate })}
              disabled={editing}
            />
          )}
          {showToggle && (
            <PayViewToggle
              value={search.view === 'standard' ? 'standard' : 'this'}
              locked={editing}
              onChange={(v) => go({ view: v === 'standard' ? 'standard' : undefined })}
            />
          )}
        </div>
      </div>
      {hidden && <PrivateNotice needs="finances" />}
      {wizard}
      {budget && !ready && !wizardBudget && (
        <Card>
          <p className="text-fg-2">{`${budget.name} hasn't marked their pay yet.`}</p>
        </Card>
      )}
      {budget && ready && !wizardBudget && isError && !period && (
        <Card>
          <p className="text-fg-2">No pay periods yet.</p>
        </Card>
      )}
      {budget && period && !wizardBudget && me && person && (
        <PayPage
          plan={(showStandard ? standardData.plan : plan) ?? null}
          standard={showStandard ? standardData : null}
          thisPaySaverIds={showStandard ? thisPaySaverIds : undefined}
          planState={planState}
          accounts={accounts}
          goals={goals}
          budget={budget}
          period={showStandard ? standardData.period : period}
          jointPeriod={(showStandard ? standardData.jointPeriod : jointPeriod) ?? null}
          jointSetUp={jointReady}
          person={person}
          viewerId={me.id}
          payDate={showStandard ? standardData.plan.payDate : (plan?.payDate ?? period.start)}
          onSetUpJoint={() => joint && setWizardFor(joint.id)}
          categories={categories}
          spendingHistory={{ personal: personalHistory, joint: jointHistory }}
          users={users}
          jointBudget={jointReady ? joint : undefined}
          onSetAnchor={async (anchorUserId) => {
            if (!joint) return
            await unwrap(client.api.budgets[':id'].$patch({ param: { id: joint.id }, json: { anchorUserId } }))
            await refresh()
          }}
          onApply={onApply}
          onEditingChange={setEditing}
          actionsSlot={actionsSlot}
          LinkComponent={SearchLink}
        />
      )}
    </Page>
  )
}
