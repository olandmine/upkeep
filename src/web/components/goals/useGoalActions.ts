import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { GoalKind } from '../../../shared/types'
import { client, errorMessage, unwrap } from '../../lib/api'
import { useToast } from '../ui/Toast'

/** Saving, removing and archiving a goal, and what they refresh. Callers close their own form with a per-call `onSuccess`. */
export function useGoalActions() {
  const queryClient = useQueryClient()
  const toast = useToast()
  // Goal lists are refetched even when no page is showing them, so the one a goal page returns to isn't stale on arrival.
  // A goal's own page is refetched only while open: an inactive one may be for a goal that has since gone.
  const refreshLists = () =>
    queryClient.invalidateQueries({
      queryKey: ['goals'],
      predicate: (q) => q.queryKey[1] !== 'detail',
      refetchType: 'all',
    })
  const refreshGoals = () => Promise.all([refreshLists(), queryClient.invalidateQueries({ queryKey: ['goals', 'detail'] })])
  // What else a goal change shows up in: the debt options, and Budgets' Fund lines and plans.
  const refreshElsewhere = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['goal-debts'] }),
      queryClient.invalidateQueries({ queryKey: ['budget-period'] }),
      queryClient.invalidateQueries({ queryKey: ['standard-pay'] }),
    ])
  const refresh = () => Promise.all([refreshGoals(), refreshElsewhere()])
  const save = useMutation({
    mutationFn: (v: {
      accountId: string
      body: {
        kind: GoalKind
        name: string
        targetCents?: number
        targetDate: string | null
        debtId?: string
      }
    }) => unwrap(client.api.goals[':accountId'].$put({ param: { accountId: v.accountId }, json: v.body })),
    onSuccess: () => void refresh(),
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const remove = useMutation({
    mutationFn: (accountId: string) =>
      unwrap(client.api.goals[':accountId'].$delete({ param: { accountId } })),
    onSuccess: () => void refresh(),
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const markSeen = useMutation({
    mutationFn: (accountId: string) =>
      unwrap(client.api.goals[':accountId'].seen.$post({ param: { accountId } })),
    onSuccess: () => void refreshGoals(),
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const setNewTarget = useMutation({
    mutationFn: (v: { accountId: string; targetCents: number }) =>
      unwrap(
        client.api.goals[':accountId']['new-target'].$post({
          param: { accountId: v.accountId },
          json: { targetCents: v.targetCents },
        }),
      ),
    onSuccess: () => void refresh(),
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const archive = useMutation({
    mutationFn: (accountId: string) =>
      unwrap(client.api.goals[':accountId'].archive.$post({ param: { accountId } })),
    // Returned, so a caller's own `onSuccess` (leaving the goal's page) runs once the list is fresh. The page being
    // left is only marked stale: refetching it would 404 and flash "not found" on the way out.
    onSuccess: (_, accountId) => {
      void queryClient.invalidateQueries({ queryKey: ['goals', 'detail', accountId], refetchType: 'none' })
      return Promise.all([refreshLists(), refreshElsewhere()])
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const deleteArchived = useMutation({
    mutationFn: (id: string) => unwrap(client.api.goals.archived[':id'].$delete({ param: { id } })),
    onSuccess: () => void refreshGoals(),
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  return { save, remove, markSeen, setNewTarget, archive, deleteArchived }
}
