import { useMemo } from 'react'
import { formatMoney } from '../../../shared/money'
import type { AccountDto, GoalDto, Scope } from '../../../shared/types'
import { accountColorToken, groupAccounts } from '../../lib/group-accounts'
import { PlainLink, type LinkLike } from '../AppLink'
import { ConnectUpTile } from '../ConnectUpTile'
import { GOAL_STATUS_TONES, goalStatusText } from '../goals/format'
import { Money } from '../Money'
import { Dot } from '../ui/Badge'
import { AccountsSummary } from './AccountsSummary'

function GoalProgress({ account, goal }: { account: AccountDto; goal: GoalDto }) {
  const percent = Math.round(goal.progress * 100)
  const target = formatMoney(goal.goal!.targetCents).replace(/\.00$/, '')
  const status = goalStatusText(goal)
  return (
    <span className="col-span-2 row-start-2 flex min-w-0 flex-col gap-1.5 md:col-span-1 md:col-start-2 md:row-start-1">
      <span className="type-label flex flex-wrap justify-between gap-x-3 gap-y-0.5">
        <span className="num text-fg">{`${percent}% of ${target}`}</span>
        {status && goal.status && <span className={GOAL_STATUS_TONES[goal.status]}>{status}</span>}
      </span>
      <span
        role="meter"
        aria-label={`${account.displayName} goal progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="block h-1.5 overflow-hidden rounded-full bg-elevated"
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${percent}%`, background: `var(--${accountColorToken(account)})` }}
        />
      </span>
    </span>
  )
}

function AccountRow({ account, goal, LinkComponent }: { account: AccountDto; goal?: GoalDto; LinkComponent: LinkLike }) {
  return (
    <LinkComponent
      to={`/accounts/${account.id}`}
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-2.5 transition-colors duration-150 hover:bg-elevated md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_8rem] md:gap-x-8"
    >
      <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
        {/* Hollow because a home loan isn't in the bar these colours point to. */}
        {account.accountType === 'HOME_LOAN' ? (
          <span aria-hidden className="size-2 shrink-0 rounded-full border-[1.5px] border-fg-3" />
        ) : (
          <Dot token={accountColorToken(account)} />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-fg">{account.displayName}</span>
          <span className="type-caption text-fg-3">{account.ownerName ?? 'Joint'}</span>
        </span>
      </span>
      {goal && <GoalProgress account={account} goal={goal} />}
      <Money
        cents={account.balanceCents}
        className="col-start-2 row-start-1 text-right text-[15px] leading-[22px] text-fg md:col-start-3"
      />
    </LinkComponent>
  )
}

export function AccountsView({
  accounts,
  scope,
  connected,
  hidden = false,
  goals = [],
  LinkComponent = PlainLink,
}: {
  accounts: AccountDto[]
  scope: Scope
  connected: boolean
  /** The other person's accounts are hidden, so "none here" would be untrue. */
  hidden?: boolean
  goals?: GoalDto[]
  LinkComponent?: LinkLike
}) {
  const groups = useMemo(() => groupAccounts(accounts), [accounts])
  const goalOf = useMemo(() => {
    const byAccount = new Map<string, GoalDto>()
    for (const g of goals) if (g.goal && !g.accountMissing) byAccount.set(g.accountId, g)
    return byAccount
  }, [goals])

  if (!connected) return <ConnectUpTile LinkComponent={LinkComponent} />
  if (!accounts.length) {
    if (hidden) return null
    return (
      <p className="type-body rounded-lg border border-line bg-raised p-8 text-center text-fg-3">
        {scope === 'partner' ? "Your partner hasn't connected Up yet." : 'No accounts here yet.'}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <AccountsSummary groups={groups} goalOf={goalOf} />
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="overflow-hidden rounded-lg border border-line bg-raised">
          <header className="type-caption flex items-center justify-between bg-sunken px-4 py-2.5 text-fg-3">
            <h2 className="font-medium">{g.label}</h2>
            <Money cents={g.totalCents} />
          </header>
          <ul className="divide-y divide-line">
            {g.accounts.map((a) => (
              <li key={a.id}>
                <AccountRow account={a} goal={goalOf.get(a.id)} LinkComponent={LinkComponent} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
