import { beforeEach, expect, test } from 'vitest'
import type { DebtActivityDto, DebtDetailDto, DebtEntryInputDto, DebtInputDto } from '../../src/shared/types'
import { createTestApp, type TestApp } from '../helpers/app'
import { seedAccount } from '../helpers/budget-seed'

const NOW = new Date('2026-10-30T01:00:00Z')

let t: TestApp
let owner: string
let partner: string
let ownerId: string
let partnerId: string

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await t.json(path, { cookie: owner, ...init })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const createDebt = async (over: Partial<DebtInputDto> = {}) =>
  (
    await call('/api/debts', {
      method: 'POST',
      body: {
        name: 'Tax',
        kind: 'ato',
        ownerUserId: ownerId,
        rateBp: 1000,
        repaymentCents: 45_000,
        repaymentFrequency: 'monthly',
        balanceCents: 1_000_000,
        asOf: '2026-06-15',
        ...over,
      },
    })
  ).body.id as string

const detail = async (id: string) => (await call(`/api/debts/${id}`)).body as DebtDetailDto
const interestRow = async (id: string, chargeDate: string) =>
  (await detail(id)).activity.find(
    (r): r is Extract<DebtActivityDto, { kind: 'interest' }> =>
      r.kind === 'interest' && r.chargeDate === chargeDate,
  )
const entryRows = async (id: string) =>
  (await detail(id)).activity.filter((r): r is Extract<DebtActivityDto, { kind: 'added' | 'payment' }> =>
    r.kind === 'added' || r.kind === 'payment',
  )

const entry = (over: Partial<DebtEntryInputDto> = {}): DebtEntryInputDto => ({
  kind: 'added',
  date: '2026-10-01',
  amountCents: 450_000,
  note: null,
  ...over,
})
const addEntry = (id: string, body: unknown, cookie = owner) =>
  call(`/api/debts/${id}/entries`, { method: 'POST', body, cookie })
const putInterest = (id: string, date: string, amountCents: unknown, cookie = owner) =>
  call(`/api/debts/${id}/interest/${date}`, { method: 'PUT', body: { amountCents }, cookie })
const resetInterest = (id: string, date: string, cookie = owner) =>
  call(`/api/debts/${id}/interest/${date}`, { method: 'DELETE', cookie })
const addRate = (id: string, body: unknown, cookie = owner) =>
  call(`/api/debts/${id}/rates`, { method: 'POST', body, cookie })
const setInterest = (id: string, interest: unknown) =>
  call(`/api/debts/${id}`, { method: 'PATCH', body: { interest } })

beforeEach(async () => {
  t = createTestApp({ now: NOW })
  owner = await t.setupOwner()
  partner = await t.addPartner(owner)
  ownerId = (await call('/api/me')).body.id
  partnerId = (await call('/api/me', { cookie: partner })).body.id
  seedAccount(t.db, { id: 'acc-spend', owner: ownerId })
  seedAccount(t.db, { id: 'acc-p-spend', owner: partnerId })
})

test('added and payment entries move the balance', async () => {
  const id = await createDebt()
  const before = (await detail(id)).balanceCents

  const created = await addEntry(id, entry())
  expect(created.status).toBe(204)
  const [row] = await entryRows(id)
  expect(row).toMatchObject({ kind: 'added', date: '2026-10-01', amountCents: 450_000 })
  expect(Math.abs((await detail(id)).balanceCents - (before + 450_000))).toBeLessThanOrEqual(1)

  expect(
    (
      await call(`/api/debts/${id}/entries/${row!.entryId}`, {
        method: 'PATCH',
        body: entry({ amountCents: 400_000, note: ' Fee ' }),
      })
    ).status,
  ).toBe(204)
  expect(await entryRows(id)).toEqual([expect.objectContaining({ amountCents: 400_000, note: 'Fee' })])
  expect(Math.abs((await detail(id)).balanceCents - (before + 400_000))).toBeLessThanOrEqual(1)

  expect((await call(`/api/debts/${id}/entries/${row!.entryId}`, { method: 'DELETE' })).status).toBe(204)
  expect(await entryRows(id)).toEqual([])
  expect(Math.abs((await detail(id)).balanceCents - before)).toBeLessThanOrEqual(1)

  await addEntry(id, entry({ kind: 'payment', amountCents: 100_000 }))
  expect(await entryRows(id)).toEqual([
    expect.objectContaining({ kind: 'payment', amountCents: -100_000, note: null }),
  ])
  expect(Math.abs((await detail(id)).balanceCents - (before - 100_000))).toBeLessThanOrEqual(1)
})

