import { beforeEach, expect, test } from 'vitest'
import type { DebtInputDto, PayoffPlanDto } from '../../src/shared/types'
import { createTestApp, type TestApp } from '../helpers/app'

const NOW = new Date('2026-10-30T01:00:00Z')

let t: TestApp
let owner: string
let partner: string
let ownerId: string

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await t.json(path, { cookie: owner, ...init })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const addDebt = (over: Partial<DebtInputDto> = {}, cookie = owner) =>
  call('/api/debts', {
    method: 'POST',
    cookie,
    body: {
      name: 'Car loan',
      kind: 'loan',
      ownerUserId: ownerId,
      rateBp: 900,
      repaymentCents: 45_000,
      repaymentFrequency: 'monthly',
      balanceCents: 1_000_000,
      asOf: '2026-10-01',
      ...over,
    },
  })

const plan = async (scope: string, cookie = owner) =>
  (await call(`/api/payoff-plan?scope=${scope}`, { cookie })).body as PayoffPlanDto
const put = (scope: string, body: unknown, cookie = owner) =>
  call(`/api/payoff-plan?scope=${scope}`, { method: 'PUT', body, cookie })

beforeEach(async () => {
  t = createTestApp({ now: NOW })
  owner = await t.setupOwner()
  partner = await t.addPartner(owner)
  ownerId = (await call('/api/me')).body.id
})

test('defaults and three scenarios', async () => {
  await addDebt()
  await addDebt({
    name: 'Card',
    kind: 'credit_card',
    rateBp: 2000,
    balanceCents: 300_000,
    repaymentCents: 10_000,
  })
  const p = await plan('me')
  expect(p.scenarios.map((s) => s.strategy)).toEqual(['as-is', 'avalanche', 'snowball'])
  expect(p).toMatchObject({ extraCents: 0, includeHecs: false, canEdit: true })
  expect(p.scenarios[0]?.debts.map((d) => d.name)).toEqual(['Car loan', 'Card'])
  expect(p.scenarios[0]?.series[0]?.month).toBe('2026-11')
})

test('hecs excluded until included', async () => {
  await addDebt()
  await addDebt({ name: 'HECS', kind: 'hecs', rateBp: 320, repaymentCents: 0 })
  expect((await plan('me')).scenarios[0]?.debts.map((d) => d.name)).toEqual(['Car loan'])
  expect((await put('me', { extraCents: 5_000, includeHecs: true })).status).toBe(204)
  const p = await plan('me')
  expect(p).toMatchObject({ extraCents: 5_000, includeHecs: true })
  expect(p.scenarios[0]?.debts.map((d) => d.name)).toEqual(['Car loan', 'HECS'])
})

test('settings per scope', async () => {
  await put('me', { extraCents: 20_000, includeHecs: false })
  expect((await plan('me')).extraCents).toBe(20_000)
  expect((await plan('joint')).extraCents).toBe(0)
  expect((await plan('everyone')).extraCents).toBe(0)
  // The owner's "me" is the partner's "partner".
  expect((await plan('partner', partner)).extraCents).toBe(20_000)
})

test('partner scope is read-only', async () => {
  expect((await plan('partner')).canEdit).toBe(false)
  expect((await put('partner', { extraCents: 1, includeHecs: false })).status).toBe(403)
  expect((await put('joint', { extraCents: 1, includeHecs: false }, partner)).status).toBe(204)
})

test('paid-off debts are left out', async () => {
  await addDebt({ name: 'Done', balanceCents: 0 })
  await addDebt()
  expect((await plan('me')).scenarios[0]?.debts.map((d) => d.name)).toEqual(['Car loan'])
})

test('nothing to pay off has no differences', async () => {
  await addDebt({ name: 'HECS', kind: 'hecs', rateBp: 320, repaymentCents: 0 })
  const p = await plan('me')
  expect(p.scenarios[0]?.debts).toEqual([])
  expect(p.differences).toEqual([])
})
