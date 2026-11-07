import { expect, test } from 'vitest'
import { chartDomain, chartRows, plotRows, singleValued } from '../../src/web/components/goals/goal-chart'
import { debtGoalDetail, goalDetail } from './goal-fixtures'

const at = (date: string) => Date.parse(`${date}T00:00:00Z`)

// The fixtures' last point is 2026-10-30, which is also their goal's `today`.

test('rows are sorted by date, with t the UTC time of the date', () => {
  const rows = chartRows(
    goalDetail({
      expected: { from: { date: '2026-09-01', cents: 0 }, to: { date: '2026-12-31', cents: 100_000 } },
    }),
  )
  expect(rows.map((r) => r.date)).toEqual(['2026-09-01', '2026-10-23', '2026-10-30', '2026-12-31'])
  expect(rows.map((r) => r.t)).toEqual(rows.map((r) => at(r.date)))
})

test("a save goal's flat target is on every point row", () => {
  const rows = chartRows(goalDetail())
  expect(rows.map((r) => r.target)).toEqual([100_000, 100_000])
  expect(rows.map((r) => r.saved)).toEqual([60_000, 62_000])
})

test('expected is set at its two dates only', () => {
  const rows = chartRows(
    goalDetail({
      expected: { from: { date: '2026-10-23', cents: 50_000 }, to: { date: '2026-12-31', cents: 100_000 } },
    }),
  )
  expect(rows.map((r) => [r.date, r.expected])).toEqual([
    ['2026-10-23', 50_000],
    ['2026-10-30', null],
    ['2026-12-31', 100_000],
  ])
})

test('expected and projected null add no rows', () => {
  const rows = chartRows(goalDetail())
  expect(rows).toHaveLength(2)
  expect(rows.every((r) => r.expected === null && r.atThisRate === null && r.debtAtThisRate === null)).toBe(
    true,
  )
})

test('an undated debt goal: both paths start from today and meet on the projected date', () => {
  const rows = chartRows(debtGoalDetail())
  const today = rows.find((r) => r.date === '2026-10-30')!
  expect(today.atThisRate).toBe(300_000)
  expect(today.debtAtThisRate).toBe(800_000)
  const end = rows.at(-1)!
  expect(end.date).toBe('2027-02-10')
  expect(end.atThisRate).toBe(575_000)
  expect(end.debtAtThisRate).toBe(575_000)
  expect(rows[0]!.atThisRate).toBeNull()
  expect(rows[0]!.debtAtThisRate).toBeNull()
})

test("a save goal's projection has no debt line", () => {
  const base = goalDetail()
  const rows = chartRows({
    ...base,
    goal: { ...base.goal, status: 'projected', projectedDate: '2027-03-01' },
    projected: { date: '2027-03-01', saverCents: 100_000 },
  })
  expect(rows.find((r) => r.date === '2026-10-30')!.atThisRate).toBe(62_000)
  expect(rows.at(-1)!.atThisRate).toBe(100_000)
  expect(rows.every((r) => r.debtAtThisRate === null)).toBe(true)
})

test('a debt line stays null until the debt began', () => {
  const rows = chartRows(
    debtGoalDetail({
      points: [
        { date: '2026-10-16', balanceCents: 280_000, targetCents: null },
        { date: '2026-10-23', balanceCents: 290_000, targetCents: 810_000 },
        { date: '2026-10-30', balanceCents: 300_000, targetCents: 800_000 },
      ],
    }),
  )
  expect(rows.slice(0, 3).map((r) => r.target)).toEqual([null, 810_000, 800_000])
})

test('a date between two points does not break the saved or target line there', () => {
  const rows = chartRows(
    goalDetail({
      expected: { from: { date: '2026-10-26', cents: 50_000 }, to: { date: '2026-12-31', cents: 100_000 } },
    }),
  )
  const between = rows.find((r) => r.date === '2026-10-26')!
  expect(between.saved).toBe(60_000)
  expect(between.target).toBe(100_000)
})

test('a date between two points before the debt began leaves its line broken', () => {
  const rows = chartRows(
    debtGoalDetail({
      points: [
        { date: '2026-10-16', balanceCents: 280_000, targetCents: null },
        { date: '2026-10-30', balanceCents: 300_000, targetCents: 800_000 },
      ],
      expected: { from: { date: '2026-10-20', cents: 50_000 }, to: { date: '2026-12-31', cents: 800_000 } },
    }),
  )
  expect(rows.find((r) => r.date === '2026-10-20')!.target).toBeNull()
})

test('the lines start at the first point: a goal older than the range leaves its first row empty', () => {
  const rows = chartRows(
    goalDetail({
      expected: { from: { date: '2026-01-01', cents: 0 }, to: { date: '2026-12-31', cents: 100_000 } },
    }),
  )
  expect(rows[0]).toMatchObject({ date: '2026-01-01', saved: null, target: null, expected: 0 })
  expect(rows[1]).toMatchObject({ date: '2026-10-23', saved: 60_000, target: 100_000 })
})