test('entries are validated', async () => {
  const id = await createDebt()
  expect(await addEntry(id, entry({ date: '2026-10-31' }))).toMatchObject({
    status: 400,
    body: { error: "Entry date can't be in the future." },
  })
  expect(await addEntry(id, entry({ amountCents: 0 }))).toMatchObject({
    status: 400,
    body: { error: 'Amount must be more than $0.' },
  })
  expect(await addEntry(id, entry({ note: 'x'.repeat(101) }))).toMatchObject({
    status: 400,
    body: { error: 'Keep the note under 100 characters.' },
  })
  for (const date of ['2026-06-14', '2026-06-15']) {
    expect(await addEntry(id, entry({ date }))).toMatchObject({
      status: 400,
      body: { error: 'Entry date must be after the first balance.' },
    })
  }
  expect((await addEntry(id, entry({ date: '2026-06-16' }))).status).toBe(204)
  await call(`/api/debts/${id}/entries/${(await entryRows(id))[0]!.entryId}`, { method: 'DELETE' })
  expect((await addEntry(id, entry({ note: 'x'.repeat(100) }))).status).toBe(204)
  expect((await addEntry(id, entry({ kind: 'oops' as never }))).status).toBe(400)
  // Updates are checked the same way.
  const [row] = await entryRows(id)
  const patch = (body: unknown) =>
    call(`/api/debts/${id}/entries/${row!.entryId}`, { method: 'PATCH', body })
  expect((await patch(entry({ date: '2026-10-31' }))).status).toBe(400)
  expect((await patch(entry({ amountCents: 0 }))).status).toBe(400)
  expect((await patch(entry({ date: '2026-06-14' }))).status).toBe(400)
  expect((await patch(entry({ date: '2026-06-15' }))).status).toBe(400)
})

test('interest edits replace and reset', async () => {
  const id = await createDebt({ name: 'Tax' })
  const before = await detail(id)
  const calculated = (await interestRow(id, '2026-10-01'))!
  expect(calculated).toMatchObject({ edited: false })
  expect(calculated.amountCents).toBeGreaterThan(0)

  expect((await putInterest(id, '2026-10-01', 0)).status).toBe(204)
  expect(await interestRow(id, '2026-10-01')).toMatchObject({
    edited: true,
    amountCents: 0,
    calculatedCents: calculated.calculatedCents,
  })
  // The edited row is kept even at $0, and the balance drops by what was calculated.
  expect(Math.abs(before.balanceCents - (await detail(id)).balanceCents - calculated.amountCents)).toBeLessThanOrEqual(1)

  expect((await resetInterest(id, '2026-10-01')).status).toBe(204)
  expect(await interestRow(id, '2026-10-01')).toMatchObject({ edited: false, amountCents: calculated.amountCents })
  expect((await detail(id)).balanceCents).toBe(before.balanceCents)

  expect(await putInterest(id, '2026-10-02', 0)).toMatchObject({
    status: 400,
    body: { error: "That isn't one of Tax's interest charges." },
  })
  expect((await putInterest(id, '2026-11-01', 0)).status).toBe(400)
  expect((await putInterest(id, '2026-06-01', 0)).status).toBe(400)
  // The first balance's own day is never charged, so it can't be edited either.
  await setInterest(id, { calc: 'daily', charge: 'monthly', chargeDay: 15, chargeDate: null })
  expect(await putInterest(id, '2026-06-15', 0)).toMatchObject({
    status: 400,
    body: { error: "That isn't one of Tax's interest charges." },
  })
  expect((await putInterest(id, '2026-07-15', 0)).status).toBe(204)
  await setInterest(id, { calc: 'daily', charge: 'monthly', chargeDay: 1, chargeDate: null })
  expect(await putInterest(id, '2026-10-01', -1)).toMatchObject({
    status: 400,
    body: { error: "Interest can't be negative." },
  })
  expect((await putInterest(id, '2026-10-01', 1.5)).status).toBe(400)
  expect((await putInterest(id, 'nope', 0)).status).toBe(400)
  expect((await resetInterest(id, '2026-10-01')).status).toBe(204)
})

test('edits survive a settings change', async () => {
  const id = await createDebt()
  await putInterest(id, '2026-10-01', 0)
  expect(await interestRow(id, '2026-10-01')).toMatchObject({ edited: true })

  await setInterest(id, { calc: 'on_charge', charge: 'monthly', chargeDay: 15, chargeDate: null })
  expect((await detail(id)).activity.filter((r) => r.kind === 'interest' && r.edited)).toEqual([])

  await setInterest(id, { calc: 'daily', charge: 'monthly', chargeDay: 1, chargeDate: null })
  expect(await interestRow(id, '2026-10-01')).toMatchObject({ edited: true, amountCents: 0 })
})

test('daily charging edits by month', async () => {
  const id = await createDebt()
  await setInterest(id, { calc: 'on_charge', charge: 'daily', chargeDay: null, chargeDate: null })
  expect((await putInterest(id, '2026-09-30', 5_000)).status).toBe(204)
  expect(await interestRow(id, '2026-09-30')).toMatchObject({ edited: true, amountCents: 5_000 })
  expect(await putInterest(id, '2026-09-29', 5_000)).toMatchObject({
    status: 400,
    body: { error: "That isn't one of Tax's interest charges." },
  })
  expect((await resetInterest(id, '2026-09-30')).status).toBe(204)
})

