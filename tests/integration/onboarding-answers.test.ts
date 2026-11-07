import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import * as s from '../../src/server/db/schema'
import { createTestApp, OWNER, PARTNER, type TestApp } from '../helpers/app'

const TOKEN = 'up:yeah:owner'
let t: TestApp
let cookie: string

beforeEach(async () => {
  t = createTestApp()
  cookie = await t.setupOwner()
  t.fake.addAccount(t.buildAccount({ id: 'acc-1', balanceCents: 1000 }))
  t.fake.addCustomer(TOKEN, ['acc-1'])
})

const put = (body: unknown, c = cookie) => t.json('/api/settings/up-token', { method: 'PUT', body, cookie: c })
const patch = (body: unknown, c = cookie) => t.json('/api/me', { method: 'PATCH', body, cookie: c })
const me = async (c = cookie) => (await t.json('/api/me', { cookie: c })).json()
const row = (username = OWNER.username) => t.db.select().from(s.users).where(eq(s.users.username, username)).get()!

test('connecting saves the handle before the import starts', async () => {
  let seenByScheduler: string | null | undefined
  const original = t.scheduler.trigger.bind(t.scheduler)
  t.scheduler.trigger = (id, kind) => {
    seenByScheduler = row().upDisplayName
    original(id, kind)
  }
  const res = await put({ token: TOKEN, upDisplayName: '$sam' })
  expect(res.status).toBe(200)
  expect(seenByScheduler).toBe('$sam')
  expect((await me()).connectUpAnswered).toBe(true)
})

test('a rejected token saves nothing', async () => {
  const res = await put({ token: 'up:yeah:wrong', upDisplayName: '$sam' })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "Up didn't accept that token" })
  const body = await me()
  expect(body.upDisplayName).toBeNull()
  expect(body.connectUpAnswered).toBe(false)
  expect(t.scheduler.triggered).toEqual([])
})

test('skipping answers, and saves a handle if typed', async () => {
  const res = await patch({ connectUpSkipped: true, upDisplayName: '$sam' })
  const body = await res.json()
  expect(body.connectUpAnswered).toBe(true)
  expect(body.upDisplayName).toBe('$sam')
  expect(row().upHandleLeftBlank).toBe(false)
})

test('leaving the handle blank is remembered', async () => {
  await patch({ connectUpSkipped: true })
  expect(row().upHandleLeftBlank).toBe(true)

  const partner = await t.addPartner(cookie)
  t.fake.addCustomer('up:yeah:partner', ['acc-1'])
  await put({ token: 'up:yeah:partner' }, partner)
  expect(row(PARTNER.username).upHandleLeftBlank).toBe(true)
})

test('a whitespace-only handle counts as blank', async () => {
  await put({ token: TOKEN, upDisplayName: '   ' })
  expect(row().upHandleLeftBlank).toBe(true)

  const partner = await t.addPartner(cookie)
  t.fake.addCustomer('up:yeah:partner', ['acc-1'])
  await patch({ upDisplayName: '$sam' }, partner)
  await put({ token: 'up:yeah:partner', upDisplayName: '   ' }, partner)
  expect(row(PARTNER.username).upDisplayName).toBe('$sam')
  expect(row(PARTNER.username).upHandleLeftBlank).toBe(false)
})

test('connecting from Settings answers too', async () => {
  expect((await me()).connectUpAnswered).toBe(false)
  await put({ token: TOKEN })
  expect((await me()).connectUpAnswered).toBe(true)
})

test('answering happens once', async () => {
  await patch({ connectUpSkipped: true })
  await patch({ upDisplayName: '$sam' })
  await t.json('/api/settings/up-token', { method: 'DELETE', cookie })
  await put({ token: TOKEN })
  expect(row().upHandleLeftBlank).toBe(true)
  expect((await me()).connectUpAnswered).toBe(true)
})

test('a login made by the other person starts as kept, and changing it records changed', async () => {
  const partner = await t.addPartner(cookie)
  expect(row(PARTNER.username).givenPassword).toBe('kept')
  expect(row().givenPassword).toBeNull()

  const wrong = await patch({ currentPassword: 'nope nope nope', newPassword: 'a brand new pass' }, partner)
  expect(wrong.status).toBe(400)
  expect(row(PARTNER.username).givenPassword).toBe('kept')

  const ok = await patch({ currentPassword: PARTNER.password, newPassword: 'a brand new pass' }, partner)
  expect(ok.status).toBe(200)
  expect(row(PARTNER.username).givenPassword).toBe('changed')

  await patch({ currentPassword: OWNER.password, newPassword: 'another new pass' })
  expect(row().givenPassword).toBeNull()
})

test("a client can't set givenPassword when creating a user", async () => {
  await t.json('/api/users', { method: 'POST', body: { ...PARTNER, givenPassword: 'changed' }, cookie })
  expect(row(PARTNER.username).givenPassword).toBe('kept')
})

test('hiding the card is saved', async () => {
  expect((await me()).gettingStartedHidden).toBe(false)
  await patch({ gettingStartedHidden: true })
  expect((await me()).gettingStartedHidden).toBe(true)
})
