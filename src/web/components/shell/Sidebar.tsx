import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeftRight,
  Landmark,
  LayoutDashboard,
  LogOut,
  PiggyBank,
  Settings,
  Target,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { UserDto } from '../../../shared/types'
import { client, unwrap } from '../../lib/api'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'
import { SyncIndicator } from './SyncIndicator'

type NavPath = '/' | '/accounts' | '/transactions' | '/budgets' | '/goals' | '/debts' | '/net-worth' | '/settings'

const NAV: { to: NavPath; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/debts', label: 'Debts', icon: Landmark },
  { to: '/net-worth', label: 'Net worth', icon: TrendingUp },
  { to: '/settings', label: 'Settings', icon: Settings },
]

/** `rail` hides labels between md and xl. */
export function SidebarContent({ me, rail, onNavigate }: { me?: UserDto; rail?: boolean; onNavigate?: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const label = rail ? 'hidden xl:inline' : undefined

  async function logout() {
    await unwrap(client.api.auth.logout.$post()).catch(() => {})
    queryClient.clear()
    void navigate({ to: '/login' })
  }

  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-16 items-center px-5', rail && 'justify-center xl:justify-start')}>
        <span className="type-heading tracking-tight">
          <span aria-hidden className="mr-0.5 text-accent">
            ◆
          </span>
          <span className={label}>Upkeep</span>
        </span>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
        {NAV.map(({ to, label: text, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            search={((prev: { scope?: string }) => ({ scope: prev.scope })) as never}
            activeOptions={{ exact: to === '/', includeSearch: false }}
            onClick={onNavigate}
            aria-label={rail ? text : undefined}
            title={rail ? text : undefined}
            className={cn(
              'type-label relative flex h-9 items-center gap-3 rounded-md px-3 text-fg-2 transition-colors duration-150 hover:bg-elevated hover:text-fg',
              rail && 'justify-center xl:justify-start',
            )}
            activeProps={{
              className:
                'bg-elevated !text-fg before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent',
            }}
          >
            <Icon aria-hidden size={18} strokeWidth={1.5} />
            <span className={label}>{text}</span>
          </Link>
        ))}
      </nav>
      <div className={cn('mt-auto flex flex-col gap-3 border-t border-line p-4', rail && 'items-center xl:items-stretch')}>
        <div className={rail ? 'hidden xl:block' : undefined}>
          <SyncIndicator />
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="type-caption flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-fg"
          >
            {me?.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span className={cn('type-label min-w-0 flex-1 truncate text-fg', label)}>{me?.displayName}</span>
          <Button variant="ghost" icon aria-label="Log out" title="Log out" onClick={logout} className={label}>
            <LogOut aria-hidden size={16} strokeWidth={1.5} />
          </Button>
        </div>
      </div>
    </div>
  )
}

export function Sidebar({ me }: { me?: UserDto }) {
  return (
    // The outer column stretches with the page (background + border); the inner panel stays in view.
    <div className="hidden w-16 shrink-0 border-r border-line bg-sunken md:block xl:w-[232px]">
      <aside className="sticky top-0 h-dvh">
        <SidebarContent me={me} rail />
      </aside>
    </div>
  )
}
