import { describe, expect, test } from 'vitest'
import { autoLayout, BOX, COL_GAP, ROW_GAP } from '../../src/web/components/payflow/autoLayout'

const edge = (from: string, to: string, amountCents?: number) => ({ from, to, amountCents })
const ids = (...names: string[]) => names.map((id) => ({ id }))

// Small seeded PRNG so the random graphs are the same on every run.
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const overlaps = (p: { x: number; y: number }, q: { x: number; y: number }) =>
  p.x < q.x + BOX.w && q.x < p.x + BOX.w && p.y < q.y + BOX.h && q.y < p.y + BOX.h

type Pos = Record<string, { x: number; y: number }>

/** Left-to-right lines as straight segments (right middle → left middle); counts the pairs that cross. */
function crossings(pos: Pos, edges: { from: string; to: string }[]): number {
  const segs = edges
    .map((e) => ({ x1: pos[e.from].x + BOX.w, y1: pos[e.from].y, x2: pos[e.to].x, y2: pos[e.to].y, e }))
    .filter((s) => s.x2 > s.x1)
  const at = (s: (typeof segs)[number], x: number) => s.y1 + ((s.y2 - s.y1) * (x - s.x1)) / (s.x2 - s.x1)
  let n = 0
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = [segs[i], segs[j]]
      if (a.e.from === b.e.from || a.e.to === b.e.to) continue
      const lo = Math.max(a.x1, b.x1)
      const hi = Math.min(a.x2, b.x2)
      if (lo >= hi) continue
      if ((at(a, lo) - at(b, lo)) * (at(a, hi) - at(b, hi)) < 0) n++
    }
  }
  return n
}

// Shaped like a real Actual · Accounts cycle: pay into Spending, which feeds a dozen Savers,
// some of which feed a second tier; earlier balance and other money top a few up.
const realistic = [
  edge('pay', 'spend', 300_677),
  edge('other-in', 'spend', 90_000),
  edge('unsynced-in', 'spend', 10_200),
  edge('earlier', 'twoUp', 41_921),
  edge('earlier', 'car', 32_280),
  edge('earlier', 'essentials', 12_000),
  edge('spend', 'twoUp', 29_299),
  edge('spend', 'taxes', 95_000),
  edge('spend', 'food', 20_600),
  edge('spend', 'twoUpEss', 9_900),
  edge('spend', 'car', 25_000),
  edge('spend', 'health', 15_420),
  edge('spend', 'bed', 20_000),
  edge('spend', 'rainy', 24_500),
  edge('spend', 'rent', 82_000),
  edge('spend', 'bills', 6_000),
  edge('spend', 'challenge', 1_600),
  edge('spend', 'rego', 7_693),
  edge('spend', 'unsynced-out', 15_200),
  edge('car', 'essentials', 32_296),
  edge('food', 'essentials', 20_600),
  edge('twoUpEss', 'essentials', 9_900),
  edge('health', 'fuel', 12_000),
  edge('essentials', 'spend', 14_500),
]
const realisticIds = ids(...new Set(realistic.flatMap((e) => [e.from, e.to])))

// Earlier balance tops up two boxes above Spending's fan, so three crossings can't be helped.
const CROSSING_BUDGET = 3

