import type { ReactNode } from 'react'
import { formatMoney } from '../../../shared/money'
import type { GoalDto, GoalStatus } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { accountColorToken, type AccountGroup } from '../../lib/group-accounts'
import { Money } from '../Money'
import { Card } from '../ui/Card'

/** The statuses the Goals page marks with the warning colour. */
const BEHIND: GoalStatus[] = ['behind', 'date-passed']

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
const sumCents = (groups: AccountGroup[]) => groups.reduce((sum, g) => sum + g.totalCents, 0)
const countAccounts = (groups: AccountGroup[]) => groups.reduce((n, g) => n + g.accounts.length, 0)

function Stat({
  label,
  caption,
  className,
  children,
}: {
  label: string
  caption?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex min-w-0 flex-col gap-1', className)}
    >
      <span className="type-caption text-fg-3">{label}</span>
      {children}
      {caption && <span className="type-caption text-fg-3">{caption}</span>}
    </div>
  )
}

function SaversCaption({ savers, goalOf }: { savers: AccountGroup[]; goalOf: Map<string, GoalDto> }) {
  const goals = savers.flatMap((g) => g.accounts.flatMap((a) => goalOf.get(a.id) ?? []))
  if (!goals.length) return plural(countAccounts(savers), 'account')
  const behind = goals.filter((g) => g.status && BEHIND.includes(g.status)).length
  return (
    <>
      {plural(goals.length, 'goal')}
      {behind > 0 && (
        <>
          {' · '}
          <span className="text-warning">{behind} behind</span>
        </>
      )}
    </>
  )
}

/** One capsule per group, sized by its share of the positive balances and split by account. */
function BalanceBar({ groups }: { groups: AccountGroup[] }) {
  const parts = groups
    .map((g) => {
      const accounts = g.accounts.filter((a) => a.balanceCents > 0)
      return { label: g.label, accounts, cents: accounts.reduce((sum, a) => sum + a.balanceCents, 0) }
    })
    .filter((p) => p.cents > 0)
  const total = parts.reduce((sum, p) => sum + p.cents, 0)
  if (!parts.length) return null
  return (
    <div className="flex gap-1.5">
      {parts.map((p) => {
        const percent = (p.cents / total) * 100
        const share = percent < 0.5 ? '<1%' : `${Math.round(percent)}%`
        return (
          <div key={p.label} className="min-w-16" style={{ flex: `${percent} 1 0` }}>
            <div
              role="img"
              aria-label={`${p.label}: ${share} of balances`}
              className="flex h-3 gap-0.5 overflow-hidden rounded-full"
            >
              {p.accounts.map((a) => (
                <span
                  key={a.id}
                  title={`${a.displayName}: ${formatMoney(a.balanceCents)}`}
                  className="min-w-[2px]"
                  style={{ flex: `${a.balanceCents} 1 0`, background: `var(--${accountColorToken(a)})` }}
                />
              ))}
            </div>
            <p className="type-caption mt-2 text-fg-3">
              {p.label} <span className="num text-fg">{share}</span>
            </p>
          </div>
        )
      })}
    </div>
  )
}

export function AccountsSummary({ groups, goalOf }: { groups: AccountGroup[]; goalOf: Map<string, GoalDto> }) {
  const assets = groups.filter((g) => g.label !== 'Home loan')
  const spending = assets.filter((g) => g.label === 'Spending')
  const savers = assets.filter((g) => g.label !== 'Spending')
  const homeLoan = groups.filter((g) => g.label === 'Home loan')
  return (
    <Card aria-label="Summary" className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:flex lg:[&>*+*]:border-l lg:[&>*+*]:border-line lg:[&>*+*]:pl-6">
        <Stat label="Total balance" caption={plural(countAccounts(assets), 'account')} className="col-span-2 lg:mr-auto">
          <Money cents={sumCents(assets)} hero className="type-kpi-xl" />
        </Stat>
        {spending.length > 0 && (
          <Stat label="Spending" caption={plural(countAccounts(spending), 'account')}>
            <Money cents={sumCents(spending)} className="type-kpi" />
          </Stat>
        )}
        {savers.length > 0 && (
          <Stat label="Savers" caption={<SaversCaption savers={savers} goalOf={goalOf} />}>
            <Money cents={sumCents(savers)} className="type-kpi" />
          </Stat>
        )}
        {homeLoan.length > 0 && (
          <Stat label="Home loan" caption="Not in total">
            <Money cents={sumCents(homeLoan)} className="type-kpi" />
          </Stat>
        )}
      </div>
      <BalanceBar groups={assets} />
    </Card>
  )
}
