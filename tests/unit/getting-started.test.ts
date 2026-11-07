import { expect, test } from 'vitest'
import { gettingStarted, type GettingStartedFacts } from '../../src/server/onboarding/getting-started'

const base: GettingStartedFacts = {
  hidden: false,
  connected: false,
  historyImported: false,
  givenPassword: null,
  handleLeftBlank: false,
  hasHandle: false,
  isFirstUser: true,
  hasSecondLogin: false,
  budgetPlanned: false,
  hasJointAccount: false,
  jointBudgetPlanned: false,
  hasDebt: false,
  hasGoal: false,
}

const all: GettingStartedFacts = {
  ...base,
  givenPassword: 'kept',
  handleLeftBlank: true,
  hasJointAccount: true,
}

const states = (f: Partial<GettingStartedFacts>) =>
  Object.fromEntries(gettingStarted({ ...base, ...f }).items.map((i) => [i.key, i.state]))
const keys = (f: Partial<GettingStartedFacts>) => gettingStarted({ ...base, ...f }).items.map((i) => i.key)

test('a new first user, not connected', () => {
  const dto = gettingStarted(base)
  expect(dto.show).toBe(true)
  expect(dto.items).toEqual([
    { key: 'connect-up', state: 'open', optional: false },
    { key: 'partner', state: 'open', optional: false },
    { key: 'budget', state: 'locked', optional: false },
    { key: 'debt', state: 'open', optional: true },
    { key: 'goal', state: 'locked', optional: true },
  ])
})

test('rows only appear for the people they apply to', () => {
  expect(keys({})).not.toContain('password')
  expect(states({ givenPassword: 'kept' }).password).toBe('open')
  expect(states({ givenPassword: 'changed' }).password).toBe('done')

  expect(keys({})).not.toContain('handle')
  expect(states({ handleLeftBlank: true, hasHandle: false }).handle).toBe('open')
  expect(states({ handleLeftBlank: true, hasHandle: true }).handle).toBe('done')

  expect(keys({ isFirstUser: false })).not.toContain('partner')
  expect(states({ isFirstUser: true, hasSecondLogin: true }).partner).toBe('done')

  expect(keys({ hasJointAccount: false })).not.toContain('joint-budget')
  expect(keys({ hasJointAccount: true })).toContain('joint-budget')
})

test('rows come in order', () => {
  expect(keys(all)).toEqual([
    'connect-up',
    'password',
    'handle',
    'partner',
    'budget',
    'joint-budget',
    'debt',
    'goal',
  ])
})

test('history unlocks budget, joint budget and goal', () => {
  const locked = states({ ...all, historyImported: false })
  expect([locked.budget, locked['joint-budget'], locked.goal]).toEqual(['locked', 'locked', 'locked'])
  const open = states({ ...all, historyImported: true })
  expect([open.budget, open['joint-budget'], open.goal]).toEqual(['open', 'open', 'open'])
})

test('done beats locked', () => {
  const s = states({ ...all, historyImported: false, jointBudgetPlanned: true, budgetPlanned: true, hasGoal: true })
  expect([s.budget, s['joint-budget'], s.goal]).toEqual(['done', 'done', 'done'])
})

test('only debt and goal are optional', () => {
  const optional = gettingStarted(all).items.filter((i) => i.optional).map((i) => i.key)
  expect(optional).toEqual(['debt', 'goal'])
})

const counted: Partial<GettingStartedFacts> = {
  connected: true,
  historyImported: true,
  budgetPlanned: true,
  hasHandle: true,
  hasSecondLogin: true,
  jointBudgetPlanned: true,
  givenPassword: 'changed',
  handleLeftBlank: true,
  hasJointAccount: true,
}

test('optional rows never hold the card open', () => {
  const dto = gettingStarted({ ...base, ...counted, hasDebt: false, hasGoal: false })
  expect(dto.items.filter((i) => !i.optional).every((i) => i.state === 'done')).toBe(true)
  expect(dto.items.filter((i) => i.optional).every((i) => i.state !== 'done')).toBe(true)
  expect(dto.show).toBe(false)
})

test('hidden closes the card, whatever is left', () => {
  expect(gettingStarted({ ...base, hidden: true }).show).toBe(false)
})

test('it reopens when a counted row comes undone', () => {
  expect(gettingStarted({ ...base, ...counted }).show).toBe(false)
  expect(gettingStarted({ ...base, ...counted, connected: false }).show).toBe(true)
})
