export const BOX = { w: 200, h: 64 }
export const COL_GAP = 120
export const ROW_GAP = 20

type Point = { x: number; y: number }
type Edge = { from: string; to: string; amountCents?: number }
type Side = 'in' | 'out'
type Link = { id: string; w: number }

const STEP = BOX.h + ROW_GAP
// The room a line that skips a column takes as it passes between that column's boxes.
const LANE = 12
const SWEEPS = 8

const overlaps = (p: Point, q: Point) =>
  p.x < q.x + BOX.w && q.x < p.x + BOX.w && p.y < q.y + BOX.h && q.y < p.y + BOX.h

// A bigger line pulls harder, but a $3,000 line doesn't drown out a $30 one entirely.
const weight = (e: Edge) => Math.sqrt(Math.max(e.amountCents ?? 1, 1))

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The edges that close a cycle, found depth-first from the sources (then any box left over),
 * biggest lines first: in a loop it's the small top-up back that gets drawn backwards.
 */
function backEdges(ids: string[], outs: Map<string, Edge[]>, isSource: (id: string) => boolean): Set<Edge> {
  const back = new Set<Edge>()
  const state = new Map<string, 'open' | 'done'>()
  const visit = (id: string) => {
    state.set(id, 'open')
    for (const e of outs.get(id)!) {
      const s = state.get(e.to)
      if (s === 'open') back.add(e)
      else if (!s) visit(e.to)
    }
    state.set(id, 'done')
  }
  const outWeight = (id: string) => outs.get(id)!.reduce((s, e) => s + weight(e), 0)
  const biggest = [...ids].sort((a, b) => outWeight(b) - outWeight(a) || byId(a, b))
  for (const id of biggest) if (isSource(id) && !state.has(id)) visit(id)
  for (const id of biggest) if (!state.has(id)) visit(id)
  return back
}

/** Each box one column after its furthest source; a box nothing feeds sits just before the nearest box it feeds. */
function columnsOf(
  ids: string[],
  ins: Map<string, Link[]>,
  outs: Map<string, Link[]>,
  side: Map<string, Side>,
): Map<string, number> {
  if (side.size > 0) return sidedColumns(ids, ins, outs, side)
  const col = new Map<string, number>()
  const place = (id: string): number => {
    const known = col.get(id)
    if (known !== undefined) return known
    col.set(id, 0) // the graph is acyclic here; this only guards the recursion
    const c = Math.max(-1, ...ins.get(id)!.map((l) => place(l.id))) + 1
    col.set(id, c)
    return c
  }
  for (const id of ids) place(id)
  for (const id of ids) {
    const next = outs.get(id)!.map((l) => col.get(l.id)!)
    if (ins.get(id)!.length === 0 && next.length > 0) col.set(id, Math.max(0, Math.min(...next) - 1))
  }
  // Close any empty columns that pulling sources forward left behind.
  const used = [...new Set(col.values())].sort((a, b) => a - b)
  for (const id of ids) col.set(id, used.indexOf(col.get(id)!))
  return col
}

/**
 * With sides: money in in column 0; Spending and money out in the last columns, each just before
 * what it pays into; everything else between, one column after its furthest box from the left.
 * A line from the right back into the middle is drawn backwards.
 */
function sidedColumns(
  ids: string[],
  ins: Map<string, Link[]>,
  outs: Map<string, Link[]>,
  side: Map<string, Side>,
): Map<string, number> {
  const col = new Map<string, number>()
  const first = ids.some((id) => side.get(id) === 'in') ? 1 : 0
  for (const id of ids) if (side.get(id) === 'in') col.set(id, 0)
  const middle = (id: string): number => {
    const known = col.get(id)
    if (known !== undefined) return known
    col.set(id, first) // acyclic here; this only guards the recursion
    const from = ins.get(id)!.filter((l) => side.get(l.id) !== 'out')
    const c = Math.max(first, ...from.map((l) => middle(l.id) + 1))
    col.set(id, c)
    return c
  }
  for (const id of ids) if (!side.has(id)) middle(id)

  const depth = new Map<string, number>()
  const toEnd = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    depth.set(id, 0)
    const d = Math.max(0, ...outs.get(id)!.filter((l) => side.get(l.id) === 'out').map((l) => toEnd(l.id) + 1))
    depth.set(id, d)
    return d
  }
  const ends = ids.filter((id) => side.get(id) === 'out')
  const deepest = Math.max(0, ...ends.map(toEnd))
  const last = Math.max(first - 1, ...ids.filter((id) => !side.has(id)).map((id) => col.get(id)!))
  for (const id of ends) col.set(id, last + 1 + deepest - toEnd(id))
  return col
}

