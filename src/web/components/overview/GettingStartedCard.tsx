import { Check, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { GettingStartedDto, GettingStartedItemDto, GettingStartedKey, SyncStatusDto } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { PlainLink, type LinkLike } from '../AppLink'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'

type Connection = SyncStatusDto['connections'][number]

const count = new Intl.NumberFormat('en-AU')

const ROWS: Record<GettingStartedKey, { title: string; line: string; to: string }> = {
  'connect-up': { title: 'Connect Up', line: 'Link your Up account to start tracking.', to: '/settings#bank-connection' },
  password: {
    title: 'Change your password',
    line: 'chose your first one. Make it yours so only you can log in.',
    to: '/settings#profile',
  },
  handle: { title: 'Set your Up $handle', line: '', to: '/settings#profile' },
  partner: { title: 'Add your partner', line: 'Give them their own login, with their own Up connection.', to: '/settings#users' },
  budget: { title: 'Set up your pay and budget', line: 'Pick your pay deposit, then plan where it goes.', to: '/budgets' },
  'joint-budget': { title: 'Set up your joint budget', line: 'Plan the money you share.', to: '/budgets' },
  debt: { title: 'Add a debt', line: "Track a loan or tax bill and see when it's paid off.", to: '/debts' },
  goal: { title: 'Set a goal', line: 'Give a Saver a target and see how close it is.', to: '/goals' },
}

export function GettingStartedCard({
  data,
  connection,
  partnerName,
  onHide,
  LinkComponent = PlainLink,
}: {
  data: GettingStartedDto
  /** The viewer's own connection. */
  connection: Connection | undefined
  /** Who chose their first password; falls back to "Your partner". */
  partnerName: string | undefined
  onHide: () => void
  LinkComponent?: LinkLike
}) {
  const counted = data.items.filter((i) => !i.optional)
  const optional = data.items.filter((i) => i.optional)
  const done = counted.filter((i) => i.state === 'done').length
  const connected = data.items.some((i) => i.key === 'connect-up' && i.state === 'done')

  function describe(item: GettingStartedItemDto): { line: string | null; to: string | null } {
    const row = ROWS[item.key]
    if (item.key === 'connect-up' && item.state === 'done' && connection) {
      if (connection.running?.kind === 'backfill') {
        return { line: `Imported ${count.format(connection.running.transactionsUpserted)} transactions…`, to: null }
      }
      if (connection.status !== 'ok') {
        return { line: "Couldn't finish syncing. Check your bank connection.", to: row.to }
      }
    }
    if (item.state === 'done') return { line: null, to: null }
    if (item.state === 'locked') {
      return {
        line: connected ? 'Ready once your history has imported.' : 'Ready once Up is connected and your history has imported.',
        to: null,
      }
    }
    if (item.key === 'password') return { line: `${partnerName ?? 'Your partner'} ${row.line}`, to: row.to }
    if (item.key === 'handle') {
      return {
        line: connected
          ? 'Matches your new joint spending on 2Up to you.'
          : 'Do this before connecting, so joint spending on 2Up is matched to you.',
        to: row.to,
      }
    }
    return { line: row.line, to: row.to }
  }

  function renderRow(item: GettingStartedItemDto) {
    const { line, to } = describe(item)
    const done = item.state === 'done'
    const locked = item.state === 'locked'
    const body: ReactNode = (
      <>
        <span
          aria-hidden
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full border',
            done && 'border-positive bg-positive-muted text-positive',
            item.state === 'open' && (item.optional ? 'border-line-3' : 'border-accent'),
            locked && 'border-dashed border-line-3',
          )}
        >
          {done && <Check size={14} strokeWidth={2} />}
        </span>
        {done && <span className="sr-only">Done</span>}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('type-body', done || locked ? 'text-fg-3' : 'text-fg')}>{ROWS[item.key].title}</span>
          {line && <span className={cn('type-caption', to || !(done || locked) ? 'text-fg-2' : 'text-fg-3')}>{line}</span>}
        </span>
        {to && <ChevronRight aria-hidden size={16} className="shrink-0 text-accent" />}
      </>
    )
    const frame = cn(
      'flex min-h-11 items-center gap-3 rounded-md border px-3 py-2',
      to ? 'border-accent-muted hover:bg-elevated' : locked ? 'border-dashed border-line' : 'border-line',
    )
    return (
      <li key={item.key}>
        {to ? (
          <LinkComponent to={to} className={frame}>
            {body}
          </LinkComponent>
        ) : (
          <div className={frame}>{body}</div>
        )}
      </li>
    )
  }

  return (
    <Card aria-labelledby="getting-started">
      <CardHeader
        id="getting-started"
        title="Getting started"
        action={
          <span className="flex items-center gap-3">
            <span className="type-caption num text-fg-2">
              {done} of {counted.length} done
            </span>
            <Button variant="ghost" className="h-11 sm:h-9" onClick={onHide}>
              Hide
            </Button>
          </span>
        }
      />
      <ul className="flex flex-col gap-2">{counted.map(renderRow)}</ul>
      {optional.length > 0 && (
        <>
          <p className="type-label mb-2 mt-4 text-fg-3">Optional</p>
          <ul className="flex flex-col gap-2">{optional.map(renderRow)}</ul>
        </>
      )}
    </Card>
  )
}