test('rates upsert and remove', async () => {
  const id = await createDebt()
  const before = (await detail(id)).balanceCents

  expect((await addRate(id, { fromDate: '2026-09-01', rateBp: 1200 })).status).toBe(204)
  let d = await detail(id)
  expect(d.rates.map((r) => [r.fromDate, r.rateBp])).toEqual([
    ['2026-06-15', 1000],
    ['2026-09-01', 1200],
  ])
  expect(d.activity.find((r) => r.kind === 'rate' && r.rateBp === 1200)).toMatchObject({ date: '2026-09-01' })
  expect(d.rateBp).toBe(1200)
  expect(d.balanceCents).toBeGreaterThan(before)

  // The same date again replaces the rate.
  expect((await addRate(id, { fromDate: '2026-09-01', rateBp: 1500 })).status).toBe(204)
  d = await detail(id)
  expect(d.rates.map((r) => [r.fromDate, r.rateBp])).toEqual([
    ['2026-06-15', 1000],
    ['2026-09-01', 1500],
  ])

  const [first, second] = d.rates
  expect((await call(`/api/debts/${id}/rates/${second!.id}`, { method: 'DELETE' })).status).toBe(204)
  expect((await detail(id)).rates).toHaveLength(1)
  expect(await call(`/api/debts/${id}/rates/${first!.id}`, { method: 'DELETE' })).toMatchObject({
    status: 400,
    body: { error: 'A debt needs at least one rate.' },
  })
})

test('rates are validated', async () => {
  const id = await createDebt()
  expect((await addRate(id, { fromDate: '2026-09-01', rateBp: 10_001 })).status).toBe(400)
  expect((await addRate(id, { fromDate: '2026-09-01', rateBp: -1 })).status).toBe(400)
  expect((await addRate(id, { fromDate: 'soon', rateBp: 100 })).status).toBe(400)
  // An announced change can be dated in the future.
  expect((await addRate(id, { fromDate: '2027-01-01', rateBp: 900 })).status).toBe(204)
  expect((await addRate(id, { fromDate: '2026-09-01', rateBp: 10_000 })).status).toBe(204)
})

test("BNPL debts don't take a rate", async () => {
  const id = await createDebt({ kind: 'bnpl', name: 'Later', repaymentCents: 0 })
  expect(await addRate(id, { fromDate: '2026-09-01', rateBp: 500 })).toEqual({
    status: 400,
    body: { error: "BNPL debts don't charge interest." },
  })
  expect((await detail(id)).rates.map((r) => r.rateBp)).toEqual([0])
  expect((await addRate(id, { fromDate: '2026-09-01', rateBp: 0 })).status).toBe(204)
})

test('removing a rate recalculates', async () => {
  const id = await createDebt()
  const before = (await detail(id)).balanceCents
  await addRate(id, { fromDate: '2026-09-01', rateBp: 1200 })
  const added = (await detail(id)).rates.find((r) => r.fromDate === '2026-09-01')!
  expect((await detail(id)).balanceCents).not.toBe(before)
  await call(`/api/debts/${id}/rates/${added.id}`, { method: 'DELETE' })
  expect((await detail(id)).balanceCents).toBe(before)
})

test('permissions', async () => {
  const id = await createDebt()
  const other = await createDebt({ name: 'Other' })
  await addEntry(id, entry())
  const [row] = await entryRows(id)
  const rate = (await detail(id)).rates[0]!
  const as = (path: string, method: string, body?: unknown, cookie = partner) =>
    call(`/api/debts/${path}`, { method, body, cookie })

  const forbidden = [
    await as(`${id}/rates`, 'POST', { fromDate: '2026-09-01', rateBp: 1200 }),
    await as(`${id}/rates/${rate.id}`, 'DELETE'),
    await as(`${id}/entries`, 'POST', entry()),
    await as(`${id}/entries/${row!.entryId}`, 'PATCH', entry()),
    await as(`${id}/entries/${row!.entryId}`, 'DELETE'),
    await as(`${id}/interest/2026-10-01`, 'PUT', { amountCents: 0 }),
    await as(`${id}/interest/2026-10-01`, 'DELETE'),
  ]
  expect(forbidden.map((r) => r.status)).toEqual(Array(7).fill(403))
  expect(forbidden[0]!.body.error).toMatch(/^Only .* can edit that\.$/)

  // Another debt's entry or rate is not found.
  expect((await as(`${other}/entries/${row!.entryId}`, 'PATCH', entry(), owner)).status).toBe(404)
  expect((await as(`${other}/entries/${row!.entryId}`, 'DELETE', undefined, owner)).status).toBe(404)
  expect((await as(`${other}/rates/${rate.id}`, 'DELETE', undefined, owner)).status).toBe(404)
  expect((await as(`nope/entries`, 'POST', entry(), owner)).status).toBe(404)
  expect(await entryRows(id)).toHaveLength(1)
  expect((await detail(other)).rates).toHaveLength(1)
})
