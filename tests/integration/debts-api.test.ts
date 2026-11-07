import { beforeEach, expect, test } from 'vitest'
import type { DebtDetailDto, DebtDto, DebtInputDto } from '../../src/shared/types'
import { createTestApp, type TestApp } from '../helpers/app'

const NOW = new Date('2026-10-30T01:00:00Z') // 12:00 in Sydney

let t: TestApp
let owner: string
let partner: string
let ownerId: string

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await t.json(path, { cookie: owner, ...init })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const loan = (over: Partial<DebtInputDto> = {}): DebtInputDto => ({
  name: 'Car loan',
  kind: 'loan',
  ownerUserId: ownerId,
  rateBp: 649,
  repaymentCents: 45_000,
  repaymentFrequency: 'monthly',
  balanceCents: 1_000_000,
  asOf: '2026-10-01',
  ...over,
})

const create = async (over: Partial<DebtInputDto> = {}, cookie = owner) =>
  call('/api/debts', { method: 'POST', body: loan(over), cookie })
const list = async (scope: string, cookie = owner) =>
  (await call(`/api/debts?scope=${scope}`, { cookie })).body as DebtDto[]
const detail = async (id: string) => (await call(`/api/debts/${id}`)).body as DebtDetailDto

beforeEach(async () => {
  t = createTestApp({ now: NOW })
  owner = await t.setupOwner()
  partner = await t.addPartner(owner)
  ownerId = (await call('/api/me')).body.id
})

test('creates and lists a debt in scope', async () => {
  const res = await create()
  expect(res.status).toBe(201)
  expect(res.body).toMatchObject({ name: 'Car loan', ownerName: 'Owner', canEdit: true, estimated: true })
  expect((await list('me')).map((d) => d.name)).toEqual(['Car loan'])
  expect(await list('joint')).toEqual([])
  expect(await list('everyone')).toHaveLength(1)
  expect(await list('partner', partner)).toHaveLength(1)
  expect(await list('me', partner)).toEqual([])
})

test('rejects bad input', async () => {
  expect(await create({ rateBp: 10_001 })).toMatchObject({
    status: 400,
    body: { error: 'Rate must be between 0% and 100%.' },
  })
  expect(await create({ asOf: '2026-11-01' })).toMatchObject({
    status: 400,
    body: { error: "Balance date can't be in the future." },
  })
})

test('partner can view but not edit', async () => {
  const id = (await create()).body.id
  const seen = await call(`/api/debts/${id}`, { cookie: partner })
  expect(seen.status).toBe(200)
  expect(seen.body.canEdit).toBe(false)
  expect(
    await call(`/api/debts/${id}`, { method: 'PATCH', body: { name: 'Mine now' }, cookie: partner }),
  ).toMatchObject({ status: 403, body: { error: 'Only Owner can edit that.' } })
  expect((await call(`/api/debts/${id}`, { method: 'DELETE', cookie: partner })).status).toBe(403)
})

test('joint debts are editable by both', async () => {
  const id = (await create({ ownerUserId: null, name: 'Tax' })).body.id
  const res = await call(`/api/debts/${id}`, { method: 'PATCH', body: { name: 'ATO plan' }, cookie: partner })
  expect(res.status).toBe(200)
  expect(res.body).toMatchObject({ name: 'ATO plan', ownerName: 'Joint', canEdit: true })
  expect((await list('joint', partner)).map((d) => d.name)).toEqual(['ATO plan'])
})

test('cannot create a debt for the partner', async () => {
  const partnerId = (await call('/api/me', { cookie: partner })).body.id
  expect((await create({ ownerUserId: partnerId })).status).toBe(403)
})

test('update balance replaces same date and records corrections', async () => {
  const id = (await create({ rateBp: 0, repaymentCents: 0 })).body.id
  expect(
    (
      await call(`/api/debts/${id}/balances`, {
        method: 'POST',
        body: { balanceCents: 900_000, asOf: '2026-10-20' },
      })
    ).status,
  ).toBe(204)
  await call(`/api/debts/${id}/balances`, {
    method: 'POST',
    body: { balanceCents: 950_000, asOf: '2026-10-20' },
  })
  const d = await detail(id)
  expect(d.balances.map((b) => [b.asOf, b.balanceCents, b.correctionCents])).toEqual([
    ['2026-10-01', 1_000_000, null],
    ['2026-10-20', 950_000, -50_000],
  ])
  expect(d.balanceCents).toBe(950_000)
})

test('cannot remove the only balance', async () => {
  const id = (await create()).body.id
  const [only] = (await detail(id)).balances
  expect(await call(`/api/debts/${id}/balances/${only!.id}`, { method: 'DELETE' })).toMatchObject({
    status: 400,
    body: { error: 'A debt needs at least one balance.' },
  })
})

test('timeline recalculates after edits', async () => {
  const id = (await create({ rateBp: 1200, repaymentCents: 0, asOf: '2026-08-01' })).body.id
  const after = await detail(id)
  expect(after.balanceCents).toBe(1_020_100) // charged 1 Sep and 1 Oct
  expect(after.timeline.at(-1)).toEqual({ date: '2026-10-30', balanceCents: 1_020_100 })
  expect(after.timeline[0]?.date).toBe('2026-08-01')

  await call(`/api/debts/${id}/balances`, {
    method: 'POST',
    body: { balanceCents: 500_000, asOf: '2026-09-15' },
  })
  const added = (await detail(id)).balances.find((b) => b.asOf === '2026-09-15')!
  await call(`/api/debts/${id}/balances/${added.id}`, { method: 'DELETE' })
  const removed = await detail(id)
  expect(removed.balances).toHaveLength(1)
  expect(removed.balanceCents).toBe(1_020_100)
})

