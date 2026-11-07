import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import type { BudgetDto } from '../../src/shared/types'
import { createTestApp, type TestApp } from '../helpers/app'
import { local } from '../helpers/budget-seed'

const TOKEN = 'up:yeah:owner'
const NOW = new Date(local('2026-02-28', '12:00'))
const PAYS = ['2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12', '2026-02-26']

let t: TestApp
let owner: string
let partner: string
let ownerId: string
let partnerId: string
let connId: string

const addTx = (p: Partial<Parameters<TestApp['buildTransaction']>[0]> & { id: string; createdAt: string }) =>
  t.fake.addTransaction(t.buildTransaction({ accountId: 'acc-spending', amountCents: -1000, ...p }))

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await t.json(path, { cookie: owner, ...init })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const budgets = async (cookie = owner) => (await call('/api/budgets', { cookie })).body as BudgetDto[]
const budget = async (name: string, cookie = owner) => (await budgets(cookie)).find((b) => b.name === name)!

beforeEach(async () => {
  t = createTestApp({ now: NOW })
  owner = await t.setupOwner()
  partner = await t.addPartner(owner)
  ownerId = (await call('/api/me')).body.id
  partnerId = (await call('/api/me', { cookie: partner })).body.id
  t.fake.addAccount(t.buildAccount({ id: 'acc-spending', displayName: 'Spending' }))
  t.fake.addAccount(
    t.buildAccount({ id: 'acc-rent', displayName: 'Rent', accountType: 'SAVER', balanceCents: 164446 }),
  )
  t.fake.addAccount(t.buildAccount({ id: 'acc-2up', displayName: '2Up Spending', ownershipType: 'JOINT' }))
  t.fake.addCustomer(TOKEN, ['acc-spending', 'acc-rent', 'acc-2up'])
  PAYS.forEach((d, i) =>
    addTx({
      id: `pay${i}`,
      amountCents: 400000,
      createdAt: local(d),
      description: 'ACME PAY',
      categoryId: null,
    }),
  )
  addTx({ id: 'g1', amountCents: -4000, createdAt: local('2026-02-27'), categoryId: 'groceries' })
  connId = (await t.engine.connect(ownerId, TOKEN)).id
  await t.engine.backfill(connId)
})

const markPay = () => call('/api/pay-schedule', { method: 'PUT', body: { transactionId: 'pay4' } })
const groceries = { kind: 'spending', name: 'Groceries', amountCents: 60000, categoryIds: ['groceries'] }

test('full flow', async () => {
  const candidates = await call('/api/pay-candidates')
  expect(candidates.body[0]).toMatchObject({
    transaction: { id: 'pay4', description: 'ACME PAY' },
    sameDescriptionCount: 5,
  })

  const schedule = await markPay()
  expect(schedule).toMatchObject({
    status: 200,
    body: {
      descriptionMatch: 'acme pay',
      minAmountCents: 200000,
      accountName: 'Spending',
      accountMissing: false,
    },
  })
  expect((await call('/api/pay-schedule')).body).toMatchObject({ accountId: 'acc-spending' })

  const mine = await budget('Mine')
  expect(mine).toMatchObject({
    kind: 'personal',
    ownerUserId: ownerId,
    setup: 'ready',
    hasPeriods: true,
    canEdit: true,
  })
  expect(await budget('Joint')).toMatchObject({ anchorUserId: ownerId, setup: 'ready' })

  const created = await call(`/api/budgets/${mine.id}/lines`, { method: 'POST', body: groceries })
  expect(created).toMatchObject({ status: 201, body: { name: 'Groceries', categoryIds: ['groceries'] } })

  const period = await call(`/api/budgets/${mine.id}/period`)
  expect(period.body).toMatchObject({
    start: '2026-02-26',
    isCurrent: true,
    lines: [{ name: 'Groceries', spentCents: 4000 }],
  })
  expect((await call(`/api/budgets/${mine.id}/period?date=2026-01-20`)).body.start).toBe('2026-01-15')

  const events = await call(`/api/pay-events?userId=${ownerId}`)
  expect(events.body).toHaveLength(5)
  expect(events.body[0]).toMatchObject({
    payDate: '2026-02-26',
    source: 'detected',
    transactionId: 'pay4',
    payNotSeen: false,
  })
})

