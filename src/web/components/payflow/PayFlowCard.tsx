import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ReactFlowProvider, useReactFlow, useStore } from '@xyflow/react'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { formatMoney } from '../../../shared/money'
import type { PayFlowGroup, PayFlowMode, PayFlowRange, Scope } from '../../../shared/types'
import { client, errorMessage, unwrap } from '../../lib/api'
import { cn } from '../../lib/cn'
import { flowLayoutQuery, payFlowQuery } from '../../lib/queries'
import { sharingMessage, usePartnerSharing } from '../../lib/sharing'
import { PlainLink, type LinkLike } from '../AppLink'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useToast } from '../ui/Toast'
import { autoLayout } from './autoLayout'
import { FIT_VIEW, periodLabel, ZOOM } from './display'
import { PayFlowCanvas } from './PayFlowCanvas'
import { PayFlowTable } from './PayFlowTable'

type Positions = Record<string, { x: number; y: number }>

const SAVE_DELAY = 500
// The most boxes a saved layout may hold (the flow-layouts route refuses more).
const MAX_BOXES = 300
const CHART_HEIGHT = 'h-[clamp(420px,60vh,640px)]'

const RANGES: { value: PayFlowRange; label: string }[] = [
  { value: 'pay', label: 'Pay cycle' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'fy', label: 'FY' },
]
// What the ‹ › step by, and what an empty period is called.
const UNIT: Record<PayFlowRange, string> = { pay: 'cycle', month: 'month', year: 'year', fy: 'financial year' }

const isTouch = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches)

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
const subscribe = () => () => {}

function Pills<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'type-label h-7 rounded-full border px-3 transition-colors duration-150',
            o.value === value
              ? 'border-accent/40 bg-accent-muted text-accent'
              : 'border-line-2 text-fg-2 hover:bg-elevated hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function FitButton({ disabled, reducedMotion }: { disabled: boolean; reducedMotion: boolean }) {
  const { fitView } = useReactFlow()
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      onClick={() => void fitView({ ...FIT_VIEW, duration: reducedMotion ? 0 : 200 })}
    >
      Fit
    </Button>
  )
}

/** − and + beside Fit; each stops at its end of the zoom range. */
export function ZoomButtons({
  zoom,
  disabled,
  onIn,
  onOut,
}: {
  zoom: number
  disabled: boolean
  onIn: () => void
  onOut: () => void
}) {
  // A hair of slack: zooming by steps lands near the limit, not on it.
  return (
    <div className="flex items-center">
      <Button variant="ghost" icon aria-label="Zoom out" disabled={disabled || zoom <= ZOOM.min * 1.001} onClick={onOut}>
        <Minus aria-hidden size={16} />
      </Button>
      <Button variant="ghost" icon aria-label="Zoom in" disabled={disabled || zoom >= ZOOM.max * 0.999} onClick={onIn}>
        <Plus aria-hidden size={16} />
      </Button>
    </div>
  )
}

function Zoom({ disabled, reducedMotion }: { disabled: boolean; reducedMotion: boolean }) {
  const { zoomTo } = useReactFlow()
  const zoom = useStore((s) => s.transform[2])
  const to = (z: number) => void zoomTo(Math.min(ZOOM.max, Math.max(ZOOM.min, z)), { duration: reducedMotion ? 0 : 150 })
  return <ZoomButtons zoom={zoom} disabled={disabled} onIn={() => to(zoom * ZOOM.step)} onOut={() => to(zoom / ZOOM.step)} />
}

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-3 text-center text-fg-2">{children}</div>
  )
}

/** Overview: "Where the pay went", in four views, by cycle, with draggable boxes. */
export function PayFlowCard({
  scope,
  LinkComponent = PlainLink,
}: {
  scope: Scope
  LinkComponent?: LinkLike
}) {
  return (
    <ReactFlowProvider>
      <PayFlowCardBody scope={scope} LinkComponent={LinkComponent} />
    </ReactFlowProvider>
  )
}

