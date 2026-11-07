import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { DebtDto, DebtInputDto, HelpDebtInputDto, HelpImportSummaryDto } from '../../shared/types'
import { RouterLink } from '../components/AppLink'
import { money } from '../components/budgets/format'
import { DebtCard } from '../components/debts/DebtCard'
import { DebtForm } from '../components/debts/DebtForm'
import { monthLabel } from '../components/debts/format'
import { PayoffPlan } from '../components/debts/PayoffPlan'
import { PrivateNotice } from '../components/sharing/PrivateNotice'
import { Page } from '../components/shell/PageHeader'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { client, errorMessage, unwrap } from '../lib/api'
import { useDraft } from '../lib/draft'
import { debtsQuery, invalidateAfterDebtEdit, meQuery, payoffPlanQuery } from '../lib/queries'
import { useScope } from '../lib/scope'
import { usePartnerHides } from '../lib/sharing'

export const Route = createFileRoute('/_app/debts/')({
  component: DebtsPage,
})

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="type-label text-fg-2">{label}</p>
      <p className="type-kpi num mt-1 text-fg">{value}</p>
    </Card>
  )
}

function DebtsPage() {
  const [scope] = useScope()
  // Their debts may just be hidden, so "none yet" would be untrue; in Partner scope nothing else belongs.
  const hidden = usePartnerHides('finances', scope)
  const replaced = hidden && scope === 'partner'
  const queryClient = useQueryClient()
  const toast = useToast()
  // Kept so a phone reloading the page comes back to the half-filled form.
  const [adding, setAdding] = useDraft('debts:adding', false)
  const { data: me } = useQuery(meQuery)
  const debts = useQuery(debtsQuery(scope))
  const plan = useQuery(payoffPlanQuery(scope))

  const create = useMutation({
    mutationFn: (input: DebtInputDto) => unwrap(client.api.debts.$post({ json: input })),
    onSuccess: async () => {
      setAdding(false)
      await invalidateAfterDebtEdit(queryClient)
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const createFromStatement = useMutation({
    mutationFn: (input: HelpDebtInputDto) => unwrap<DebtDto>(client.api.debts.statement.$post({ json: input })),
    onSuccess: async (debt) => {
      setAdding(false)
      toast(`Added ${debt.name} from the ATO statement.`)
      await invalidateAfterDebtEdit(queryClient)
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const settings = useMutation({
    mutationFn: (body: { extraCents: number; includeHecs: boolean }) =>
      unwrap(client.api['payoff-plan'].$put({ query: { scope }, json: body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payoff-plan'] }),
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const asIs = plan.data?.scenarios.find((s) => s.strategy === 'as-is')
  const owed = (debts.data ?? []).reduce((sum, d) => sum + d.balanceCents, 0)

  return (
    <Page
      title="Debts"
      actions={
        !adding &&
        !replaced && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus aria-hidden size={16} />
            Add debt
          </Button>
        )
      }
    >
      <PrivateNotice needs="finances" scope={scope} />
      {adding && me && !replaced && (
        <Card>
          <CardHeader title="Add debt" />
          <DebtForm
            me={me}
            onSave={(input) => create.mutateAsync(input).then(() => {})}
            onPreviewStatement={(csv) =>
              unwrap<HelpImportSummaryDto>(client.api.debts.statement.preview.$post({ json: { csv } }))
            }
            onSaveStatement={(input) => createFromStatement.mutateAsync(input).then(() => {})}
            onCancel={() => setAdding(false)}
          />
        </Card>
      )}

      {debts.data && debts.data.length === 0 && !adding && !hidden && (
        <Card>
          <p className="text-fg-2">No debts yet. Add one to see when it&rsquo;ll be paid off.</p>
        </Card>
      )}

      {!replaced && debts.data && debts.data.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label="Total owed" value={money(owed)} />
            <Tile
              label="Debt-free"
              value={
                !asIs
                  ? '—'
                  : asIs.debts.length === 0
                    ? 'Now'
                    : asIs.debtFreeMonth
                      ? monthLabel(asIs.debtFreeMonth)
                      : 'Never'
              }
            />
            <Tile label="Interest to pay" value={asIs ? money(asIs.totalInterestCents) : '—'} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {debts.data.map((d) => (
              <DebtCard key={d.id} debt={d} showOwner={scope === 'everyone'} LinkComponent={RouterLink} />
            ))}
          </div>
          {plan.data && <PayoffPlan plan={plan.data} onChange={(body) => settings.mutate(body)} />}
        </>
      )}
    </Page>
  )
}