describe('autoLayout', () => {
  test('constants', () => {
    expect(BOX).toEqual({ w: 200, h: 64 })
    expect(COL_GAP).toBe(120)
    expect(ROW_GAP).toBe(20)
  })

  test('columns: one after the furthest source', () => {
    const pos = autoLayout(ids('a', 'b', 'c', 'd'), [edge('a', 'b'), edge('b', 'c'), edge('b', 'd')])
    expect(pos.a.x).toBe(0)
    expect(pos.b.x).toBe(320)
    expect(pos.c.x).toBe(640)
    expect(pos.d.x).toBe(640)
    expect(pos.c.y).not.toBe(pos.d.y)
  })

  test('a destination sits beside its source, not at the far end', () => {
    const pos = autoLayout(ids('a', 'b', 'x', 'z'), [edge('a', 'b'), edge('b', 'z'), edge('a', 'x')])
    expect(pos.b.x).toBe(320)
    expect(pos.x.x).toBe(320)
    expect(pos.z.x).toBe(640)
  })

  test('a source sits just before what it feeds', () => {
    // e only tops up c, so it sits in b's column rather than at the far left.
    const pos = autoLayout(ids('a', 'b', 'c', 'e'), [edge('a', 'b'), edge('b', 'c'), edge('e', 'c')])
    expect(pos.e.x).toBe(320)
    expect(pos.c.x).toBe(640)
  })

  test('a box sits level with what it is connected to', () => {
    // b is fed by a and feeds only d (the bottom of three), so it lines up with d.
    const pos = autoLayout(ids('a', 'b', 'c1', 'c2', 'd'), [
      edge('a', 'b'),
      edge('a', 'c1'),
      edge('a', 'c2'),
      edge('b', 'd'),
    ])
    expect(pos.d.y).toBe(pos.b.y)
  })

  test('few crossings on a realistic cycle, and the busiest box level with the middle of what it feeds', () => {
    const pos = autoLayout(realisticIds, realistic)
    expect(crossings(pos, realistic)).toBeLessThanOrEqual(CROSSING_BUDGET)
    // The small top-up back into Spending is the line drawn backwards, not Spending's own.
    expect(pos.essentials.x).toBeGreaterThan(pos.spend.x)
    const fed = realistic.filter((e) => e.from === 'spend').map((e) => pos[e.to].y)
    expect(pos.spend.y).toBeGreaterThan(Math.min(...fed) + BOX.h)
    expect(pos.spend.y).toBeLessThan(Math.max(...fed) - BOX.h)
  })

  test('the busier line wins the straighter path', () => {
    // b and c both feed d; d lines up nearer the bigger feed.
    const pos = autoLayout(ids('a', 'b', 'c', 'd'), [edge('a', 'b'), edge('a', 'c'), edge('b', 'd', 100), edge('c', 'd', 10_000)])
    expect(Math.abs(pos.d.y - pos.c.y)).toBeLessThan(Math.abs(pos.d.y - pos.b.y))
  })

  test('columns are centred vertically on the tallest column', () => {
    const pos = autoLayout(ids('a', 'b', 'c'), [edge('a', 'b'), edge('a', 'c')])
    const step = BOX.h + ROW_GAP
    expect(pos.b.y).toBe(0)
    expect(pos.c.y).toBe(step)
    expect(pos.a.y).toBe(step / 2)
  })

  test('orders a column by the mean y of its sources, ties by id', () => {
    // y is fed by p (above), w by q (below), so y lands above w despite id order.
    const pos = autoLayout(ids('p', 'q', 'w', 'y'), [edge('p', 'y'), edge('q', 'w')])
    expect(pos.y.y).toBeLessThan(pos.w.y)
    const tied = autoLayout(ids('s', 'n', 'm'), [edge('s', 'n'), edge('s', 'm')])
    expect(tied.m.y).toBeLessThan(tied.n.y)
  })

  test('money in sits on the left, spending and money out on the right, the rest between', () => {
    const nodes = [
      { id: 'pay', side: 'in' as const },
      { id: 'other', side: 'in' as const },
      { id: 'saver1' },
      { id: 'saver2' },
      { id: 'spend', side: 'out' as const },
      { id: 'sink', side: 'out' as const },
    ]
    const pos = autoLayout(nodes, [
      edge('pay', 'saver1'),
      edge('pay', 'spend'),
      edge('other', 'spend'),
      edge('saver1', 'saver2'),
      edge('spend', 'saver1'),
      edge('spend', 'sink'),
    ])
    expect([pos.pay.x, pos.other.x]).toEqual([0, 0])
    expect([pos.saver1.x, pos.saver2.x]).toEqual([320, 640])
    expect(pos.spend.x).toBe(960)
    expect(pos.sink.x).toBe(1280)
  })

  test('a line that skips a column passes between its boxes, not behind one', () => {
    // Planned · Accounts: the pay fans out to thirteen Savers and sends the rest past them to Spending.
    const savers = Array.from({ length: 13 }, (_, i) => `s${String(i).padStart(2, '0')}`)
    const nodes = [{ id: 'pay', side: 'in' as const }, ...savers.map((id) => ({ id })), { id: 'spend', side: 'out' as const }]
    const pos = autoLayout(nodes, [...savers.map((id) => edge('pay', id, 10_000)), edge('pay', 'spend', 20_000)])
    const mid = (id: string) => pos[id].y + BOX.h / 2
    // Where the straight line from the pay to Spending crosses the Savers' column.
    const x = pos.s00.x + BOX.w / 2
    const t = (x - (pos.pay.x + BOX.w)) / (pos.spend.x - (pos.pay.x + BOX.w))
    const y = mid('pay') + (mid('spend') - mid('pay')) * t
    for (const id of savers) expect(y > pos[id].y && y < pos[id].y + BOX.h, id).toBe(false)
  })

  test('with nothing between, money out sits one column after money in', () => {
    const pos = autoLayout([{ id: 'pay', side: 'in' }, { id: 'spend', side: 'out' }], [edge('pay', 'spend')])
    expect([pos.pay.x, pos.spend.x]).toEqual([0, 320])
  })

  test('a back edge does not move the columns', () => {
    const pos = autoLayout(ids('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c'), edge('c', 'b')])
    expect(pos.a.x).toBe(0)
    expect(pos.b.x).toBe(320)
    expect(pos.c.x).toBe(640)
  })

  test('a cycle no source reaches is broken at its first box', () => {
    const pos = autoLayout(ids('a', 'b', 'x', 'y'), [edge('a', 'b'), edge('x', 'y'), edge('y', 'x')])
    expect(pos.x.x).toBe(0)
    expect(pos.y.x).toBe(320)
  })

  test('no overlap across seeded random graphs', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rand = mulberry32(seed)
      const n = 4 + Math.floor(rand() * 12)
      const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }))
      const edges: { from: string; to: string }[] = []
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) if (rand() < 0.3) edges.push(edge(`n${i}`, `n${j}`))
      }
      for (let k = 0; k < 2; k++) {
        const i = 1 + Math.floor(rand() * (n - 1))
        const j = Math.floor(rand() * i)
        if (rand() < 0.5) edges.push(edge(`n${i}`, `n${j}`))
      }
      const pos = autoLayout(nodes, edges)
      expect(Object.keys(pos).sort()).toEqual(nodes.map((x) => x.id).sort())
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          expect(overlaps(pos[`n${i}`], pos[`n${j}`]), `seed ${seed}: n${i} vs n${j}`).toBe(false)
        }
      }
    }
  })

  test('saved positions win, stale ones are dropped, new boxes avoid them', () => {
    const nodes = ids('a', 'b', 'c', 'e')
    const edges = [edge('a', 'b'), edge('a', 'e'), edge('b', 'c')]
    const pos = autoLayout(nodes, edges, { b: { x: 900, y: 0 }, gone: { x: 0, y: 0 } })
    expect(pos.b).toEqual({ x: 900, y: 0 })
    expect(pos).not.toHaveProperty('gone')
    expect(overlaps(pos.e, pos.b)).toBe(false)
  })

  test('a new box in a column skips a saved box sitting in its slot', () => {
    const nodes = ids('a', 'b', 'e')
    const edges = [edge('a', 'b'), edge('a', 'e')]
    const plain = autoLayout(nodes, edges)
    // Park b across the column's first slot, so e has to step down to the next one.
    const saved = { b: { x: plain.b.x + 10, y: plain.b.y + 5 } }
    const pos = autoLayout(nodes, edges, saved)
    expect(pos.b).toEqual(saved.b)
    expect(pos.e).toEqual({ x: plain.b.x, y: plain.b.y + BOX.h + ROW_GAP })
    expect(overlaps(pos.e, pos.b)).toBe(false)
  })
})