test('past the last point a flat target carries on to meet the paths; the balance and a debt do not', () => {
  const flat = chartRows(
    goalDetail({
      expected: { from: { date: '2026-10-23', cents: 50_000 }, to: { date: '2026-12-31', cents: 100_000 } },
    }),
  ).at(-1)!
  expect(flat).toMatchObject({ date: '2026-12-31', saved: null, target: 100_000 })

  const debt = chartRows(debtGoalDetail()).at(-1)!
  expect(debt).toMatchObject({ date: '2027-02-10', saved: null, target: null })
})

const startedLastYear = () =>
  goalDetail({
    range: '3m',
    expected: { from: { date: '2025-11-01', cents: 0 }, to: { date: '2026-12-31', cents: 100_000 } },
  })

test("the domain starts at the range's first point, however long ago the goal started", () => {
  const d = startedLastYear()
  expect(chartDomain(d)).toEqual([at('2026-10-23'), at('2026-12-31')])
  // The table still gets the true start.
  expect(chartRows(d)[0]).toMatchObject({ date: '2025-11-01', expected: 0 })
})

test('clipping the start leaves the expected line at its true height on the left edge', () => {
  const rows = plotRows(startedLastYear())
  expect(rows.map((r) => r.date)).toEqual(['2026-10-23', '2026-10-30', '2026-12-31'])
  const share = (at('2026-10-23') - at('2025-11-01')) / (at('2026-12-31') - at('2025-11-01'))
  expect(rows[0]!.expected).toBe(Math.round(share * 100_000))
  expect(rows[1]!.expected).toBeNull()
  expect(rows[2]!.expected).toBe(100_000)
})

test('a goal that started inside the range is plotted from its first point, unchanged', () => {
  const d = goalDetail({
    expected: { from: { date: '2026-10-26', cents: 50_000 }, to: { date: '2026-12-31', cents: 100_000 } },
  })
  expect(plotRows(d)).toEqual(chartRows(d))
  expect(chartDomain(d)).toEqual([at('2026-10-23'), at('2026-12-31')])
})

test('with no paths the domain is the points, and one point is a domain of one day', () => {
  expect(chartDomain(goalDetail())).toEqual([at('2026-10-23'), at('2026-10-30')])
  const one = goalDetail({ points: [{ date: '2026-10-30', balanceCents: 5_000, targetCents: null }] })
  expect(chartDomain(one)).toEqual([at('2026-10-30'), at('2026-10-30')])
})

test('a Saver with no goal charts its balance only', () => {
  const base = goalDetail()
  const rows = chartRows({
    ...base,
    goal: { ...base.goal, goal: null, status: null },
    points: [{ date: '2026-10-30', balanceCents: 5_000, targetCents: null }],
  })
  expect(rows).toEqual([
    expect.objectContaining({
      date: '2026-10-30',
      saved: 5_000,
      target: null,
      expected: null,
      atThisRate: null,
    }),
  ])
})

test('a projection years out is cut at twelve months, with the dashed line at its height on the edge', () => {
  const d = goalDetail({ range: '3m', projected: { date: '2031-10-30', saverCents: 100_000 } })
  expect(chartDomain(d)).toEqual([at('2026-10-23'), at('2027-10-30')])
  const edge = plotRows(d).at(-1)!
  expect(edge.date).toBe('2027-10-30')
  // 365 of the 1826 days from 62,000 to 100,000.
  expect(edge.atThisRate).toBe(Math.round(62_000 + (38_000 * 365) / 1826))
  expect(edge.saved).toBeNull()
  // A flat target carries on to the edge, and the true end is still in the table's rows.
  expect(edge.target).toBe(100_000)
  expect(chartRows(d).at(-1)!.date).toBe('2031-10-30')
})

test('a debt projected far out is clipped at the edge for both of its dashed lines', () => {
  const d = debtGoalDetail({ range: 'all', projected: { date: '2031-10-30', saverCents: 100_000 } })
  const edge = plotRows(d).at(-1)!
  expect(edge.date).toBe('2027-10-30')
  expect(edge.atThisRate).toBe(Math.round(300_000 + (-200_000 * 365) / 1826))
  expect(edge.debtAtThisRate).toBe(Math.round(800_000 + (-700_000 * 365) / 1826))
  expect(edge.target).toBeNull()
})

test('a date inside the cap is untouched', () => {
  const d = goalDetail({
    range: '3m',
    expected: { from: { date: '2026-10-01', cents: 0 }, to: { date: '2026-12-30', cents: 100_000 } },
  })
  expect(chartDomain(d)).toEqual([at('2026-10-23'), at('2026-12-30')])
  expect(plotRows(d).map((r) => r.date)).toEqual(['2026-10-23', '2026-10-30', '2026-12-30'])
})

test('a series with a single value is named, so it can be drawn as a dot', () => {
  const lone = goalDetail({
    points: [
      { date: '2026-10-23', balanceCents: 60_000, targetCents: null },
      { date: '2026-10-30', balanceCents: 62_000, targetCents: 80_000 },
    ],
  })
  expect(singleValued(chartRows(lone))).toEqual(['target'])
  expect(singleValued(chartRows(goalDetail()))).toEqual([])
  const one = goalDetail({ points: [{ date: '2026-10-30', balanceCents: 62_000, targetCents: 100_000 }] })
  expect(singleValued(chartRows(one))).toEqual(['saved', 'target'])
})
