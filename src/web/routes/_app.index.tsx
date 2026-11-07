import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { PALETTE } from '../../shared/categories'
import type { SyncStatusDto, UserDto } from '../../shared/types'
import { RouterLink, SearchLink } from '../components/AppLink'
import { ConnectUpTile } from '../components/ConnectUpTile'
import { AllocationBar } from '../components/overview/AllocationBar'
import { CategorySpend } from '../components/overview/CategorySpend'
import { GettingStartedCard } from '../components/overview/GettingStartedCard'
import { IncomeExpenseChart } from '../components/overview/IncomeExpenseChart'
import { KpiRow } from '../components/overview/KpiRow'
import { ThisPeriodCard } from '../components/overview/ThisPeriodCard'
import { NetWorthTile } from '../components/networth/NetWorthTile'
import { PayFlowCard } from '../components/payflow/PayFlowCard'
import { RecentTransactions } from '../components/overview/RecentTransactions'
import { PrivateNotice } from '../components/sharing/PrivateNotice'
import { Page } from '../components/shell/PageHeader'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { client, errorMessage, unwrap } from '../lib/api'
import {
  budgetPeriodQuery,
  budgetsQuery,
  categoriesQuery,
  gettingStartedQuery,
  meQuery,
  netWorthQuery,
  overviewQuery,
  syncStatusQuery,
  usersQuery,
} from '../lib/queries'
import { useScope } from '../lib/scope'
import { usePartnerHides } from '../lib/sharing'

export const Route = createFileRoute('/_app/')({
  component: OverviewPage,
})

function OverviewPage() {
  const [scope] = useScope()
  const hidesFinances = usePartnerHides('finances', scope)
  // Partner scope is only their data, so what their level hides is replaced rather than shown as zeros.
  const noBalances = usePartnerHides('balances', scope) && scope === 'partner'
  const noSpending = hidesFinances && scope === 'partner'
  const noTransactions = usePartnerHides('transactions', scope) && scope === 'partner'
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: status } = useQuery(syncStatusQuery)
  const { data: me } = useQuery(meQuery)
  const { data: users } = useQuery(usersQuery)
  const { data: gettingStarted, isPending: cardPending } = useQuery(gettingStartedQuery)
  const cardShows = Boolean(gettingStarted?.show) && !me?.gettingStartedHidden && (scope === 'everyone' || scope === 'me')
  const mine = status?.connections.find((c) => c.userId === me?.id)
  const { data: overview } = useQuery(overviewQuery(undefined, scope))
  const { data: netWorth } = useQuery(netWorthQuery(scope, '6m'))
  const { data: categories = [] } = useQuery(categoriesQuery)
  const { data: budgets = [] } = useQuery(budgetsQuery)
  const mineBudget = budgets.find((b) => b.kind === 'personal' && b.name === 'Mine')
  const jointBudget = budgets.find((b) => b.kind === 'joint')
  const { data: minePeriod } = useQuery({
    ...budgetPeriodQuery(mineBudget?.id ?? ''),
    enabled: mineBudget?.setup === 'ready',
  })
  const { data: jointPeriod } = useQuery({
    ...budgetPeriodQuery(jointBudget?.id ?? ''),
    enabled: jointBudget?.setup === 'ready',
  })
  const periodLines = [
    ...(minePeriod?.lines ?? []).map((line) => ({ budgetName: 'Mine', line })),
    ...(jointPeriod?.lines ?? []).map((line) => ({ budgetName: 'Joint', line })),
  ]
  const sync = useMutation({
    mutationFn: () => unwrap<SyncStatusDto>(client.api.sync.run.$post()),
    onSuccess: (s) => {
      queryClient.setQueryData(syncStatusQuery.queryKey, s)
      void queryClient.invalidateQueries()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const hide = useMutation({
    mutationFn: () => unwrap<UserDto>(client.api.me.$patch({ json: { gettingStartedHidden: true } })),
    onSuccess: (user) => {
      queryClient.setQueryData(meQuery.queryKey, user)
      void queryClient.invalidateQueries({ queryKey: gettingStartedQuery.queryKey })
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const connected = (status?.connections.length ?? 0) > 0
  const viewAll = (
    <Link to="/transactions" search={{ scope: scope === 'everyone' ? undefined : scope }} className="type-label text-fg-2 hover:text-fg">
      View all ›
    </Link>
  )

  return (
    <Page
      title="Overview"
      actions={
        connected && (
          <Button variant="primary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw aria-hidden size={14} className={sync.isPending ? 'animate-spin' : undefined} />
            Sync now
          </Button>
        )
      }
    >
      {cardShows && gettingStarted && (
        <GettingStartedCard
          data={gettingStarted}
          connection={mine}
          partnerName={users?.find((u) => u.id !== me?.id)?.displayName}
          onHide={() => hide.mutate()}
          LinkComponent={RouterLink}
        />
      )}
      {noBalances && <PrivateNotice needs="balances" scope={scope} />}
      {status && !connected && !noBalances && !cardPending && !cardShows && <ConnectUpTile LinkComponent={RouterLink} />}
      {connected && overview && !noBalances && (
        <>
          <PrivateNotice needs="finances" scope={scope} />
          <KpiRow overview={overview} balancesOnly={noSpending} />
          {!noSpending && <PayFlowCard scope={scope} LinkComponent={RouterLink} />}
          {netWorth && <NetWorthTile data={netWorth} scope={scope} LinkComponent={SearchLink} />}
          <Card aria-labelledby="balances">
            <CardHeader id="balances" title="Balance by account" />
            <AllocationBar
              label="Balance by account"
              items={overview.balancesByAccount.map((a) => ({
                key: a.accountId,
                label: a.displayName,
                cents: a.balanceCents,
                colorToken: PALETTE[a.colorIndex % PALETTE.length],
              }))}
            />
          </Card>
          {!noSpending && (
            <>
              <ThisPeriodCard items={periodLines} LinkComponent={RouterLink} />
              <div className="grid gap-4 lg:grid-cols-12">
                <Card aria-labelledby="income-vs-spending" className="lg:col-span-7">
                  <CardHeader id="income-vs-spending" title="Income vs spending" />
                  <IncomeExpenseChart monthly={overview.monthly} />
                </Card>
                <Card aria-labelledby="by-category" className="lg:col-span-5">
                  <CardHeader id="by-category" title="Spending this month" />
                  <CategorySpend overview={overview} />
                </Card>
              </div>
            </>
          )}
          {/* Only when finances are shared, so the notice at the top isn't repeated. */}
          {!hidesFinances && <PrivateNotice needs="transactions" scope={scope} />}
          {!noTransactions && (
            <Card aria-labelledby="recent">
              <CardHeader id="recent" title="Recent transactions" action={viewAll} />
              <RecentTransactions items={overview.recent} categories={categories} />
            </Card>
          )}
        </>
      )}
    </Page>
  )
}
