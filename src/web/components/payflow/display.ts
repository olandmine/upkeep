import { formatMoney } from '../../../shared/money'
import type { PayFlowDto, PayFlowNodeDto, PayFlowRange } from '../../../shared/types'
import { addDays, shortDate } from '../budgets/format'
import { BOX } from './autoLayout'

/** Share of the base to one decimal place; null when the cycle has no base to divide by. */
export function pctOf(cents: number, baseCents: number): number | null {
  return baseCents > 0 ? Math.round((cents / baseCents) * 1000) / 10 : null
}

/** "19.4%"; "<0.1%" for money too small a share to show as 0%; "—" with no base. */
export const pctText = (pct: number | null, cents: number) =>
  pct === null ? '—' : pct === 0 && cents > 0 ? '<0.1%' : `${pct}%`

/** The line's pill: "$X · Y%". */
export const edgeLabel = (cents: number, pct: number | null) =>
  pct === null ? formatMoney(cents) : `${formatMoney(cents)} · ${pctText(pct, cents)}`

/**
 * A clicked box's whole path: every box and line upstream of it (what fed it, and what fed
 * those) and downstream (where it went, and on from there). A line drawn backwards (`isBack`)
 * is lit but not followed, or one loop back into a busy box would light the whole chart.
 * Null when the box is gone.
 */
export function tracePath<E extends { id: string; from: string; to: string }>(
  flow: { nodes: { id: string }[]; edges: E[] },
  id: string,
  isBack: (e: E) => boolean = () => false,
): { nodes: Set<string>; edges: Set<string> } | null {
  if (!flow.nodes.some((n) => n.id === id)) return null
  const nodes = new Set([id])
  const edges = new Set<string>()
  const walk = (start: string, next: (e: E) => [string, string]) => {
    const seen = new Set([start])
    const queue = [start]
    while (queue.length > 0) {
      const at = queue.shift()!
      for (const e of flow.edges) {
        const [here, there] = next(e)
        if (here !== at) continue
        edges.add(e.id)
        nodes.add(there)
        if (!seen.has(there) && !isBack(e)) {
          seen.add(there)
          queue.push(there)
        }
      }
    }
  }
  walk(id, (e) => [e.from, e.to])
  walk(id, (e) => [e.to, e.from])
  return { nodes, edges }
}

/** The chart's zoom range (low enough that Fit always fits, even four columns on a phone), and one button's step. */
export const ZOOM = { min: 0.1, max: 2, step: 1.2 }

/** The header's name for the period: "14 Oct – today", "Oct 2026", "2026" or "FY 2025–26". */
export function periodLabel(range: PayFlowRange, cycle: NonNullable<PayFlowDto['cycle']>): string {
  const y = Number(cycle.start.slice(0, 4))
  if (range === 'month') {
    const at = new Date(`${cycle.start}T00:00:00Z`)
    return at.toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  if (range === 'year') return String(y)
  if (range === 'fy') return `FY ${y}–${String((y + 1) % 100).padStart(2, '0')}`
  return `${shortDate(cycle.start)} – ${cycle.end ? shortDate(addDays(cycle.end, -1)) : 'today'}`
}

/** Fit to view without blowing a small chart up past 1:1. */
export const FIT_VIEW = { padding: 0.1, maxZoom: 1 }

/** Below Tailwind's md breakpoint (768px) a fitted chart is too small to read. */
export const PHONE_QUERY = '(max-width: 767.98px)'
const PHONE_ZOOM = 0.6
const PHONE_GUTTER = 16

/**
 * Where a phone's chart starts: at 60%, with the pay column (or, with no pay, the leftmost box) at the
 * left edge and the boxes centred top to bottom. Pan or Fit to see the rest.
 */
export function phoneViewport(
  boxes: { kind: PayFlowNodeDto['kind']; x: number; y: number }[],
  height: number,
): { x: number; y: number; zoom: number } {
  const pays = boxes.filter((b) => b.kind === 'pay')
  const left = Math.min(...(pays.length > 0 ? pays : boxes).map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const bottom = Math.max(...boxes.map((b) => b.y + BOX.h))
  return {
    x: PHONE_GUTTER - left * PHONE_ZOOM,
    y: height / 2 - ((top + bottom) / 2) * PHONE_ZOOM,
    zoom: PHONE_ZOOM,
  }
}
