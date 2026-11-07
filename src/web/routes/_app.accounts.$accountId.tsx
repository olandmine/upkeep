import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { PALETTE } from '../../shared/categories'
import { levelAllows } from '../../shared/sharing'
import { Money } from '../components/Money'
import { PrivateNotice } from '../components/sharing/PrivateNotice'
import { Page } from '../components/shell/PageHeader'
import { TransactionTable } from '../components/transactions/TransactionTable'
import { Badge, Dot } from '../components/ui/Badge'
import { accountQuery, meQuery, usersQuery } from '../lib/queries'
import { usePartnerSharing } from '../lib/sharing'

export const Route = createFileRoute('/_app/accounts/$accountId')({
  component: AccountPage,
})

const TYPE_LABEL: Record<string, string> = { TRANSACTIONAL: 'Spending', SAVER: 'Saver', HOME_LOAN: 'Home loan' }

function AccountPage() {
  const { accountId } = Route.useParams()
  const { data: account, isError } = useQuery(accountQuery(accountId))
  const { data: me, errorUpdateCount: meErrors } = useQuery(meQuery)
  const { data: users } = useQuery(usersQuery)
  const partner = usePartnerSharing()
  // The other person's personal account, where their sharing level may hide the transactions.
  const theirs = Boolean(account && me && account.ownership === 'INDIVIDUAL' && account.ownerUserId !== me.id)
  const hidden = theirs && partner !== null && !levelAllows(partner.level, 'transactions')
  // Only their account waits for that answer. Without /api/me a personal account could be your own, so it shows, and
  // the server still leaves out anything hidden. The table asks for /api/me again, which clears isError and would
  // take the table away, so this counts failures instead.
  const deciding = account?.ownership === 'INDIVIDUAL' && (me ? theirs && !users : meErrors === 0)
  const filters = useMemo(() => ({ accountId }), [accountId])

  return (
    <Page title={account?.displayName ?? 'Account'} showScope={false}>
      {isError && <p className="type-body text-negative">Couldn&apos;t load this account.</p>}
      {account && (
        <div className="flex flex-col gap-2 py-2">
          <span className="type-caption flex items-center gap-2 text-fg-3">
            <Dot token={PALETTE[account.colorIndex % PALETTE.length]} />
            {TYPE_LABEL[account.accountType] ?? account.accountType}
            <Badge>{account.ownership === 'JOINT' ? 'Joint' : 'Personal'}</Badge>
            {account.ownerName}
          </span>
          <span className="type-caption text-fg-3">Balance</span>
          <Money cents={account.balanceCents} hero className="type-kpi-xl" />
        </div>
      )}
      {hidden && <PrivateNotice needs="transactions" />}
      {account && !deciding && !hidden && <TransactionTable filters={filters} emptyText="No transactions in this account yet." />}
    </Page>
  )
}