/** Lines between neighbouring columns that cross, weighted by both lines' sizes. */
function crossingCost(columns: string[][], outs: Map<string, Link[]>, col: Map<string, number>): number {
  const rank = new Map<string, number>()
  for (const ids of columns) ids.forEach((id, i) => rank.set(id, i - (ids.length - 1) / 2))
  const segs: { c1: number; y1: number; c2: number; y2: number; w: number }[] = []
  for (const ids of columns) {
    for (const id of ids) {
      for (const l of outs.get(id)!) segs.push({ c1: col.get(id)!, y1: rank.get(id)!, c2: col.get(l.id)!, y2: rank.get(l.id)!, w: l.w })
    }
  }
  const at = (s: (typeof segs)[number], c: number) => s.y1 + ((s.y2 - s.y1) * (c - s.c1)) / (s.c2 - s.c1)
  let cost = 0
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = [segs[i], segs[j]]
      const lo = Math.max(a.c1, b.c1)
      const hi = Math.min(a.c2, b.c2)
      if (lo >= hi) continue
      if ((at(a, lo) - at(b, lo)) * (at(a, hi) - at(b, hi)) < 0) cost += Math.min(a.w, b.w)
    }
  }
  return cost
}

/**
 * The positions closest (least squares, weighted) to `want` that keep the given order, item i at
 * least offset[i] − offset[i−1] below the one before: pool-adjacent-violators on want[i] − offset[i].
 */
function fit(want: number[], w: number[], offset: number[]): number[] {
  const blocks: { sum: number; w: number; n: number }[] = []
  want.forEach((y, i) => {
    blocks.push({ sum: (y - offset[i]) * w[i], w: w[i], n: 1 })
    while (blocks.length > 1) {
      const [p, q] = blocks.slice(-2)
      if (p.sum / p.w <= q.sum / q.w) break
      blocks.splice(-2, 2, { sum: p.sum + q.sum, w: p.w + q.w, n: p.n + q.n })
    }
  })
  const out: number[] = []
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.sum / b.w + offset[out.length])
  return out
}

/**
 * Starting positions for the pay-flow boxes: a layered layout. Columns run left to right
 * from the sources (or, given sides, from money in on the left to spending and money out on the right), each column is ordered to cross as few lines as it can, and each box
 * sits as level as it can with the boxes it's connected to. A saved position wins, and an
 * unsaved box steps down past any saved box in its way.
 */