test('a sync with a new pay deposit opens a new period', async () => {
  await markPay()
  const mine = await budget('Mine')
  addTx({ id: 'pay5', amountCents: 400000, createdAt: local('2026-03-12'), description: 'ACME PAY' })
  t.setNow(new Date(local('2026-03-13', '12:00')))
  await t.engine.incremental(connId)
  expect((await call(`/api/budgets/${mine.id}/period`)).body.start).toBe('2026-03-12')
})

test('partner budget before their token', async () => {
  const theirs = await budget('Mine', partner)
  expect(theirs).toMatchObject({ ownerUserId: partnerId, setup: 'partner-not-connected', hasPeriods: false })
  expect(await budget('Partner')).toMatchObject({ canEdit: false, setup: 'partner-not-connected' })
  expect(await call(`/api/budgets/${theirs.id}/period`, { cookie: partner })).toEqual({
    status: 404,
    body: { error: 'No pay periods yet' },
  })
})

test('permissions', async () => {
  await markPay()
  const mine = await budget('Mine')
  const joint = await budget('Joint')
  expect(
    await call(`/api/budgets/${mine.id}/lines`, { method: 'POST', body: groceries, cookie: partner }),
  ).toEqual({
    status: 403,
    body: { error: 'Only Owner can edit their budget.' },
  })
  expect(
    (await call(`/api/budgets/${joint.id}/lines`, { method: 'POST', body: groceries, cookie: partner }))
      .status,
  ).toBe(201)
  const anchored = await call(`/api/budgets/${joint.id}`, {
    method: 'PATCH',
    body: { anchorUserId: partnerId },
    cookie: partner,
  })
  expect(anchored).toMatchObject({
    status: 200,
    body: { anchorUserId: partnerId, setup: 'partner-not-connected' },
  })
  expect(
    await call(`/api/budgets/${mine.id}`, { method: 'PATCH', body: { anchorUserId: partnerId } }),
  ).toEqual({
    status: 400,
    body: { error: 'Only the joint budget has an anchor' },
  })
  const overlap = await call(`/api/budgets/${mine.id}/lines`, {
    method: 'POST',
    body: { ...groceries, name: 'Food' },
  })
  expect(overlap.status).toBe(201)
  expect((await call(`/api/budgets/${mine.id}/lines`, { method: 'POST', body: groceries })).body).toEqual({
    error: 'Groceries is already in Food',
  })
})

test('lines: edit, reorder, archive', async () => {
  await markPay()
  const mine = await budget('Mine')
  const a = (await call(`/api/budgets/${mine.id}/lines`, { method: 'POST', body: groceries })).body
  await call(`/api/budgets/${mine.id}/lines`, {
    method: 'POST',
    body: { kind: 'fund', name: 'Rent', amountCents: 80000, categoryIds: [], saverAccountId: 'acc-rent' },
  })
  expect(
    (await call(`/api/budget-lines/${a.id}`, { method: 'PATCH', body: { amountCents: 70000 } })).body,
  ).toMatchObject({
    amountCents: 70000,
  })
  expect((await call(`/api/budget-lines/${a.id}/archive`, { method: 'POST' })).status).toBe(200)
  const period = (await call(`/api/budgets/${mine.id}/period`)).body
  expect(period.lines.map((l: { name: string }) => l.name)).toEqual(['Rent'])
})

test('"Not my pay" and undo', async () => {
  await markPay()
  expect((await call('/api/pay-events/2026-02-26', { method: 'DELETE' })).status).toBe(204)
  expect((await call('/api/pay-exclusions')).body).toMatchObject([{ id: 'pay4' }])
  expect((await call(`/api/pay-events?userId=${ownerId}`)).body).toHaveLength(4)
  expect((await call('/api/pay-exclusions/pay4', { method: 'DELETE' })).status).toBe(204)
  expect((await call(`/api/pay-events?userId=${ownerId}`)).body).toHaveLength(5)
})

