import { expect, test } from 'vitest'
import { goalSections, goalSummary, nextStepText } from '../../src/web/components/goals/summary'
import { goal, sixGoals } from './goal-fixtures'

const names = (gs: { goal: { name: string } | null }[]) => gs.map((g) => g.goal?.name)

test('summary', () => {
  expect(goalSummary(sixGoals(), '2026-11-05')).toEqual({
    count: 4,
    savedCents: 248_000 + 245_000 + 890_000 + 1_000_000,
    targetCents: 495_000 + 600_000 + 1_120_000 + 1_000_000,
    behind: 1,
    datePassed: 0,
    buffersLow: 1,
    onTrack: 1,
    next: { name: 'Tax', date: '2027-03-31' },
  })
})

test('summary skips missing Savers and past dates', () => {
  const s = goalSummary(
    [
      goal({ accountMissing: true }),
      goal({ status: 'date-passed', goal: { kind: 'save', name: 'Old', targetCents: 1, targetDate: '2026-01-01' } }),
    ],
    '2026-11-05',
  )
  expect(s.count).toBe(1)
  expect(s.datePassed).toBe(1)
  expect(s.next).toBeNull()
})

test('sections', () => {
  const s = goalSections(sixGoals())
  expect(names(s.attention)).toEqual(['Tax', 'Food'])
  expect(names(s.dated)).toEqual(['Holiday'])
  expect(names(s.undated)).toEqual(['Car'])
  expect(names(s.reached)).toEqual(['Emergency'])
  expect(s.withoutGoal.map((g) => g.saverName)).toEqual(['Rent Saver'])
})

test('attention sorts by date then buffers, missing Savers last', () => {
  const mk = (name: string, targetDate: string | null, status: 'behind' | 'below') =>
    goal({ status, goal: { kind: status === 'below' ? 'buffer' : 'save', name, targetCents: 1, targetDate } })
  const s = goalSections([
    mk('B', null, 'below'),
    mk('Late', '2027-05-01', 'behind'),
    mk('Soon', '2027-01-01', 'behind'),
    goal({ accountMissing: true, status: null, goal: { kind: 'save', name: 'Aaa', targetCents: 1, targetDate: null } }),
    goal({ status: 'topped-up', goal: { kind: 'buffer', name: 'Zed', targetCents: 1, targetDate: null } }),
  ])
  expect(names(s.attention)).toEqual(['Soon', 'Late', 'B'])
  expect(names(s.undated)).toEqual(['Zed', 'Aaa'])
})

const save = { kind: 'save' as const, name: 'X', targetCents: 100_000, targetDate: '2027-03-31' }

test('next step lines', () => {
  const behind = { status: 'behind' as const, neededCents: 24_700, recentRateCents: 20_000, goal: save }
  expect(nextStepText(goal(behind))).toBe('$247.00 a pay to reach it by 31 Mar · lately about $200.00')
  expect(nextStepText(goal({ ...behind, goal: { ...save, kind: 'debt' } }))).toBe(
    '$247.00 a pay to cover it by 31 Mar · lately about $200.00',
  )
  expect(nextStepText(goal({ ...behind, neededPer: 'month' }))).toBe(
    '$247.00 a month to reach it by 31 Mar · lately about $200.00',
  )
  expect(
    nextStepText(goal({ status: 'on-track', neededCents: 25_400, goal: { ...save, targetDate: '2027-06-01' } })),
  ).toBe('$254.00 a pay to reach it by 1 June · on track')
  expect(
    nextStepText(
      goal({ status: 'on-track', neededCents: 25_400, goal: { ...save, kind: 'debt', targetDate: '2027-06-01' } }),
    ),
  ).toBe('$254.00 a pay to cover it by 1 June · on track')
  expect(nextStepText(goal({ status: 'projected', projectedDate: null }))).toBe('')
  expect(nextStepText(goal({ status: 'date-passed', toGoCents: 120_000 }))).toBe('The date passed with $1,200.00 to go.')
  expect(nextStepText(goal({ status: 'projected', projectedDate: '2027-02-10' }))).toBe('At this rate, about Feb 2027')
  expect(
    nextStepText(goal({ status: 'projected', projectedDate: '2027-02-10', goal: { ...save, kind: 'debt' } })),
  ).toBe('At this rate, enough to pay it off by Feb 2027')
  expect(nextStepText(goal({ status: 'not-growing', toGoCents: 120_000 }))).toBe('Not growing lately. $1,200.00 to go.')
  expect(
    nextStepText(goal({ status: 'below', belowCents: 4_000, goal: { ...save, kind: 'buffer', targetCents: 40_000 } })),
  ).toBe('$40.00 below · top it up to $400.00')
  expect(nextStepText(goal({ status: 'topped-up' }))).toBe('Topped up')
  expect(nextStepText(goal({ status: 'reached' }))).toBe('Reached ✓')
  expect(nextStepText(goal({ status: 'reached', reachedOn: '2026-10-30' }))).toBe('Reached 30 Oct')
  expect(nextStepText(goal({ accountMissing: true }))).toBe('')
})

test('the Reached section sorts newest first, with undated goals last by name', () => {
  const reached = (name: string, reachedOn: string | null) =>
    goal({ accountId: name, status: 'reached', goal: { kind: 'save', name, targetCents: 100_000, targetDate: null }, reachedOn })
  const s = goalSections([
    reached('Zed', null),
    reached('Old', '2026-08-01'),
    reached('Abe', null),
    reached('New', '2026-10-30'),
  ])
  expect(names(s.reached)).toEqual(['New', 'Old', 'Abe', 'Zed'])
})
