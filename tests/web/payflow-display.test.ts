import { expect, test } from 'vitest'
import { edgeLabel, pctOf, pctText, periodLabel, phoneViewport, tracePath } from '../../src/web/components/payflow/display'

test('shares show to one decimal, and a tiny share of real money never reads as 0%', () => {
  expect(pctText(pctOf(80_000, 412_000), 80_000)).toBe('19.4%')
  expect(pctText(pctOf(196, 412_000), 196)).toBe('<0.1%')
  expect(pctText(pctOf(0, 412_000), 0)).toBe('0%')
  expect(pctText(pctOf(196, 0), 196)).toBe('—')
  expect(edgeLabel(196, pctOf(196, 412_000))).toBe('$1.96 · <0.1%')
})

test('on a phone the chart starts at 60% on the pay column, centred on the boxes', () => {
  // Columns at x 0, 320 and 640; rows from y 0 to 232 (the last box is 64 tall).
  const boxes = [
    { kind: 'pay' as const, x: 0, y: 84 },
    { kind: 'account' as const, x: 320, y: 0 },
    { kind: 'sink' as const, x: 640, y: 168 },
  ]
  expect(phoneViewport(boxes, 480)).toEqual({ x: 16, y: 240 - 116 * 0.6, zoom: 0.6 })
  // With no pay (the Joint scope), the leftmost box anchors it.
  expect(phoneViewport([{ kind: 'source', x: -40, y: 0 }, { kind: 'sink', x: 280, y: 0 }], 400)).toEqual({
    x: 16 + 40 * 0.6,
    y: 200 - 32 * 0.6,
    zoom: 0.6,
  })
})

test('tracing a box lights everything that fed it and everything it fed, not its siblings', () => {
  // pay → spend → {rent, car → fuel}; earlier → car.
  const e = (from: string, to: string) => ({ id: `${from}->${to}`, from, to, amountCents: 1 })
  const ids = ['pay', 'spend', 'rent', 'car', 'fuel', 'earlier', 'alone']
  const flow = {
    nodes: ids.map((id) => ({ id })),
    edges: [e('pay', 'spend'), e('spend', 'rent'), e('spend', 'car'), e('car', 'fuel'), e('earlier', 'car')],
  }
  const car = tracePath(flow, 'car')!
  expect([...car.nodes].sort()).toEqual(['car', 'earlier', 'fuel', 'pay', 'spend'])
  expect([...car.edges].sort()).toEqual(['car->fuel', 'earlier->car', 'pay->spend', 'spend->car'])

  // Rent's path doesn't light Car's other source.
  expect([...tracePath(flow, 'rent')!.nodes].sort()).toEqual(['pay', 'rent', 'spend'])
  expect(tracePath(flow, 'alone')).toEqual({ nodes: new Set(['alone']), edges: new Set() })
  expect(tracePath(flow, 'gone')).toBeNull()
})

test('a line drawn backwards is lit but not followed', () => {
  // car → essentials → spend loops back into spend, which also feeds rent.
  const e = (from: string, to: string) => ({ id: `${from}->${to}`, from, to, amountCents: 1 })
  const flow = {
    nodes: ['pay', 'spend', 'car', 'rent', 'essentials'].map((id) => ({ id })),
    edges: [e('pay', 'spend'), e('spend', 'car'), e('spend', 'rent'), e('car', 'essentials'), e('essentials', 'spend')],
  }
  const back = (x: { from: string; to: string }) => x.from === 'essentials' && x.to === 'spend'
  const car = tracePath(flow, 'car', back)!
  expect([...car.nodes].sort()).toEqual(['car', 'essentials', 'pay', 'spend'])
  expect(car.edges.has('essentials->spend')).toBe(true)
  expect(car.edges.has('spend->rent')).toBe(false)
})

test('tracing stops going round a loop', () => {
  const e = (from: string, to: string) => ({ id: `${from}->${to}`, from, to, amountCents: 1 })
  const flow = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [e('a', 'b'), e('b', 'a')] }
  expect([...tracePath(flow, 'a')!.edges].sort()).toEqual(['a->b', 'b->a'])
})

test('each timeframe names its period', () => {
  const cycle = (start: string, end: string | null) => ({ start, end, prevDate: null, nextDate: null, isCurrent: end === null })
  expect(periodLabel('pay', cycle('2026-10-14', '2026-10-28'))).toBe('14 Oct – 27 Oct')
  expect(periodLabel('pay', cycle('2026-10-26', null))).toBe('26 Oct – today')
  expect(periodLabel('month', cycle('2026-10-01', '2026-11-01'))).toBe('Oct 2026')
  expect(periodLabel('year', cycle('2026-01-01', null))).toBe('2026')
  expect(periodLabel('fy', cycle('2025-07-01', null))).toBe('FY 2025–26')
  expect(periodLabel('fy', cycle('1999-07-01', '2000-07-01'))).toBe('FY 1999–00')
})
