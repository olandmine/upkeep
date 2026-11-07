import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { SyncStatusDto } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { syncStatusQuery } from '../../lib/queries'
import { formatClock, formatRelative } from '../../lib/relative-time'
import { PlainLink, RouterLink, type LinkLike } from '../AppLink'

type Tone = 'positive' | 'info' | 'warning'

function describe(status: SyncStatusDto, now: Date, tz?: string): { tone: Tone; text: string; link?: boolean; pulse?: boolean } {
  const conns = status.connections
  if (!conns.length) return { tone: 'warning', text: 'Connect Up', link: true }
  if (conns.some((c) => c.status === 'unauthorized')) return { tone: 'warning', text: 'Bank connection needs attention', link: true }
  if (conns.some((c) => c.running)) return { tone: 'info', text: 'Syncing…', pulse: true }
  const failed = conns.find((c) => c.status === 'error')
  if (failed) {
    const at = failed.lastFailedAt ? ` ${formatClock(failed.lastFailedAt, tz)}` : ''
    return { tone: 'warning', text: `Last sync failed${at}, retrying` }
  }
  const synced = conns.map((c) => c.lastSyncedAt).filter((v): v is string => v !== null)
  if (!synced.length) return { tone: 'info', text: 'Waiting for first sync' }
  const oldest = synced.reduce((a, b) => (a < b ? a : b))
  return { tone: 'positive', text: `Synced ${formatRelative(oldest, now)}` }
}

const DOT: Record<Tone, string> = { positive: 'bg-positive', info: 'bg-info', warning: 'bg-warning' }

export function SyncIndicatorView({
  status,
  now,
  tz,
  LinkComponent = PlainLink,
}: {
  status: SyncStatusDto | undefined
  now: Date
  tz?: string
  LinkComponent?: LinkLike
}) {
  if (!status) return null
  const d = describe(status, now, tz)
  const content = (
    <>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[d.tone], d.pulse && 'animate-pulse')} />
      <span>{d.text}</span>
    </>
  )
  const className = cn('type-caption flex items-center gap-2', d.tone === 'warning' ? 'text-warning' : 'text-fg-3')
  return (
    <div role="status" aria-live="polite">
      {d.link ? (
        <LinkComponent to="/settings" className={cn(className, 'hover:underline')}>
          {content}
        </LinkComponent>
      ) : (
        <span className={className}>{content}</span>
      )}
    </div>
  )
}

export function SyncIndicator() {
  const { data } = useQuery(syncStatusQuery)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  return <SyncIndicatorView status={data} now={now} LinkComponent={RouterLink} />
}
