import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import { matchedRepayments } from '../../src/server/debts/repayments'
import type { DebtActivityDto, DebtDetailDto, DebtInputDto } from '../../src/shared/types'
import { createTestApp, type TestApp } from '../helpers/app'
import { local, seedAccount, seedTx, TZ } from '../helpers/budget-seed'

const NOW = new Date('2026-10-30T01:00:00Z')
const ACME = 'ACME CAR FINANCE'

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

async function setup(now = NOW) {
  t = createTestApp({ now })
  owner = await t.setupOwner()
  partner = await t.addPartner(owner)
  ownerId = (await call('/api/me')).body.id
  partnerId = (await call('/api/me', { cookie: partner })).body.id
  seedAccount(t.db, { id: 'acc-spend', owner: ownerId })
  seedAccount(t.db, { id: 'acc-p-spend', owner: partnerId })
  seedAccount(t.db, { id: 'acc-2up', owner: null, ownership: 'JOINT' })
}

const repay = (
  id: string,
  date: string,
  accountId = 'acc-spend',
  over: Partial<Parameters<typeof seedTx>[1]> = {},
) => seedTx(t.db, { id, accountId, amountCents: -45_000, createdAt: local(date), description: ACME, ...over })

const createDebt = async (over: Partial<DebtInputDto> = {}, cookie = owner) =>
  (
    await call('/api/debts', {
      method: 'POST',
      cookie,
      body: {
        name: 'Car loan',
        kind: 'loan',
        ownerUserId: ownerId,
        rateBp: 0,
        repaymentCents: 45_000,
        repaymentFrequency: 'monthly',
        balanceCents: 1_000_000,
        asOf: '2026-06-15',
        ...over,
      },
    })
  ).body.id as string

const detail = async (id: string) => (await call(`/api/debts/${id}`)).body as DebtDetailDto
const mark = (id: string, transactionId: string, cookie = owner, matchFuture = true) =>
  call(`/api/debts/${id}/repayments`, { method: 'POST', body: { transactionId, matchFuture }, cookie })
const markOnce = (id: string, transactionId: string) => mark(id, transactionId, owner, false)
const repaid = (d: DebtDetailDto) =>
  d.activity.filter((r): r is Extract<DebtActivityDto, { kind: 'repayment' }> => r.kind === 'repayment')
const ids = async (id: string) => repaid(await detail(id)).map((r) => r.transactionId)

