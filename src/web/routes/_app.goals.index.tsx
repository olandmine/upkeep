import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { todayIso } from '../components/debts/DebtForm'
import { GoalForm } from '../components/goals/GoalForm'
import { GoalsList } from '../components/goals/GoalsList'
import { useGoalActions } from '../components/goals/useGoalActions'
import { Page } from '../components/shell/PageHeader'
import { PrivateNotice } from '../components/sharing/PrivateNotice'
import { Card, CardHeader } from '../components/ui/Card'
import type { GoalKind } from '../../shared/types'
import { goalDebtsQuery, goalsQuery } from '../lib/queries'
import { useScope } from '../lib/scope'
import { usePartnerHides } from '../lib/sharing'

export const Route = createFileRoute('/_app/goals/')({
  component: GoalsPage,
})

function GoalsPage() {
  const [scope] = useScope()
  // Their Savers may just be hidden, so "none here" would be untrue; in Partner scope nothing else belongs.
  const hidden = usePartnerHides('finances', scope)
  const replaced = hidden && scope === 'partner'
  const { data } = useQuery(goalsQuery(scope))
  const goals = data?.goals
  const { save, remove, markSeen, setNewTarget, archive, deleteArchived } = useGoalActions()
  const [editing, setEditing] = useState<string | null>(null)
  const [editKind, setEditKind] = useState<GoalKind>('save')
  const startEdit = (accountId: string, kind: GoalKind) => {
    setEditing(accountId)
    setEditKind(kind)
  }
  // The debts a Saver can follow matter only while its form is open on the debt kind.
  const debts = useQuery({ ...goalDebtsQuery(editing ?? ''), enabled: editing !== null && editKind === 'debt' })
  const close = () => setEditing(null)

  return (
    <Page title="Goals">
      <PrivateNotice needs="finances" scope={scope} />
      {!hidden && goals && goals.length === 0 && (
        <Card>
          <p className="text-fg-2">No Savers here yet. Goals sit on Up Savers.</p>
        </Card>
      )}
      {!replaced && goals && (
        <GoalsList
          goals={goals}
          archived={data?.archived ?? []}
          today={todayIso()}
          editingId={editing}
          onEdit={(g) => startEdit(g.accountId, g.goal?.kind ?? 'save')}
          onRemove={(g) => remove.mutate(g.accountId, { onSuccess: close })}
          onSeen={(g) => markSeen.mutate(g.accountId)}
          onNewTarget={(g, targetCents) => setNewTarget.mutateAsync({ accountId: g.accountId, targetCents })}
          onArchive={(g) => archive.mutate(g.accountId)}
          onDeleteArchived={(a) => deleteArchived.mutate(a.id)}
          renderForm={(g) => (
            <>
              <CardHeader title={g.goal ? `Edit ${g.goal.name}` : `Goal for ${g.saverName}`} />
              <GoalForm
                goal={g.goal}
                followedDebtId={g.debt?.id}
                debts={debts.data}
                onKindChange={setEditKind}
                saverName={g.saverName ?? ''}
                onSave={(body) => save.mutate({ accountId: g.accountId, body }, { onSuccess: close })}
                onRemove={
                  g.goal && !g.goal.isDefault ? () => remove.mutate(g.accountId, { onSuccess: close }) : undefined
                }
                onCancel={close}
              />
            </>
          )}
        />
      )}
    </Page>
  )
}
