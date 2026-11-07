import '@xyflow/react/dist/base.css'
import { useNavigate } from '@tanstack/react-router'
import {
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  useStoreApi,
  type NodeChange,
  type NodeHandle,
  type OnNodeDrag,
} from '@xyflow/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import type { PayFlowDto } from '../../../shared/types'
import { BOX } from './autoLayout'
import { FIT_VIEW, PHONE_QUERY, pctOf, pctText, phoneViewport, tracePath, ZOOM } from './display'
import { FlowBox, type FlowBoxNode } from './FlowBox'
import { StreamEdge, type StreamEdgeType } from './StreamEdge'

type Point = { x: number; y: number }
type Active = { type: 'node' | 'edge'; id: string } | null

// The card's surface shows through (React Flow's own themes paint their own background).
const SURFACE = { '--xy-background-color': 'var(--bg-raised)' } as CSSProperties

const isPhone = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(PHONE_QUERY).matches)
const onPhoneChange = (notify: () => void) => {
  const query = typeof window !== 'undefined' ? window.matchMedia?.(PHONE_QUERY) : undefined
  query?.addEventListener('change', notify)
  return () => query?.removeEventListener('change', notify)
}

const nodeTypes = { box: FlowBox }
const edgeTypes = { stream: StreamEdge }

// Boxes have a fixed size, so React Flow can draw lines before it measures anything.
const HANDLES: NodeHandle[] = [
  { type: 'target', position: Position.Left, x: 0, y: BOX.h / 2, width: 1, height: 1 },
  { type: 'source', position: Position.Right, x: BOX.w - 1, y: BOX.h / 2, width: 1, height: 1 },
]

/** The hovered or focused element and its direct connections; null when nothing is (or it's gone). */
function litUp(flow: PayFlowDto, active: Active): { nodes: Set<string>; edges: Set<string> } | null {
  if (!active) return null
  const nodes = new Set<string>()
  const edges = new Set<string>()
  const linked =
    active.type === 'node'
      ? flow.edges.filter((e) => e.from === active.id || e.to === active.id)
      : flow.edges.filter((e) => e.id === active.id)
  if (active.type === 'node') {
    if (!flow.nodes.some((n) => n.id === active.id)) return null
    nodes.add(active.id)
  } else if (linked.length === 0) {
    return null
  }
  for (const e of linked) {
    edges.add(e.id)
    nodes.add(e.from)
    nodes.add(e.to)
  }
  return { nodes, edges }
}

/**
 * The pay-flow chart. Positions come from the card; a drag shows live here and is
 * handed back through `onMove` when it ends. Must sit inside a ReactFlowProvider (the card's).
 */
