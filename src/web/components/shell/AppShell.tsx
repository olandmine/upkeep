import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useAccent } from '../../lib/accent'
import { meQuery } from '../../lib/queries'
import { MoneyPrefsProvider } from '../Money'
import { Sidebar } from './Sidebar'

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useQuery(meQuery)
  useAccent(me?.accent ?? 'amber')
  return (
    <MoneyPrefsProvider negativeStyle={me?.negativeStyle ?? 'minus'}>
      <div className="flex min-h-dvh">
        <Sidebar me={me} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </MoneyPrefsProvider>
  )
}