function PayFlowCardBody({ scope, LinkComponent }: { scope: Scope; LinkComponent: LinkLike }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const partner = usePartnerSharing()
  const reducedMotion = useSyncExternalStore(subscribe, prefersReducedMotion, () => true)
  const touch = useSyncExternalStore(subscribe, isTouch, () => false)
  const [mode, setMode] = useState<PayFlowMode>('actual')
  const [group, setGroup] = useState<PayFlowGroup>('accounts')
  const [range, setRangeState] = useState<PayFlowRange>('pay')
  const [date, setDate] = useState<string | undefined>()
  // A new scope or timeframe starts again at today's period.
  const [dateScope, setDateScope] = useState(scope)
  if (dateScope !== scope) {
    setDateScope(scope)
    setDate(undefined)
  }
  const setRange = (r: PayFlowRange) => {
    setRangeState(r)
    setDate(undefined)
  }
  const [table, setTable] = useState(false)
  const key = `${scope}:${mode}:${group}`

  const flowQ = useQuery({
    ...payFlowQuery(scope, mode, group, date, range),
    // Stepping periods keeps the last one on screen (and the ‹ › under focus) until the next arrives.
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey.slice(1, 5).join() === [scope, mode, group, range].join() ? prev : undefined,
  })
  const layoutQ = useQuery(flowLayoutQuery(key))
  const flow = flowQ.data
  // A layout that fails to load just means the automatic one.
  const saved = layoutQ.data?.positions
  const hasSaved = Object.keys(saved ?? {}).length > 0

  // Moves not yet confirmed by the server, for one view at a time.
  const [moved, setMoved] = useState<{ key: string; positions: Positions } | null>(null)
  const ownMoves = moved?.key === key ? moved.positions : undefined
  const positions = useMemo(
    () => (flow ? autoLayout(flow.nodes, flow.edges, { ...saved, ...ownMoves }) : {}),
    [flow, saved, ownMoves],
  )

  const pending = useRef<{ key: string; positions: Positions; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  )
  const save = useCallback(
    (k: string, next: Positions) => {
      unwrap<void>(client.api['flow-layouts'][':key'].$put({ param: { key: k }, json: { positions: next } }))
        .then(() => queryClient.setQueryData(flowLayoutQuery(k).queryKey, { positions: next }))
        .catch((err: unknown) => toast(errorMessage(err), 'error'))
    },
    [queryClient, toast],
  )

  // Debounced, and always the view's full map: saved boxes not in this cycle (a debt paid only some cycles),
  // plus every box on screen. Only when that would pass the server's cap are the absent ones dropped.
  const onMove = useCallback(
    (id: string, x: number, y: number) => {
      const onScreen = { ...positions, [id]: { x, y } }
      const merged = { ...saved, ...ownMoves, ...onScreen }
      const next = Object.keys(merged).length > MAX_BOXES ? onScreen : merged
      setMoved({ key, positions: next })
      const p = pending.current
      if (p) {
        clearTimeout(p.timer)
        if (p.key !== key) save(p.key, p.positions)
      }
      const timer = setTimeout(() => {
        pending.current = null
        save(key, next)
      }, SAVE_DELAY)
      pending.current = { key, positions: next, timer }
    },
    [key, saved, ownMoves, positions, save],
  )

  const reset = useMutation({
    mutationFn: (k: string) =>
      unwrap<void>(client.api['flow-layouts'][':key'].$delete({ param: { key: k } })),
    onSuccess: (_, k) => {
      setMoved((m) => (m?.key === k ? null : m))
      return queryClient.invalidateQueries({ queryKey: flowLayoutQuery(k).queryKey })
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const onReset = () => {
    if (pending.current?.key === key) {
      clearTimeout(pending.current.timer)
      pending.current = null
    }
    reset.mutate(key)
  }

  const cycle = flow?.cycle
  const chart = Boolean(flow?.state === 'ready' && flow.edges.length > 0)
  const link = 'type-label text-accent hover:text-accent-hover'

  let body: ReactNode
  if (!flow) {
    body = flowQ.isError ? (
      <Message>
        <p>Couldn&apos;t load where the pay went.</p>
        <Button onClick={() => void flowQ.refetch()}>Retry</Button>
      </Message>
    ) : (
      <div className={CHART_HEIGHT} aria-busy="true" />
    )
  } else if (flow.state === 'needs-pay') {
    body = (
      <Message>
        <LinkComponent to="/budgets" className={link}>
          Set up your pay on Budgets to see where it goes ›
        </LinkComponent>
      </Message>
    )
  } else if (flow.state === 'no-plan') {
    body = (
      <Message>
        <LinkComponent to="/budgets" className={link}>
          {range === 'pay' ? 'No plan for this pay yet ›' : `No pay plans in this ${UNIT[range]} ›`}
        </LinkComponent>
      </Message>
    )
  } else if (flow.state === 'partner-not-connected') {
    body = (
      <Message>
        <p>Your partner hasn&apos;t connected Up yet.</p>
      </Message>
    )
  } else if (flow.state === 'private') {
    body = (
      <Message>
        <p>{partner ? sharingMessage(partner.level, partner.name) : null}</p>
      </Message>
    )
  } else if (!chart) {
    body = (
      <Message>
        <p>
          {mode === 'planned'
            ? "No items in this pay's plan for this view."
            : `Nothing moved in this ${range === 'pay' ? 'pay cycle' : UNIT[range]} yet.`}
        </p>
      </Message>
    )
  } else if (table) {
    body = <PayFlowTable flow={flow} />
  } else if (layoutQ.isPending) {
    body = <div className={CHART_HEIGHT} aria-busy="true" />
  } else {
    body = (
      <>
        <div className={cn(CHART_HEIGHT, '-mx-2')}>
          <PayFlowCanvas flow={flow} positions={positions} onMove={onMove} reducedMotion={reducedMotion} />
        </div>
        <p className="type-caption mt-2 text-fg-3">
          {touch ? 'Pinch to zoom · drag to pan' : 'Ctrl + scroll or + / − to zoom · drag to pan'}
        </p>
      </>
    )
  }

  return (
    <Card aria-labelledby="pay-flow">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h2 id="pay-flow" className="type-heading">
          Where the pay went
        </h2>
        {cycle && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              icon
              aria-label={`Previous ${UNIT[range]}`}
              onClick={() => setDate(cycle.prevDate ?? undefined)}
              disabled={!cycle.prevDate}
            >
              <ChevronLeft aria-hidden size={16} />
            </Button>
            <span className="type-label num min-w-32 text-center text-fg">
              {periodLabel(range, cycle)}
            </span>
            <Button
              variant="ghost"
              icon
              aria-label={`Next ${UNIT[range]}`}
              onClick={() => setDate(cycle.nextDate ?? undefined)}
              disabled={cycle.isCurrent || !cycle.nextDate}
            >
              <ChevronRight aria-hidden size={16} />
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <Pills label="Timeframe" options={RANGES} value={range} onChange={setRange} />
          <Pills
            label="Planned or actual"
            options={[
              { value: 'planned', label: 'Planned' },
              { value: 'actual', label: 'Actual' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <Pills
            label="Group by"
            options={[
              { value: 'budget', label: 'Budget' },
              { value: 'accounts', label: 'Accounts' },
            ]}
            value={group}
            onChange={setGroup}
          />
          <Zoom disabled={!chart || table} reducedMotion={reducedMotion} />
          <FitButton disabled={!chart || table} reducedMotion={reducedMotion} />
          <Button variant="ghost" onClick={() => setTable((t) => !t)}>
            {table ? 'Show chart' : 'Show as table'}
          </Button>
          {hasSaved && (
            <Button variant="ghost" onClick={onReset} disabled={reset.isPending}>
              Reset layout
            </Button>
          )}
        </div>
      </div>
      {flow?.overAllocatedCents != null && (
        <p className="type-caption mb-3 text-warning">{`Over-allocated by ${formatMoney(flow.overAllocatedCents)}`}</p>
      )}
      {body}
    </Card>
  )
}