test('plans over HTTP', async () => {
  await markPay()
  const mine = await budget('Mine')
  const rent = (
    await call(`/api/budgets/${mine.id}/lines`, {
      method: 'POST',
      body: { kind: 'fund', name: 'Rent', amountCents: 80000, categoryIds: [], saverAccountId: 'acc-rent' },
    })
  ).body
  const items = [{ targetKind: 'line', lineId: rent.id, saverAccountId: null, amountCents: 80000 }]
  expect(
    (await call('/api/plan-template', { method: 'PUT', body: { expectedIncomeCents: 400000, items } }))
      .status,
  ).toBe(200)
  expect((await call('/api/plan-template')).body).toMatchObject({
    expectedIncomeCents: 400000,
    items: [{ targetName: 'Rent' }],
  })

  const plan = () => call(`/api/plans/${ownerId}/2026-02-26`, { cookie: partner })
  expect((await plan()).body).toMatchObject({
    incomeCents: 400000,
    items: [{ check: 'pending' }],
  })

  addTx({
    id: 'x1',
    accountId: 'acc-rent',
    amountCents: 80000,
    createdAt: local('2026-02-26', '11:00'),
    transferAccountId: 'acc-spending',
  })
  await t.engine.incremental(connId)
  expect((await plan()).body.items[0]).toMatchObject({ check: 'done', movedCents: 80000 })

  const edited = await call('/api/plans/2026-02-26', {
    method: 'PUT',
    body: { items: [{ ...items[0], amountCents: 90000 }] },
  })
  expect(edited.body).toMatchObject({ customised: true, items: [{ check: 'partial' }] })
  expect(
    (await call('/api/plans/2026-02-26/save-as-template', { method: 'POST' })).body.items[0].amountCents,
  ).toBe(90000)
})

test('plan-template/from-last-pay returns a proposal', async () => {
  await markPay()
  addTx({
    id: 'x1',
    accountId: 'acc-rent',
    amountCents: 80000,
    createdAt: local('2026-02-26', '10:00'),
    transferAccountId: 'acc-spending',
  })
  await t.engine.incremental(connId)
  expect((await call('/api/plan-template/from-last-pay', { method: 'POST' })).body).toEqual({
    expectedIncomeCents: 400000,
    items: [{ targetKind: 'saver', lineId: null, saverAccountId: 'acc-rent', saverId: 'acc-rent', amountCents: 80000 }],
  })
})

test('plan-template/from-last-pay says which Saver a line in the proposal moves money to', async () => {
  await markPay()
  addTx({
    id: 'x1',
    accountId: 'acc-rent',
    amountCents: 80000,
    createdAt: local('2026-02-26', '10:00'),
    transferAccountId: 'acc-spending',
  })
  await t.engine.incremental(connId)
  const { id: budgetId } = (await call('/api/budgets')).body.find((b: { kind: string }) => b.kind === 'personal')
  const { body: fund } = await call(`/api/budgets/${budgetId}/lines`, {
    method: 'POST',
    body: { kind: 'fund', name: 'Rent', amountCents: 80000, categoryIds: [], saverAccountId: 'acc-rent' },
  })
  expect((await call('/api/plan-template/from-last-pay', { method: 'POST' })).body.items).toEqual([
    { targetKind: 'line', lineId: fund.id, saverAccountId: null, saverId: 'acc-rent', amountCents: 80000 },
  ])
})

test('schedule edits and validation', async () => {
  await markPay()
  expect(
    (
      await call('/api/pay-schedule', {
        method: 'PUT',
        body: { descriptionMatch: 'ACME PAY', minAmountCents: 500000 },
      })
    ).body,
  ).toMatchObject({ minAmountCents: 500000 })
  expect((await call(`/api/pay-events?userId=${ownerId}`)).body).toEqual([])
  expect((await call('/api/pay-schedule', { method: 'PUT', body: { transactionId: 'g1' } })).status).toBe(400)
  expect((await call('/api/pay-schedule', { method: 'DELETE' })).status).toBe(204)
  expect((await call('/api/pay-schedule')).body).toBeNull()
})

