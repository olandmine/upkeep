import { EdgeLabelRenderer, getBezierPath, Position, type Edge, type EdgeProps } from '@xyflow/react'
import { cn } from '../../lib/cn'
import { BOX } from './autoLayout'
import { edgeLabel } from './display'

export type StreamEdgeData = {
  amountCents: number
  pct: number | null
  /** A CSS colour, e.g. `var(--cat-blue)`. */
  color: string
  dots: number
  fromLabel: string
  toLabel: string
  dimmed: boolean
  active: boolean
  reducedMotion: boolean
  onHover: (id: string, on: boolean) => void
}
export type StreamEdgeType = Edge<StreamEdgeData, 'stream'>

const CYCLE = 2.6 // seconds for a dot to travel any line
const DROP = 60 // how far a backwards line drops below the boxes

/** Out of the source's right side, under both boxes, and into the target's left side. */
function loopPath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const below = Math.max(sy, ty) + BOX.h / 2 + DROP
  const reach = 48
  const path = `M ${sx},${sy} C ${sx + reach},${sy} ${sx + reach},${below} ${sx},${below} L ${tx},${below} C ${tx - reach},${below} ${tx - reach},${ty} ${tx},${ty}`
  return [path, (sx + tx) / 2, below]
}

/** A line of money: a faint bezier with glowing dots streaming toward the target. */
export function StreamEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  data,
}: EdgeProps<StreamEdgeType>) {
  if (!data) return null
  const { color, dimmed, active } = data
  // sourceX is the source box's right edge, so this compares the boxes' left edges.
  const backwards = sourceX - BOX.w >= targetX
  const [path, labelX, labelY] = backwards
    ? loopPath(sourceX, sourceY, targetX, targetY)
    : getBezierPath({
        sourceX,
        sourceY,
        sourcePosition: Position.Right,
        targetX,
        targetY,
        targetPosition: Position.Left,
      })
  const label = edgeLabel(data.amountCents, data.pct)
  const showLabel = active || data.pct === null || data.pct >= 2

  return (
    <>
      <g
        tabIndex={0}
        role="group"
        aria-roledescription="line"
        aria-label={`${data.fromLabel} to ${data.toLabel}, ${label}`}
        onFocus={() => data.onHover(id, true)}
        onBlur={() => data.onHover(id, false)}
        onMouseEnter={() => data.onHover(id, true)}
        onMouseLeave={() => data.onHover(id, false)}
        // React Flow marks unselectable edges `inactive` (pointer-events: none); take the mouse back.
        pointerEvents="visibleStroke"
        // The global focus outline would box in the whole curve; focus draws an accent halo on the line instead.
        className="group outline-none! transition-opacity duration-150 ease-out"
        style={{ opacity: dimmed ? 0.3 : 1 }}
      >
        <path
          d={path}
          fill="none"
          strokeWidth={6}
          strokeLinecap="round"
          className="stroke-accent opacity-0 group-focus-visible:opacity-40"
        />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeOpacity={active ? 0.8 : 0.35}
          strokeWidth={active ? 2.5 : 1.5}
          markerEnd={markerEnd}
        />
        {/* A wider invisible stroke so the line is easy to hover. */}
        <path d={path} fill="none" stroke="transparent" strokeWidth={16} />
        {!data.reducedMotion &&
          Array.from({ length: data.dots }, (_, k) => (
            <circle key={k} r={2.6} fill={color} style={{ filter: `drop-shadow(0 0 3px ${color})` }}>
              <animateMotion
                dur={`${CYCLE}s`}
                begin={`-${((k * CYCLE) / data.dots).toFixed(2)}s`}
                repeatCount="indefinite"
                path={path}
              />
            </circle>
          ))}
      </g>
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              'type-caption num pointer-events-none absolute border border-line-2 bg-elevated px-2 py-0.5 whitespace-nowrap transition-opacity duration-150 ease-out',
              active ? 'z-10 rounded-md text-fg shadow-float' : 'rounded-full text-fg-2',
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              opacity: dimmed ? 0.3 : 1,
            }}
          >
            {active && <span className="block text-fg-3">{`${data.fromLabel} → ${data.toLabel}`}</span>}
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
