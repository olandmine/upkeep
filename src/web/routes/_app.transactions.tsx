import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { PrivateNotice } from '../components/sharing/PrivateNotice'
import { Page } from '../components/shell/PageHeader'
import { FilterBar, toTxFilters, type TransactionSearch } from '../components/transactions/FilterBar'
import { TransactionTable } from '../components/transactions/TransactionTable'
import { accountsQuery, categoriesQuery, meQuery, tagsQuery, usersQuery } from '../lib/queries'
import { useScope } from '../lib/scope'
import { usePartnerHides } from '../lib/sharing'

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v))
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)

export const Route = createFileRoute('/_app/transactions')({
  validateSearch: (s: Record<string, unknown>): TransactionSearch => ({
    q: str(s.q),
    accountId: str(s.accountId),
    categoryId: str(s.categoryId),
    categoryIds: str(s.categoryIds),
    tag: str(s.tag),
    status: s.status === 'HELD' || s.status === 'SETTLED' ? s.status : undefined,
    from: date(s.from),
    to: date(s.to),
    min: num(s.min),
    max: num(s.max),
    transfers: s.transfers === 'hide' ? 'hide' : undefined,
  }),
  component: TransactionsPage,
})

function TransactionsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [scope] = useScope()
  // In Partner scope, everything on the page is theirs, so the notice takes its place.
  const hidden = usePartnerHides('transactions', scope)
  const { isSuccess: meLoaded } = useQuery(meQuery)
  const { isSuccess: usersLoaded } = useQuery(usersQuery)
  // Their list isn't asked for until their level is known.
  const replaced = scope === 'partner' && (hidden || !(meLoaded && usersLoaded))
  const { data: accounts = [] } = useQuery(accountsQuery(scope))
  const { data: categories = [] } = useQuery(categoriesQuery)
  const { data: tags = [] } = useQuery(tagsQuery)

  const value = useMemo<TransactionSearch>(() => {
    const { scope: _scope, ...rest } = search as TransactionSearch & { scope?: string }
    return rest
  }, [search])
  const onChange = useCallback(
    (next: TransactionSearch) => void navigate({ search: (prev) => ({ scope: prev.scope, ...next }), replace: true }),
    [navigate],
  )
  const filters = useMemo(() => ({ scope, ...toTxFilters(value) }), [scope, value])

  return (
    <Page title="Transactions">
      <PrivateNotice needs="transactions" scope={scope} />
      {!replaced && (
        <>
          <FilterBar value={value} onChange={onChange} accounts={accounts} categories={categories} tags={tags} />
          <TransactionTable filters={filters} emptyText={hidden ? null : undefined} />
        </>
      )}
    </Page>
  )
}