test('mutations need JSON (CSRF guard)', async () => {
  const mine = await budget('Mine')
  const res = await t.app.request(`/api/budgets/${mine.id}/lines`, {
    method: 'POST',
    headers: { Cookie: owner, 'Content-Type': 'text/plain' },
    body: JSON.stringify(groceries),
  })
  expect(res.status).toBe(415)
})

test('unknown budget is a 404', async () => {
  expect((await call('/api/budgets/nope/period')).status).toBe(404)
  expect(t.db.select().from(s.budgets).where(eq(s.budgets.id, 'nope')).get()).toBeUndefined()
})

const payChanges = (over: object = {}) => ({
  payDate: '2026-02-26',
  applyTo: 'every-pay',
  savers: { set: [], remove: [] },
  limits: [],
  lines: { create: [], update: [], archive: [] },
  ...over,
})

test('PUT /api/budgets/pay-changes applies a change and answers 204', async () => {
  await markPay()
  const mine = await budget('Mine')
  const line = (await call(`/api/budgets/${mine.id}/lines`, { method: 'POST', body: groceries })).body
  const res = await call('/api/budgets/pay-changes', {
    method: 'PUT',
    body: payChanges({
      limits: [{ lineId: line.id, amountCents: 70000 }],
      savers: { set: [{ saverAccountId: 'acc-rent', amountCents: 80000 }], remove: [] },
    }),
  })
  expect(res).toEqual({ status: 204, body: null })
  expect((await call(`/api/budgets/${mine.id}/period`)).body.lines).toMatchObject([
    { lineId: line.id, amountCents: 70000 },
  ])
  expect((await call('/api/plan-template')).body.items).toMatchObject([
    { saverAccountId: 'acc-rent', amountCents: 80000 },
    { lineId: line.id, amountCents: 70000 },
  ])
})

test('PUT /api/budgets/pay-changes answers a broken rule with its error', async () => {
  await markPay()
  const put = (body: object) => call('/api/budgets/pay-changes', { method: 'PUT', body })
  expect(await put(payChanges({ payDate: '2026-02-12' }))).toEqual({
    status: 400,
    body: { error: 'A new pay has arrived. Check your changes and try again.' },
  })
  expect((await put(payChanges({ limits: [{ lineId: 'x', amountCents: -1 }] }))).status).toBe(400)
  expect((await put(payChanges({ payDate: 'soon' }))).status).toBe(400)
  const tooMany = Array.from({ length: 101 }, () => ({ lineId: 'x', amountCents: 1 }))
  expect((await put(payChanges({ limits: tooMany }))).status).toBe(400)
})

test('budget-line names the line a transaction counts toward', async () => {
  await markPay()
  const mine = await budget('Mine')
  await call(`/api/budgets/${mine.id}/lines`, { method: 'POST', body: groceries })
  addTx({ id: 'cafe', amountCents: -800, createdAt: local('2026-02-27'), categoryId: 'restaurants-and-cafes' })
  addTx({ id: 'xfer', amountCents: -5000, createdAt: local('2026-02-27'), transferAccountId: 'acc-rent', categoryId: null })
  await t.engine.incremental(connId)
  const line = async (id: string, cookie = owner) => (await call(`/api/transactions/${id}/budget-line`, { cookie })).body
  expect(await line('g1')).toEqual({ budgetName: 'Mine', lineName: 'Groceries' })
  expect(await line('g1', partner)).toEqual({ budgetName: 'Owner', lineName: 'Groceries' })
  expect(await line('cafe')).toEqual({ budgetName: 'Mine', lineName: null })
  expect(await line('xfer')).toBeNull()
  expect(await line('pay4')).toBeNull()
  expect((await call('/api/transactions/nope/budget-line')).status).toBe(404)
})