beforeEach(async () => {
  await setup()
  ;['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].forEach((d, i) => repay(`r${i}`, d))
  repay('p1', '2026-10-01', 'acc-p-spend')
})

test('marking one transaction matches the rest', async () => {
  const id = await createDebt()
  expect((await mark(id, 'r3')).status).toBe(204)
  const d = await detail(id)
  expect(repaid(d).map((r) => r.transactionId)).toEqual(['r3', 'r2', 'r1', 'r0'])
  expect(repaid(d)[0]).toEqual({
    key: 'repayment:r3',
    kind: 'repayment',
    transactionId: 'r3',
    date: '2026-10-01',
    amountCents: -45_000,
    balanceAfterCents: 820_000,
    description: ACME,
    oneOff: false,
  })
  expect(d.balanceCents).toBe(820_000)
  expect(d.estimated).toBe(false)
  expect(d.repaymentRules.map((r) => r.match)).toEqual(['acme car finance'])
})

test('marking a second description adds a rule, and both keep counting', async () => {
  repay('ato', '2026-10-10', 'acc-spend', { description: 'Tax Office Payments', amountCents: -30_000 })
  const id = await createDebt()
  await mark(id, 'r3')
  expect((await mark(id, 'ato')).status).toBe(204)
  const d = await detail(id)
  expect(d.repaymentRules.map((r) => r.match)).toEqual(['acme car finance', 'tax office payments'])
  expect(repaid(d).map((r) => r.transactionId)).toEqual(['ato', 'r3', 'r2', 'r1', 'r0'])
  expect(d.balanceCents).toBe(790_000)
})

test('a one-off counts only that transaction', async () => {
  const id = await createDebt()
  expect((await markOnce(id, 'r2')).status).toBe(204)
  const d = await detail(id)
  expect(d.repaymentRules).toEqual([])
  expect(repaid(d)).toEqual([expect.objectContaining({ transactionId: 'r2', oneOff: true })])
  expect(d.estimated).toBe(false)
  expect((await call('/api/transactions/r2/repayment')).body).toMatchObject({ debtId: id })
})

test("a one-off takes its transaction from another debt's rule", async () => {
  const car = await createDebt()
  await mark(car, 'r3')
  const other = await createDebt({ name: 'Other loan' })
  await markOnce(other, 'r2')
  expect(await ids(car)).toEqual(['r3', 'r1', 'r0'])
  expect(await ids(other)).toEqual(['r2'])
  expect((await call('/api/transactions/r2/repayment')).body).toMatchObject({ debtName: 'Other loan' })
})

test('a one-off already counting toward another debt moves to the new one', async () => {
  const car = await createDebt()
  await markOnce(car, 'r2')
  const other = await createDebt({ name: 'Other loan' })
  await markOnce(other, 'r2')
  expect(await ids(car)).toEqual([])
  expect(await ids(other)).toEqual(['r2'])
})

test('Not a repayment on a one-off removes it, with nothing left to undo', async () => {
  const id = await createDebt()
  await markOnce(id, 'r2')
  await call(`/api/debts/${id}/exclusions`, { method: 'POST', body: { transactionId: 'r2' } })
  const d = await detail(id)
  expect(repaid(d)).toEqual([])
  expect(d.exclusions).toEqual([])
})

test('marking a one-off as matching future payments turns it into a rule', async () => {
  const id = await createDebt()
  await markOnce(id, 'r2')
  await mark(id, 'r2')
  const d = await detail(id)
  expect(repaid(d).map((r) => [r.transactionId, r.oneOff])).toEqual([
    ['r3', false],
    ['r2', false],
    ['r1', false],
    ['r0', false],
  ])
})

test("ignores matches outside the debt's accounts", async () => {
  const id = await createDebt()
  await mark(id, 'r3')
  expect(await ids(id)).not.toContain('p1')
})

test('ignores internal transfers and income', async () => {
  repay('x1', '2026-10-05', 'acc-spend', { transferAccountId: 'acc-2up' })
  repay('x2', '2026-10-06', 'acc-spend', { amountCents: 45_000 })
  const id = await createDebt()
  await mark(id, 'r3')
  expect(await ids(id)).toHaveLength(4)
})

test('ignores matches before the first starting point', async () => {
  repay('old', '2026-06-01')
  const id = await createDebt()
  await mark(id, 'r3')
  expect(await ids(id)).not.toContain('old')
})

test('matches can be limited to a window of time, for one pay cycle', async () => {
  const id = await createDebt()
  await mark(id, 'r3')
  const debt = t.db.select().from(s.debts).where(eq(s.debts.id, id)).get()!
  const ids = (window?: { from: string; to: string | null }) =>
    matchedRepayments(t.db, debt, '2026-06-15', TZ, window).map((r) => r.transactionId)
  expect(ids()).toEqual(['r0', 'r1', 'r2', 'r3'])
  // From inclusive, to exclusive, as a cycle's bounds are.
  expect(ids({ from: local('2026-08-01'), to: local('2026-09-01') })).toEqual(['r1'])
  expect(ids({ from: local('2026-09-01'), to: null })).toEqual(['r2', 'r3'])
  // The first starting point still applies inside the window.
  repay('old', '2026-06-01')
  expect(ids({ from: local('2026-05-01'), to: local('2026-07-01') })).toEqual([])
})

test('repayment dated by local day', async () => {
  await setup(new Date('2026-11-02T01:00:00Z'))
  repay('late', '2026-11-01', 'acc-spend', { createdAt: local('2026-11-01', '00:01') })
  const id = await createDebt()
  await mark(id, 'late')
  expect(repaid(await detail(id))[0]).toMatchObject({ transactionId: 'late', date: '2026-11-01' })
})

test('not a repayment and undo', async () => {
  const id = await createDebt()
  await mark(id, 'r3')
  expect(
    (await call(`/api/debts/${id}/exclusions`, { method: 'POST', body: { transactionId: 'r3' } })).status,
  ).toBe(204)
  const excluded = await detail(id)
  expect(excluded.balanceCents).toBe(865_000)
  expect(excluded.exclusions.map((e) => e.transactionId)).toEqual(['r3'])
  expect((await call('/api/transactions/r3/repayment')).body).toBeNull()

  expect((await call(`/api/debts/${id}/exclusions/r3`, { method: 'DELETE' })).status).toBe(204)
  expect((await detail(id)).balanceCents).toBe(820_000)
})

test('one description, one debt', async () => {
  const first = await createDebt()
  await mark(first, 'r3')
  const second = await createDebt({ name: 'Other loan' })
  expect(await mark(second, 'r2')).toMatchObject({
    status: 400,
    body: { error: 'That description already marks repayments for Car loan.' },
  })
  // Marking it again for the same debt changes nothing.
  expect((await mark(first, 'r2')).status).toBe(204)
  expect((await detail(first)).repaymentRules).toHaveLength(1)
})

test("transaction must be on the debt's accounts", async () => {
  const id = await createDebt()
  expect(await mark(id, 'p1')).toMatchObject({
    status: 400,
    body: { error: "That transaction isn't on Car loan's accounts." },
  })
  expect((await markOnce(id, 'p1')).status).toBe(400)
  expect((await mark(id, 'nope')).status).toBe(404)
  repay('in', '2026-10-05', 'acc-spend', { amountCents: 45_000 })
  expect(await markOnce(id, 'in')).toMatchObject({
    status: 400,
    body: { error: 'Only money going out can be a repayment.' },
  })
})

test('transaction repayment lookup', async () => {
  seedTx(t.db, { id: 'other', accountId: 'acc-spend', amountCents: -500, createdAt: local('2026-10-02') })
  const id = await createDebt()
  await mark(id, 'r3')
  expect((await call('/api/transactions/r3/repayment')).body).toEqual({
    debtId: id,
    debtName: 'Car loan',
    canEdit: true,
  })
  expect((await call('/api/transactions/r3/repayment', { cookie: partner })).body).toMatchObject({
    canEdit: false,
  })
  expect((await call('/api/transactions/other/repayment')).body).toBeNull()
  expect((await call('/api/transactions/missing/repayment')).status).toBe(404)
})

test('joint debt matches joint and both individual accounts', async () => {
  repay('j1', '2026-10-02', 'acc-2up')
  const id = await createDebt({ ownerUserId: null, name: 'Joint car' }, partner)
  expect((await mark(id, 'p1', partner)).status).toBe(204)
  expect((await ids(id)).sort()).toEqual([
    'j1',
    'p1',
    'r0',
    'r1',
    'r2',
    'r3',
  ])
})

test('stop matching one rule keeps the others, and the exclusions', async () => {
  repay('ato', '2026-10-10', 'acc-spend', { description: 'Tax Office Payments', amountCents: -30_000 })
  const id = await createDebt()
  await mark(id, 'r3')
  await mark(id, 'ato')
  await call(`/api/debts/${id}/exclusions`, { method: 'POST', body: { transactionId: 'r2' } })
  const acme = (await detail(id)).repaymentRules[0]!
  expect((await call(`/api/debts/${id}/repayment-rules/${acme.id}`, { method: 'DELETE' })).status).toBe(204)
  expect(await ids(id)).toEqual(['ato'])

  const tax = (await detail(id)).repaymentRules[0]!
  await call(`/api/debts/${id}/repayment-rules/${tax.id}`, { method: 'DELETE' })
  expect(await detail(id)).toMatchObject({ repaymentRules: [], estimated: true })
  expect(await ids(id)).toEqual([])
  await mark(id, 'r3')
  expect(await ids(id)).toHaveLength(3)
})

test("rules can only be removed from their own debt", async () => {
  const car = await createDebt()
  await mark(car, 'r3')
  const rule = (await detail(car)).repaymentRules[0]!
  const other = await createDebt({ name: 'Other loan' })
  expect((await call(`/api/debts/${other}/repayment-rules/${rule.id}`, { method: 'DELETE' })).status).toBe(404)
  expect((await call(`/api/debts/${car}/repayment-rules/${rule.id}`, { method: 'DELETE', cookie: partner })).status).toBe(403)
})

test('projected repayments repeat on the day repayments are made', async () => {
  // Balance entered on the 15th; repayments go out on the 1st. 820,000 left at 45,000 a month: 19 more.
  const id = await createDebt()
  await mark(id, 'r3')
  expect((await detail(id)).projection?.payoffDate).toBe('2028-05-01')
})