export function autoLayout(
  nodes: { id: string; side?: Side }[],
  edges: Edge[],
  saved: Record<string, Point> = {},
): Record<string, Point> {
  const ids = nodes.map((n) => n.id).sort(byId)
  const known = new Set(ids)
  const live = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to)
  const outEdges = new Map<string, Edge[]>(ids.map((id) => [id, []]))
  for (const e of live) outEdges.get(e.from)!.push(e)
  for (const list of outEdges.values()) list.sort((a, b) => weight(b) - weight(a) || byId(a.to, b.to))

  const hasIn = new Set(live.map((e) => e.to))
  const back = backEdges(ids, outEdges, (id) => !hasIn.has(id))
  // Forward lines only, with two lines between the same boxes merged.
  const ins = new Map<string, Link[]>(ids.map((id) => [id, []]))
  const outs = new Map<string, Link[]>(ids.map((id) => [id, []]))
  for (const e of live) {
    const [from, to] = back.has(e) ? [e.to, e.from] : [e.from, e.to]
    const w = weight(e)
    const o = outs.get(from)!.find((l) => l.id === to)
    if (o) {
      o.w += w
      ins.get(to)!.find((l) => l.id === from)!.w += w
    } else {
      outs.get(from)!.push({ id: to, w })
      ins.get(to)!.push({ id: from, w })
    }
  }

  const side = new Map(nodes.filter((n) => n.side).map((n) => [n.id, n.side!]))
  const col = columnsOf(ids, ins, outs, side)
  const columns: string[][] = Array.from({ length: Math.max(0, ...col.values()) + 1 }, () => [])
  for (const id of ids) columns[col.get(id)!].push(id)

  // For ordering, a line that skips columns gets a stand-in in each one it passes through,
  // so the sweeps see where it runs. Stand-ins take no room and are dropped afterwards.
  const oIns = new Map([...ins].map(([id, ls]) => [id, [...ls]]))
  const oOuts = new Map([...outs].map(([id, ls]) => [id, [...ls]]))
  const oCol = new Map(col)
  let stand = 0
  for (const from of ids) {
    for (const l of outs.get(from)!) {
      let prev = from
      for (let c = col.get(from)! + 1; c < col.get(l.id)!; c++) {
        const v = `~${stand++}`
        oCol.set(v, c)
        columns[c].push(v)
        oIns.set(v, [{ id: prev, w: l.w }])
        oOuts.set(v, [])
        oOuts.get(prev)!.push({ id: v, w: l.w })
        prev = v
      }
      if (prev === from) continue
      oOuts.set(from, oOuts.get(from)!.filter((x) => x.id !== l.id))
      oIns.set(l.id, oIns.get(l.id)!.filter((x) => x.id !== from))
      oOuts.get(prev)!.push({ id: l.id, w: l.w })
      oIns.get(l.id)!.push({ id: prev, w: l.w })
    }
  }

  // Order: barycentre sweeps, down then up, keeping the order with the fewest crossings.
  // A rank runs 0–1 down each column, so a short column and a tall one compare.
  const rank = new Map<string, number>()
  const rerank = (c: number) => {
    const n = columns[c].length
    columns[c].forEach((id, i) => rank.set(id, n > 1 ? i / (n - 1) : 0.5))
  }
  columns.forEach((_, c) => rerank(c))
  const sortColumn = (c: number, links: Map<string, Link[]>, other: Map<string, Link[]>) => {
    const centre = (id: string, by: Map<string, Link[]>) => {
      const ls = by.get(id)!
      const w = ls.reduce((s, l) => s + l.w, 0)
      return w > 0 ? ls.reduce((s, l) => s + rank.get(l.id)! * l.w, 0) / w : rank.get(id)!
    }
    // Ties go by the other side's links (a pay's fan, all tied, is split around the line that runs
    // on past it), then keep their current order, so one sweep doesn't undo the last.
    const keyed = columns[c].map((id) => ({ id, y: centre(id, links), then: centre(id, other), was: rank.get(id)! }))
    keyed.sort((p, q) => p.y - q.y || p.then - q.then || p.was - q.was)
    columns[c] = keyed.map((k) => k.id)
    rerank(c)
  }
  let best = { cost: crossingCost(columns, oOuts, oCol), order: columns.map((c) => [...c]) }
  // Every sweep runs, and a tie goes to the later order: crossings aren't all a sweep settles.
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    if (sweep % 2 === 0) for (let c = 1; c < columns.length; c++) sortColumn(c, oIns, oOuts)
    else for (let c = columns.length - 2; c >= 0; c--) sortColumn(c, oOuts, oIns)
    const cost = crossingCost(columns, oOuts, oCol)
    if (cost <= best.cost) best = { cost, order: columns.map((c) => [...c]) }
  }
  const lanes = best.order
  best.order.forEach((order, c) => {
    columns[c] = order.filter((id) => known.has(id))
    rerank(c)
  })

  // Height, by box centre: stacked and centred, then each box drawn level with its connections, a
  // few rounds each way. The stand-ins stay in for this, each holding a narrow lane, so a line that
  // skips a column passes between that column's boxes rather than behind one.
  const tall = (id: string) => (known.has(id) ? BOX.h : LANE)
  const offsets = (order: string[]) => {
    const out = [0]
    for (let i = 1; i < order.length; i++) out.push(out[i - 1] + (tall(order[i - 1]) + tall(order[i])) / 2 + ROW_GAP)
    return out
  }
  const y = new Map<string, number>()
  for (const order of lanes) {
    const off = offsets(order)
    order.forEach((id, i) => y.set(id, off[i] - off[off.length - 1] / 2))
  }
  const level = (c: number, links: Map<string, Link[]>) => {
    const want: number[] = []
    const w: number[] = []
    for (const id of lanes[c]) {
      const ls = links.get(id)!
      const lw = ls.reduce((s, l) => s + l.w, 0)
      want.push(lw > 0 ? ls.reduce((s, l) => s + y.get(l.id)! * l.w, 0) / lw : y.get(id)!)
      w.push(Math.max(lw, 1))
    }
    fit(want, w, offsets(lanes[c])).forEach((v, i) => y.set(lanes[c][i], v))
  }
  const both = new Map([...oIns.keys()].map((id) => [id, [...oIns.get(id)!, ...oOuts.get(id)!]]))
  for (let round = 0; round < 4; round++) {
    for (let c = 1; c < lanes.length; c++) level(c, round === 0 ? oIns : both)
    for (let c = lanes.length - 2; c >= 0; c--) level(c, both)
  }
  const top = Math.min(...ids.map((id) => y.get(id)! - BOX.h / 2))

  const pos: Record<string, Point> = {}
  const placed: Point[] = []
  for (const id of ids) {
    if (saved[id]) {
      pos[id] = { x: saved[id].x, y: saved[id].y }
      placed.push(pos[id])
    }
  }
  columns.forEach((order, c) => {
    const x = c * (BOX.w + COL_GAP)
    for (const id of order) {
      if (saved[id]) continue
      const p = { x, y: Math.round(y.get(id)! - BOX.h / 2 - top) }
      while (placed.some((q) => overlaps(p, q))) p.y += STEP
      pos[id] = p
      placed.push(p)
    }
  })
  return pos
}