export function PayFlowCanvas({
  flow,
  positions,
  onMove,
  reducedMotion,
}: {
  flow: PayFlowDto
  positions: Record<string, Point>
  onMove: (id: string, x: number, y: number) => void
  reducedMotion: boolean
}) {
  const navigate = useNavigate()
  const { fitView, setViewport, zoomIn, zoomOut } = useReactFlow()
  const store = useStoreApi()
  const sized = useStore((s) => s.height > 0)
  const phone = useSyncExternalStore(onPhoneChange, isPhone, () => false)
  const [active, setActive] = useState<Active>(null)
  // A clicked box: its whole path stays lit until it's clicked again, the background is, or Esc.
  const [pinned, setPinned] = useState<string | null>(null)
  const [drag, setDrag] = useState<({ id: string } & Point) | null>(null)

  // The starting view reads the boxes where they are now, without re-running when one moves.
  const boxes = useRef<{ kind: PayFlowDto['nodes'][number]['kind']; x: number; y: number }[]>([])
  useEffect(() => {
    boxes.current = flow.nodes.map((n) => ({ kind: n.kind, ...(positions[n.id] ?? { x: 0, y: 0 }) }))
  }, [flow, positions])

  // Start again when the boxes change (another view or cycle), not when one moves. Desktops fit
  // everything; a phone starts legible at the pay and pans to the rest (Fit still shows it all).
  const shape = flow.nodes.map((n) => n.id).join('|')
  useEffect(() => {
    if (!phone) void fitView(FIT_VIEW)
    else if (sized && boxes.current.length > 0)
      void setViewport(phoneViewport(boxes.current, store.getState().height))
  }, [shape, phone, sized, fitView, setViewport, store])

  const open = useCallback(
    (href: string) =>
      void navigate({
        to: href as never,
        search: ((prev: { scope?: string }) => ({ scope: prev.scope })) as never,
      }),
    [navigate],
  )
  const onNudge = useCallback(
    (id: string, dx: number, dy: number) => {
      const at = positions[id]
      if (at) onMove(id, at.x + dx, at.y + dy)
    },
    [positions, onMove],
  )
  const hover = useCallback(
    (type: 'node' | 'edge') => (id: string, on: boolean) =>
      setActive((a) => (on ? { type, id } : a?.type === type && a.id === id ? null : a)),
    [],
  )
  const hoverNode = useMemo(() => hover('node'), [hover])
  const hoverEdge = useMemo(() => hover('edge'), [hover])

  useEffect(() => {
    if (pinned === null) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPinned(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pinned])

  const lit = useMemo(() => {
    // Backwards as drawn: the line's end sits left of its start (see StreamEdge).
    const at = (id: string) => positions[id]?.x ?? 0
    const back = (e: { from: string; to: string }) => at(e.from) - BOX.w >= at(e.to)
    return (pinned !== null ? tracePath(flow, pinned, back) : null) ?? litUp(flow, active)
  }, [flow, positions, pinned, active])

  const nodes = useMemo<FlowBoxNode[]>(
    () =>
      flow.nodes.map((n) => {
        const at = drag?.id === n.id ? drag : (positions[n.id] ?? { x: 0, y: 0 })
        const isActive = active?.type === 'node' && active.id === n.id
        const isPinned = pinned === n.id
        const pct = pctOf(n.amountCents, flow.baseCents)
        return {
          id: n.id,
          type: 'box',
          position: { x: at.x, y: at.y },
          width: BOX.w,
          height: BOX.h,
          measured: { width: BOX.w, height: BOX.h },
          handles: HANDLES,
          zIndex: isActive || isPinned ? 1000 : 0,
          data: {
            node: n,
            pctLine: pct === null ? null : `${pctText(pct, n.amountCents)} of ${flow.baseLabel}`,
            dimmed: lit ? !lit.nodes.has(n.id) : false,
            active: isActive,
            pinned: isPinned,
            onNudge,
            onHover: hoverNode,
            onOpen: open,
          },
        }
      }),
    [flow, positions, drag, active, pinned, lit, onNudge, hoverNode, open],
  )

  const edges = useMemo<StreamEdgeType[]>(() => {
    const byId = new Map(flow.nodes.map((n) => [n.id, n]))
    return flow.edges.flatMap((e) => {
      const from = byId.get(e.from)
      const to = byId.get(e.to)
      if (!from || !to) return []
      // A line takes the colour of the box it goes into; lines out of a pay are income.
      const color = `var(--${from.kind === 'pay' ? 'positive' : to.colorToken})`
      const share = flow.baseCents > 0 ? e.amountCents / flow.baseCents : 0
      return [
        {
          id: e.id,
          source: e.from,
          target: e.to,
          type: 'stream' as const,
          markerEnd: reducedMotion
            ? { type: MarkerType.ArrowClosed, color, width: 14, height: 14 }
            : undefined,
          data: {
            amountCents: e.amountCents,
            pct: pctOf(e.amountCents, flow.baseCents),
            color,
            dots: Math.min(12, Math.max(1, Math.round(share * 12))),
            fromLabel: from.label,
            toLabel: to.label,
            dimmed: lit ? !lit.edges.has(e.id) : false,
            active: active?.type === 'edge' && active.id === e.id,
            reducedMotion,
            onHover: hoverEdge,
          },
        },
      ]
    })
  }, [flow, active, lit, reducedMotion, hoverEdge])

  // Controlled boxes: only a drag in progress moves one here; everything else comes from the card.
  const onNodesChange = useCallback((changes: NodeChange<FlowBoxNode>[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.dragging && c.position) setDrag({ id: c.id, ...c.position })
    }
  }, [])
  const onNodeDragStop = useCallback<OnNodeDrag<FlowBoxNode>>(
    (_, node) => {
      setDrag(null)
      onMove(node.id, Math.round(node.position.x), Math.round(node.position.y))
    },
    [onMove],
  )

  return (
    <ReactFlow<FlowBoxNode, StreamEdgeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={(_, node) => setPinned((p) => (p === node.id ? null : node.id))}
      onPaneClick={() => setPinned(null)}
      // + and − zoom while a box has keyboard focus (the buttons in the card do the same).
      onKeyDown={(e) => {
        if (e.key === '+' || e.key === '=') void zoomIn({ duration: reducedMotion ? 0 : 150 })
        else if (e.key === '-' || e.key === '_') void zoomOut({ duration: reducedMotion ? 0 : 150 })
      }}
      nodesConnectable={false}
      elementsSelectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      // Let the page scroll over the chart; zoom with a pinch (or ctrl + wheel).
      zoomOnScroll={false}
      preventScrolling={false}
      minZoom={ZOOM.min}
      maxZoom={ZOOM.max}
      style={SURFACE}
      proOptions={{ hideAttribution: true }}
      aria-label="Where the pay went"
    />
  )
}
