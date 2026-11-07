import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import type { Scope, UserDto } from '../../shared/types'
import { AppShell } from '../components/shell/AppShell'
import { UnauthorizedError } from '../lib/api'
import { meQuery, setupStatusQuery } from '../lib/queries'
import { isScope } from '../lib/scope'

export const Route = createFileRoute('/_app')({
  validateSearch: (search: Record<string, unknown>): { scope?: Scope } => ({
    scope: isScope(search.scope) && search.scope !== 'everyone' ? search.scope : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const { needsSetup } = await context.queryClient.ensureQueryData(setupStatusQuery)
    if (needsSetup) throw redirect({ to: '/setup' })
    let me: UserDto
    try {
      me = await context.queryClient.ensureQueryData(meQuery)
    } catch (err) {
      if (err instanceof UnauthorizedError) throw redirect({ to: '/login' })
      throw err
    }
    // Nobody sees the app until they have said what they share.
    if (me.sharingLevel === null) throw redirect({ to: '/sharing' })
    // Then whether they have connected Up, or chosen not to.
    if (!me.connectUpAnswered) throw redirect({ to: '/connect' })
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
})
