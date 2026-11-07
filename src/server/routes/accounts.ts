import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { getAccount, listAccounts } from '../queries/accounts'
import { canSeeAccount } from '../sharing/policy'
import { validate } from './validate'

export const ScopeSchema = z.enum(['everyone', 'me', 'partner', 'joint'])

export function accountsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', validate('query', z.object({ scope: ScopeSchema.default('everyone') })), (c) =>
      c.json(listAccounts(deps.db, c.req.valid('query').scope, c.get('user').id), 200),
    )
    .get('/:id', (c) => {
      const viewerId = c.get('user').id
      const account = getAccount(deps.db, c.req.param('id'))
      // Hidden looks like missing, so a 404 never says whether the account exists.
      return account && canSeeAccount(deps.db, viewerId, account, 'balances') ? c.json(account, 200) : c.json({ error: 'Account not found' }, 404)
    })
}
