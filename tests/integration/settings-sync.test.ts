import { beforeEach, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import { createTestApp, type TestApp } from '../helpers/app'

const TOKEN = 'up:yeah:owner'
let t: TestApp
let cookie: string

beforeEach(async () => {
  t = createTestApp()
  cookie = await t.setupOwner()
  t.fake.addAccount(t.buildAccount({ id: 'acc-1', balanceCents: 1000 }))
  t.fake.addCustomer(TOKEN, ['acc-1'])
  t.addDailyTransactions('acc-1', 5)
})

const putToken = (token: string, c = cookie) => t.json('/api/settings/up-token', { method: 'PUT', body: { token }, cookie: c })
const connId = () => t.db.select().from(s.upConnections).get()!.id
const txCount = () => t.db.select().from(s.transactions).all().length

test('bad token → 400 with copy', async () => {
  const res = await putToken('up:yeah:wrong')
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "Up didn't accept that token" })
})

test('connect triggers backfill and reports status', async () => {
  const res = await putToken(TOKEN)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.connections).toHaveLength(1)
  expect(body.connections[0]).toMatchObject({ displayName: 'Owner', status: 'ok', backfillCompletedAt: null, running: null })
  expect(t.scheduler.triggered).toEqual([[connId(), 'backfill']])
  expect(JSON.stringify(body)).not.toContain(TOKEN)
})

test('status shows a running backfill with progress', async () => {
  await putToken(TOKEN)
  t.db.insert(s.syncRuns)
    .values({ id: 'r1', connectionId: connId(), kind: 'backfill', status: 'running', startedAt: t.now().toISOString(), transactionsUpserted: 3214 })
    .run()
  const body = await (await t.json('/api/sync/status', { cookie })).json()
  expect(body.connections[0].running).toEqual({ kind: 'backfill', startedAt: t.now().toISOString(), transactionsUpserted: 3214 })
})

test('replacing a token after 401 resumes incremental without duplicates', async () => {
  await putToken(TOKEN)
  await t.engine.backfill(connId())
  expect(txCount()).toBe(5)
  t.fake.revokeToken(TOKEN)
  await t.engine.incremental(connId())
  expect((await (await t.json('/api/sync/status', { cookie })).json()).connections[0].status).toBe('unauthorized')

  t.fake.addCustomer('up:yeah:new', ['acc-1'])
  const res = await putToken('up:yeah:new')
  expect((await res.json()).connections[0].status).toBe('ok')
  expect(t.scheduler.triggered.at(-1)).toEqual([connId(), 'incremental'])
  await t.engine.incremental(connId())
  expect(txCount()).toBe(5)
})

test('disconnect removes connection and visibility but keeps data', async () => {
  await putToken(TOKEN)
  await t.engine.backfill(connId())
  const res = await t.json('/api/settings/up-token', { method: 'DELETE', cookie })
  expect(res.status).toBe(200)
  expect((await res.json()).connections).toEqual([])
  expect(t.db.select().from(s.accountConnections).all()).toEqual([])
  expect(txCount()).toBe(5)
})

test("a user can only manage their own token", async () => {
  await putToken(TOKEN)
  const partner = await t.addPartner(cookie)
  await t.json('/api/settings/up-token', { method: 'DELETE', cookie: partner })
  expect(t.db.select().from(s.upConnections).all()).toHaveLength(1)
})

test('sync run triggers runNow and requires login', async () => {
  expect((await t.json('/api/sync/run', { method: 'POST' })).status).toBe(401)
  const res = await t.json('/api/sync/run', { method: 'POST', cookie })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ connections: [] })
})

test('status reports when the last failed run finished', async () => {
  await putToken(TOKEN)
  expect((await (await t.json('/api/sync/status', { cookie })).json()).connections[0].lastFailedAt).toBeNull()
  t.fake.failNext(/transactions/, 500, 4)
  await t.engine.backfill(connId())
  const body = await (await t.json('/api/sync/status', { cookie })).json()
  expect(body.connections[0]).toMatchObject({ status: 'error', lastFailedAt: t.now().toISOString() })
})
