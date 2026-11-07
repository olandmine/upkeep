import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { KeyboardEvent } from 'react'
import { formatMoney } from '../../../shared/money'
import type { PayFlowNodeDto } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { Dot } from '../ui/Badge'

export type FlowBoxData = {
  node: PayFlowNodeDto
  /** "{pct}% of pay" / "% of money in"; null when the cycle has no base. */
  pctLine: string | null
  dimmed: boolean
  active: boolean
  /** Clicked: its path stays lit, and its tooltip stays open with a link to the box's page. */
  pinned: boolean
  onNudge: (id: string, dx: number, dy: number) => void
  onHover: (id: string, on: boolean) => void
  onOpen: (href: string) => void
}
export type FlowBoxNode = Node<FlowBoxData, 'box'>

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

// Lines attach at the middle of each side; nothing is connected by hand.
const HIDDEN = { opacity: 0, pointerEvents: 'none' } as const
const OPEN_LABEL: [string, string][] = [
  ['/accounts/', 'Open account ›'],
  ['/debts/', 'Open debt ›'],
  ['/budgets', 'Open Budgets ›'],
]
const openLabel = (href: string) => OPEN_LABEL.find(([prefix]) => href.startsWith(prefix))?.[1] ?? 'Open ›'

// The positive-income treatment over an opaque box, so lines don't show through.
const PAY_FILL = 'linear-gradient(var(--positive-muted), var(--positive-muted)), var(--bg-elevated)'

/** A pay-flow box: dot, name, amount, and its share of pay or its account caption. */
export function FlowBox({ id, data }: NodeProps<FlowBoxNode>) {
  const { node, pctLine, dimmed, active, pinned } = data
  const pay = node.kind === 'pay'
  const account = node.kind === 'account' || node.kind === 'outside-account'
  const amount = formatMoney(node.amountCents, { signDisplay: pay ? 'always' : 'auto' })
  // Accounts show their in/kept caption; other boxes their share, after a caption such as "from Spending".
  // (A pay's caption, its description and date, stays in the tooltip.)
  const detail = account
    ? node.caption
    : [pay ? null : node.caption, pctLine].filter(Boolean).join(' · ') || null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = ARROWS[e.key]
    if (dir) {
      e.preventDefault()
      e.stopPropagation()
      const step = e.shiftKey ? 32 : 8
      data.onNudge(id, dir[0] * step, dir[1] * step)
    } else if (e.key === 'Enter' && node.href) {
      data.onOpen(node.href)
    }
  }

  return (
    <div
      tabIndex={0}
      role={node.href ? 'link' : 'group'}
      aria-label={[node.label, amount, detail].filter(Boolean).join(', ')}
      onKeyDown={onKeyDown}
      onFocus={() => data.onHover(id, true)}
      onBlur={() => data.onHover(id, false)}
      onMouseEnter={() => data.onHover(id, true)}
      onMouseLeave={() => data.onHover(id, false)}
      className={cn(
        'relative flex h-full w-full flex-col justify-center gap-1 rounded-lg border px-3 shadow-[inset_0_1px_0_var(--highlight-top)] transition-opacity duration-150 ease-out',
        pay ? 'border-positive' : 'border-line-2 bg-elevated',
        node.kind === 'outside-account' && 'border-dashed',
        node.href && 'cursor-pointer',
      )}
      style={{ opacity: dimmed ? 0.3 : 1, background: pay ? PAY_FILL : undefined }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={HIDDEN} />
      <div className="flex min-w-0 items-center gap-2">
        <Dot token={node.colorToken} />
        <span className="type-label truncate text-fg">{node.label}</span>
        <span className={cn('type-label num ml-auto shrink-0', pay ? 'text-positive' : 'text-fg')}>
          {amount}
        </span>
      </div>
      {detail && <span className="type-caption truncate text-fg-3">{detail}</span>}
      {(active || pinned) && (
        <div
          role="tooltip"
          className={cn(
            'type-caption absolute bottom-full left-0 mb-2 w-max max-w-72 rounded-md border border-line-2 bg-elevated px-3 py-2 shadow-float',
            !pinned && 'pointer-events-none',
          )}
        >
          <p className="text-fg">{node.label}</p>
          <p className="num text-fg-2">{pctLine ? `${amount} · ${pctLine}` : amount}</p>
          {node.caption && <p className="text-fg-3">{node.caption}</p>}
          {pinned && (node.interestCents ?? 0) > 0 && (
            <p className="num text-fg-3">{`Interest ${formatMoney(node.interestCents!)}`}</p>
          )}
          {pinned && node.href && (
            <button
              type="button"
              // nodrag: pressing the link mustn't start moving the box.
              className="nodrag mt-1 text-accent underline-offset-2 hover:underline"
              onClick={(e) => {
                e.stopPropagation()
                data.onOpen(node.href!)
              }}
            >
              {openLabel(node.href)}
            </button>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} style={HIDDEN} />
    </div>
  )
}