test('projection and delete', async () => {
  const id = (await create({ kind: 'bnpl', rateBp: 500, repaymentCents: 250_000, balanceCents: 1_000_000 }))
    .body.id
  const d = await detail(id)
  expect(d.rateBp).toBe(0) // BNPL has no interest
  // Estimated: 1 Oct start → nothing due before 1 Nov, so the balance is unchanged; four dues pay it off.
  expect(d.projection).toEqual({ payoffDate: '2027-02-01', totalInterestCents: 0, shortfallCents: null })
  expect((await call(`/api/debts/${id}`, { method: 'DELETE' })).status).toBe(204)
  expect((await call(`/api/debts/${id}`)).status).toBe(404)
})

test("a new debt gets its kind's interest settings and a first rate", async () => {
  const ato = (await create({ kind: 'ato', name: 'Tax', rateBp: 1063, repaymentCents: 0 })).body as DebtDto
  expect(ato.interest).toEqual({ calc: 'daily', charge: 'monthly', chargeDay: 1, chargeDate: null })
  const d = await detail(ato.id)
  expect(d.rates).toEqual([{ id: expect.any(String), fromDate: '2026-10-01', rateBp: 1063 }])
  expect(d.rateBp).toBe(1063)
  // Built up daily from 2 Oct to 30 Oct (29 days), charged on 1 Nov: the balance hasn't moved yet.
  expect(d.accruingCents).toBe(8_446)
  expect(d.balanceCents).toBe(1_000_000)
  expect(d.nextChargeOn).toBe('2026-11-01')
  expect(d.activity.map((a) => a.kind)).toEqual(['check', 'rate'])

  const car = (await create({ asOf: '2026-10-15' })).body as DebtDto
  expect(car.interest).toEqual({ calc: 'on_charge', charge: 'monthly', chargeDay: 15, chargeDate: null })
  expect(car.accruingCents).toBe(0)

  const custom = { calc: 'daily', charge: 'yearly', chargeDay: null, chargeDate: '07-01' } as const
  const set = (await call('/api/debts', { method: 'POST', body: { ...loan(), interest: custom } })).body as DebtDto
  expect(set.interest).toEqual(custom)
})

test('interest settings validate', async () => {
  const interest = (over: object) => ({
    ...loan(),
    interest: { calc: 'on_charge', charge: 'monthly', chargeDay: 15, chargeDate: null, ...over },
  })
  expect(await call('/api/debts', { method: 'POST', body: interest({ chargeDay: 32 }) })).toMatchObject({
    status: 400,
    body: { error: 'Pick a day from 1 to 31.' },
  })
  expect(await call('/api/debts', { method: 'POST', body: interest({ chargeDay: null }) })).toMatchObject({
    status: 400,
    body: { error: 'Pick a day from 1 to 31.' },
  })
  expect(
    await call('/api/debts', { method: 'POST', body: interest({ charge: 'yearly', chargeDate: 'June' }) }),
  ).toMatchObject({ status: 400, body: { error: 'Pick a date for yearly interest.' } })
  expect(
    await call('/api/debts', { method: 'POST', body: interest({ charge: 'yearly', chargeDate: '13-01' }) }),
  ).toMatchObject({ status: 400, body: { error: 'Pick a date for yearly interest.' } })

  const id = (await create()).body.id
  expect(
    await call(`/api/debts/${id}`, { method: 'PATCH', body: { interest: interest({ chargeDay: 0 }).interest } }),
  ).toMatchObject({ status: 400, body: { error: 'Pick a day from 1 to 31.' } })
  const daily = { calc: 'daily', charge: 'daily', chargeDay: null, chargeDate: null }
  const res = await call(`/api/debts/${id}`, { method: 'PATCH', body: { interest: daily } })
  expect(res.status).toBe(200)
  expect(res.body.interest).toEqual(daily)
})

test('PATCH ignores rateBp', async () => {
  const id = (await create()).body.id
  const res = await call(`/api/debts/${id}`, { method: 'PATCH', body: { name: 'Ute loan', rateBp: 1200 } })
  expect(res.status).toBe(200)
  expect(res.body).toMatchObject({ name: 'Ute loan', rateBp: 649 })
  expect((await detail(id)).rates.map((r) => r.rateBp)).toEqual([649])
})

test('an account fee is saved, charged in Activity, and can be removed', async () => {
  const fee = { amountCents: 995, frequency: 'monthly', from: '2026-10-05' } as const
  const { body } = await create({ rateBp: 0, repaymentCents: 0, fee })
  expect(body.fee).toEqual(fee)
  let d = await detail(body.id)
  expect(d.activity.filter((a) => a.kind === 'fee').map((a) => [a.date, a.amountCents])).toEqual([['2026-10-05', 995]])
  expect(d.balanceCents).toBe(1_000_995)

  const yearly = { amountCents: 9_900, frequency: 'yearly', from: '2026-10-20' } as const
  expect((await call(`/api/debts/${body.id}`, { method: 'PATCH', body: { fee: yearly } })).body.fee).toEqual(yearly)
  d = await detail(body.id)
  expect(d.activity.filter((a) => a.kind === 'fee').map((a) => a.date)).toEqual(['2026-10-20'])

  expect((await call(`/api/debts/${body.id}`, { method: 'PATCH', body: { fee: null } })).body.fee).toBeNull()
  expect((await create()).body.fee).toBeNull()
})

test('a fee must be more than $0 with a real date', async () => {
  const bad = await create({ fee: { amountCents: 0, frequency: 'monthly', from: '2026-10-05' } })
  expect(bad).toMatchObject({ status: 400, body: { error: 'Fee must be more than $0.' } })
  expect((await create({ fee: { amountCents: 100, frequency: 'monthly', from: '2026-02-30' } })).status).toBe(400)
})
