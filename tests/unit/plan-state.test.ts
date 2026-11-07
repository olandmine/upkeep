import { expect, test } from 'vitest'
import { planStateOf } from '../../src/web/lib/plan-state'

const q = (over: Partial<Parameters<typeof planStateOf>[0]> = {}) => ({ isLoading: false, isError: false, hasData: true, ...over })

test('a loaded plan is ready', () => {
  expect(planStateOf(q(), false)).toBe('ready')
})

test('loading plan or joint period is loading, not an empty plan', () => {
  expect(planStateOf(q({ isLoading: true, hasData: false }), false)).toBe('loading')
  expect(planStateOf(q(), true)).toBe('loading')
})

test('a plan that failed with nothing to show is an error', () => {
  expect(planStateOf(q({ isError: true, hasData: false }), false)).toBe('error')
})

test('a failed refetch keeps the page, because the data it had is still there', () => {
  expect(planStateOf(q({ isError: true, hasData: true }), false)).toBe('ready')
})
