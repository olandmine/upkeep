import type { GoalDetailDto, GoalRange } from '../../../shared/types'

export const GOAL_RANGES: { value: GoalRange; label: string }[] = [
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
]

export interface GoalChartRow {
  /** UTC ms of the date, for a time axis that spaces uneven rows properly. */
  t: number
  date: string
  saved: number | null
  target: number | null
  expected: number | null
  atThisRate: number | null
  debtAtThisRate: number | null
}

/** What the target line is called: the debt it follows, or plain Target. */
export const targetName = (d: GoalDetailDto) => (d.goal.debt ? `${d.goal.debt.name} left` : 'Target')

/**
 * The goal page's chart: the Saver's points merged with the dates its dashed paths end on, oldest first.
 *
 * A path's date rarely lands on a point, and `saved` and `target` don't connect across nulls (null means a debt hadn't
 * begun). So a row between two points holds the earlier point's figures rather than breaking those lines. Before the
 * first point nothing is drawn, as nothing is known. After the last, only a flat target carries on, to meet the paths;
 * a debt's future is `debtAtThisRate`.
 */
export function chartRows(d: GoalDetailDto): GoalChartRow[] {
  const byDate = new Map<string, GoalChartRow>()
  const row = (date: string) => {
    let r = byDate.get(date)
    if (!r) {
      r = {
        t: Date.parse(`${date}T00:00:00Z`),
        date,
        saved: null,
        target: null,
        expected: null,
        atThisRate: null,
        debtAtThisRate: null,
      }
      byDate.set(date, r)
    }
    return r
  }

  const pointDates = new Set(d.points.map((p) => p.date))
  for (const p of d.points) {
    const r = row(p.date)
    r.saved = p.balanceCents
    r.target = p.targetCents
  }
  if (d.expected) {
    row(d.expected.from.date).expected = d.expected.from.cents
    row(d.expected.to.date).expected = d.expected.to.cents
  }
  if (d.projected) {
    const now = row(d.goal.today)
    const end = row(d.projected.date)
    now.atThisRate = d.goal.balanceCents
    end.atThisRate = d.projected.saverCents
    if (d.goal.debt) {
      now.debtAtThisRate = d.goal.goal?.targetCents ?? null
      end.debtAtThisRate = d.projected.saverCents
    }
  }

  const rows = [...byDate.values()].sort((a, b) => a.t - b.t)
  const lastPoint = d.points.at(-1)?.date ?? ''
  let point: GoalChartRow | null = null
  for (const r of rows) {
    if (pointDates.has(r.date)) {
      point = r
    } else if (point) {
      const between = r.date < lastPoint
      if (between) r.saved = point.saved
      if (between || !d.goal.debt) r.target = point.target
    }
  }
  return rows
}

/**
 * What the chart draws: `chartRows` from the range's first point on, so a goal started long ago doesn't stretch the axis.
 * The table keeps the true start. The expected line loses its first end, so the first point holds its height there.
 */
export function plotRows(d: GoalDetailDto): GoalChartRow[] {
  return clipEnd(d, clipStart(d))
}

/**
 * How far past today the axis reaches: the larger of the range's length and 12 months, which is 12 months for every
 * range (All included). A date further out, up to a century for a slow goal, would squash the history into a corner.
 */
const AHEAD_MONTHS = 12

/** The dashed paths, cut at the axis's far edge where they cross it, the way `plotRows` cuts them on the left. */
function clipEnd(d: GoalDetailDto, rows: GoalChartRow[]): GoalChartRow[] {
  const [y, m, day] = d.goal.today.split('-').map(Number)
  const cap = Date.UTC(y!, m! - 1 + AHEAD_MONTHS, day!)
  const last = rows.at(-1)
  if (!last || last.t <= cap) return rows

  const inside = rows.filter((r) => r.t <= cap)
  const before = inside.at(-1)
  if (before?.t === cap) return inside
  const date = new Date(cap).toISOString().slice(0, 10)
  const edge: GoalChartRow = {
    t: cap,
    date,
    saved: null,
    target: d.goal.debt ? null : (inside.findLast((r) => r.target !== null)?.target ?? null),
    expected: null,
    atThisRate: null,
    debtAtThisRate: null,
  }
  for (const key of ['expected', 'atThisRate', 'debtAtThisRate'] as const) {
    const from = inside.findLast((r) => r[key] !== null)
    const to = rows.slice(inside.length).find((r) => r[key] !== null)
    if (!from || !to || to.t <= cap) continue
    const share = (cap - from.t) / (to.t - from.t)
    edge[key] = Math.round(from[key]! + share * (to[key]! - from[key]!))
  }
  return [...inside, edge]
}

/** The series (of the lines drawn with dots) that have exactly one value, which a line alone would leave invisible. */
export function singleValued(rows: GoalChartRow[]): ('saved' | 'target')[] {
  return (['saved', 'target'] as const).filter((k) => rows.filter((r) => r[k] !== null).length === 1)
}

function clipStart(d: GoalDetailDto): GoalChartRow[] {
  const rows = chartRows(d)
  const first = d.points[0]?.date
  const start = rows.findIndex((r) => r.date === first)
  if (start <= 0) return rows

  const plotted = rows.slice(start)
  const edge = plotted[0]!
  const from = rows[0]!
  const to = rows.find((r) => r.date === d.expected?.to.date)
  if (d.expected && from.date === d.expected.from.date && to && to.t > edge.t && edge.expected === null) {
    const share = (edge.t - from.t) / (to.t - from.t)
    plotted[0] = {
      ...edge,
      expected: Math.round(d.expected.from.cents + share * (d.expected.to.cents - d.expected.from.cents)),
    }
  }
  return plotted
}

/** The x-axis, from the first plotted row (the range's first point) to the last. */
export function chartDomain(d: GoalDetailDto): [number, number] {
  const rows = plotRows(d)
  return [rows[0]?.t ?? 0, rows.at(-1)?.t ?? 0]
}
