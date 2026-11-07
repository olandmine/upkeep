import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { AccountsView } from '../components/accounts/AccountsView'
import { RouterLink } from '../components/AppLink'
import { Page } from '../components/shell/PageHeader'
import { PrivateNotice } from '../components/sharing/PrivateNotice'
import { accountsQuery, goalsQuery, syncStatusQuery } from '../lib/queries'
import { useScope } from '../lib/scope'
import { usePartnerHides } from '../lib/sharing'

export const Route = createFileRoute('/_app/accounts/')({
  component: AccountsPage,
})

function AccountsPage() {
  const [scope] = useScope()
  const accounts = useQuery(accountsQuery(scope))
  const goals = useQuery({ ...goalsQuery(scope), select: (d) => d.goals })
  const { data: status } = useQuery(syncStatusQuery)
  const hidden = usePartnerHides('balances', scope)
  return (
    <Page title="Accounts">
      <PrivateNotice needs="balances" scope={scope} />
      {accounts.data && status && (
        <AccountsView
          accounts={accounts.data}
          scope={scope}
          connected={status.connections.length > 0}
          hidden={hidden}
          goals={goals.data}
          LinkComponent={RouterLink}
        />
      )}
    </Page>
  )
}
