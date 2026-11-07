import { beforeEach, describe, expect, test } from 'vitest'
import { levelAllows, SHARING_LEVELS } from '../../src/shared/sharing'
import type { Db } from '../../src/server/db/client'
import { canSee, canSeeAccount } from '../../src/server/sharing/policy'
import { seedUser } from '../helpers/budget-seed'
import { createTestDb } from '../helpers/db'

test.each([
  ['full', true, true, true],
  ['hide-transactions', true, true, false],
  ['balances', true, false, false],
  ['none', false, false, false],
  [null, false, false, false],
] as const)('levelAllows %s', (level, balances, finances, transactions) => {
  expect(levelAllows(level, 'balances')).toBe(balances)
  expect(levelAllows(level, 'finances')).toBe(finances)
  expect(levelAllows(level, 'transactions')).toBe(transactions)
})

describe('policy against a seeded DB', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  const setOwnerLevel = (level: (typeof SHARING_LEVELS)[number] | null) => {
    seedUser(db, 'viewer')
    seedUser(db, 'owner', 'owner', undefined, level)
  }

  test.each([...SHARING_LEVELS, null])('canSee: own data and null owner are always visible (owner at %s)', (level) => {
    setOwnerLevel(level)
    expect(canSee(db, 'owner', 'owner', 'transactions')).toBe(true)
    expect(canSee(db, 'viewer', null, 'transactions')).toBe(true)
  })

  test.each([...SHARING_LEVELS, null])("canSee follows the owner's level (%s)", (level) => {
    setOwnerLevel(level)
    for (const data of ['balances', 'finances', 'transactions'] as const) {
      expect(canSee(db, 'viewer', 'owner', data)).toBe(levelAllows(level, data))
    }
  })

  test.each([...SHARING_LEVELS, null])('canSeeAccount: joint is always visible (owner at %s)', (level) => {
    setOwnerLevel(level)
    expect(canSeeAccount(db, 'viewer', { ownership: 'JOINT', ownerUserId: null }, 'transactions')).toBe(true)
  })

  test('canSeeAccount: an individual account with no owner is hidden', () => {
    setOwnerLevel('full')
    expect(canSeeAccount(db, 'viewer', { ownership: 'INDIVIDUAL', ownerUserId: null }, 'balances')).toBe(false)
  })

  test.each([...SHARING_LEVELS, null])("canSeeAccount: an individual account follows its owner's level (%s)", (level) => {
    setOwnerLevel(level)
    const account = { ownership: 'INDIVIDUAL', ownerUserId: 'owner' }
    for (const data of ['balances', 'finances', 'transactions'] as const) {
      expect(canSeeAccount(db, 'viewer', account, data)).toBe(levelAllows(level, data))
    }
    expect(canSeeAccount(db, 'owner', account, 'transactions')).toBe(true)
  })
})
