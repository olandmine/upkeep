import { eq } from 'drizzle-orm'
import * as s from '../../src/server/db/schema'
import { beforeEach, expect, test } from 'vitest'
import type { NetWorthDto } from '../../src/shared/types'
import { createTestApp, type TestApp } from '../helpers/app'
import { local, seedAccount, seedTx } from '../helpers/budget-seed'

const NOW = new Date('2026-10-30T01:00:00Z')

let t: TestApp
let owner: string
let ownerId: string
let partnerId: string

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await t.json(path, { cookie: owner, ...init })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const netWorth = async (scope: string, range = '6m') =>
  (await call(`/api/net-worth?scope=${scope}&range=${range}`)).body as NetWorthDto
const at = (n: NetWorthDto, date: string) => n.points.find((p) => p.date === date)

beforeEach(async () => {
  t = createTestApp({ now: NOW })
  owner = await t.setupOwner()
  const partner = await t.addPartner(owner)
  ownerId = (await call('/api/me')).body.id
  partnerId = (await call('/api/me', { cookie: partner })).body.id
  seedAccount(t.db, { id: 'acc-spend', owner: ownerId, balanceCents: 500_000 })
  seedAccount(t.db, { id: 'acc-p', owner: partnerId, balanceCents: 100_000 })
})

test('net worth subtracts debts from their first starting point', async () => {
  await call('/api/debts', {
    method: 'POST',
    body: {
      name: 'Car loan',
      kind: 'loan',
      ownerUserId: ownerId,
      rateBp: 0,
      repaymentCents: 0,
      repaymentFrequency: 'monthly',
      balanceCents: 200_000,
      asOf: '2026-09-01',
    },
  })
  const n = await netWorth('me')
  expect(at(n, '2026-08-28')).toEqual({
    date: '2026-08-28',
    upCents: 500_000,
    debtCents: 0,
    netCents: 500_000,
  })
  expect(at(n, '2026-10-30')).toEqual({
    date: '2026-10-30',
    upCents: 500_000,
    debtCents: 200_000,
    netCents: 300_000,
  })
  expect(n).toMatchObject({ todayCents: 300_000, changeCents: -200_000, historyFrom: null })
})

test('scope filters accounts and debts', async () => {
  expect((await netWorth('me')).todayCents).toBe(500_000)
  expect((await netWorth('partner')).todayCents).toBe(100_000)
  expect((await netWorth('everyone')).todayCents).toBe(600_000)
  expect((await netWorth('joint')).todayCents).toBe(0)
})

test('history from', async () => {
  // Balance 100,000 but only +20,000 synced: it didn't open at $0, so older history is missing.
  seedAccount(t.db, { id: 'acc-old', owner: ownerId, type: 'SAVER', balanceCents: 100_000 })
  seedTx(t.db, { id: 'o1', accountId: 'acc-old', amountCents: 20_000, createdAt: local('2026-07-15') })
  const n = await netWorth('me')
  expect(n.historyFrom).toBe('2026-07-15')
  expect(n.points.every((p) => p.date >= '2026-07-15')).toBe(true)
})

test('held transactions count', async () => {
  seedTx(t.db, {
    id: 'h1',
    accountId: 'acc-spend',
    amountCents: -5_000,
    createdAt: local('2026-10-20'),
    status: 'HELD',
  })
  seedTx(t.db, {
    id: 'd1',
    accountId: 'acc-spend',
    amountCents: -9_999,
    createdAt: local('2026-10-21'),
    deletedAt: NOW.toISOString(),
  })
  seedTx(t.db, { id: 'open', accountId: 'acc-spend', amountCents: 505_000, createdAt: local('2025-01-02') })
  const n = await netWorth('me')
  expect(at(n, '2026-10-16')?.upCents).toBe(505_000)
  expect(n.todayCents).toBe(500_000)
  expect(n.historyFrom).toBeNull()
})

test('all range goes back to the first transaction', async () => {
  seedTx(t.db, { id: 'open', accountId: 'acc-spend', amountCents: 500_000, createdAt: local('2026-05-12') })
  const n = await netWorth('me', 'all')
  expect(n.points.map((p) => p.date)).toEqual([
    '2026-05-31',
    '2026-06-30',
    '2026-07-31',
    '2026-08-31',
    '2026-09-30',
    '2026-10-30',
  ])
})

test('round-ups leave Spending too', async () => {
  seedTx(t.db, { id: 'open', accountId: 'acc-spend', amountCents: 501_196, createdAt: local('2025-01-02') })
  seedTx(t.db, { id: 'buy', accountId: 'acc-spend', amountCents: -1_000, createdAt: local('2026-10-20') })
  t.db.update(s.transactions).set({ roundUpCents: -196 }).where(eq(s.transactions.id, 'buy')).run()
  const n = await netWorth('me')
  expect(at(n, '2026-10-16')?.upCents).toBe(501_196)
  expect(n.todayCents).toBe(500_000)
  expect(n.historyFrom).toBeNull()
})
