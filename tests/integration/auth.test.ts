import { beforeEach, expect, test } from 'vitest'
import { createTestApp, OWNER, PARTNER, type TestApp } from '../helpers/app'

let t: TestApp

beforeEach(() => {
  t = createTestApp()
})

test('setup only once', async () => {
  expect(await (await t.json('/api/setup/status')).json()).toEqual({ needsSetup: true })
  const res = await t.json('/api/setup', { method: 'POST', body: OWNER })
  expect(res.status).toBe(201)
  const cookie = res.headers.get('Set-Cookie') ?? ''
  expect(cookie).toMatch(/upkeep_session=/)
  expect(cookie).toMatch(/HttpOnly/i)
  expect(cookie).toMatch(/SameSite=Lax/i)
  expect(cookie).not.toMatch(/Secure/i)
  expect(await res.json()).toMatchObject({ username: 'owner', displayName: 'Owner', negativeStyle: 'minus' })
  expect(await (await t.json('/api/setup/status')).json()).toEqual({ needsSetup: false })
  expect((await t.json('/api/setup', { method: 'POST', body: PARTNER })).status).toBe(409)
})

test('secure cookie behind https', async () => {
  const res = await t.json('/api/setup', { method: 'POST', body: OWNER, headers: { 'X-Forwarded-Proto': 'https' } })
  expect(res.headers.get('Set-Cookie')).toMatch(/Secure/)
})

test('password must be at least 8 chars', async () => {
  const res = await t.json('/api/setup', { method: 'POST', body: { ...OWNER, password: 'short' } })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Password must be at least 8 characters' })
})

test('login and me', async () => {
  await t.setupOwner()
  const wrong = await t.json('/api/auth/login', { method: 'POST', body: { username: 'owner', password: 'nope nope' } })
  expect(wrong.status).toBe(401)
  expect(await wrong.json()).toEqual({ error: 'Wrong username or password.' })
  const cookie = await t.login(OWNER)
  const me = await (await t.json('/api/me', { cookie })).json()
  expect(me).toMatchObject({ username: 'owner', displayName: 'Owner', upDisplayName: null })
  expect(me).not.toHaveProperty('passwordHash')
})

test('rate limits login per username', async () => {
  await t.setupOwner()
  for (let i = 0; i < 5; i++) {
    await t.json('/api/auth/login', { method: 'POST', body: { username: 'owner', password: 'wrong wrong' } })
  }
  const blocked = await t.json('/api/auth/login', { method: 'POST', body: OWNER })
  expect(blocked.status).toBe(429)
  expect(await blocked.json()).toEqual({ error: 'Too many attempts. Try again in a few minutes.' })
  t.setNow(new Date(t.now().getTime() + 15 * 60_000 + 1))
  expect((await t.json('/api/auth/login', { method: 'POST', body: OWNER })).status).toBe(200)
})

test('caps users at two and lists them', async () => {
  const cookie = await t.setupOwner()
  expect((await t.json('/api/users', { method: 'POST', body: PARTNER })).status).toBe(401)
  expect((await t.json('/api/users', { method: 'POST', body: PARTNER, cookie })).status).toBe(201)
  const third = await t.json('/api/users', { method: 'POST', body: { ...PARTNER, username: 'third' }, cookie })
  expect(third.status).toBe(409)
  const users = await (await t.json('/api/users', { cookie })).json()
  expect(users.map((u: { username: string }) => u.username)).toEqual(['owner', 'partner'])
})

test('duplicate usernames are rejected', async () => {
  const cookie = await t.setupOwner()
  const res = await t.json('/api/users', { method: 'POST', body: { ...PARTNER, username: 'OWNER' }, cookie })
  expect(res.status).toBe(409)
})

test('csrf guard', async () => {
  const plain = await t.app.request('/api/setup', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })
  expect(plain.status).toBe(415)
  const evil = await t.json('/api/setup', { method: 'POST', body: OWNER, headers: { Origin: 'http://evil.test' } })
  expect(evil.status).toBe(403)
  const same = await t.json('/api/setup', { method: 'POST', body: OWNER, headers: { Origin: 'http://localhost' } })
  expect(same.status).toBe(201)
})

test('logout invalidates the session', async () => {
  const cookie = await t.setupOwner()
  expect((await t.json('/api/auth/logout', { method: 'POST', cookie })).status).toBe(204)
  expect((await t.json('/api/me', { cookie })).status).toBe(401)
})

test('profile updates and password change needs current password', async () => {
  const cookie = await t.setupOwner()
  const updated = await t.json('/api/me', {
    method: 'PATCH',
    cookie,
    body: { displayName: 'Jordan', upDisplayName: 'Jordan L', negativeStyle: 'parentheses' },
  })
  expect(await updated.json()).toMatchObject({ displayName: 'Jordan', upDisplayName: 'Jordan L', negativeStyle: 'parentheses' })
  const bad = await t.json('/api/me', { method: 'PATCH', cookie, body: { currentPassword: 'wrong pass', newPassword: 'new password' } })
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'Current password is incorrect' })
  const ok = await t.json('/api/me', { method: 'PATCH', cookie, body: { currentPassword: OWNER.password, newPassword: 'new password' } })
  expect(ok.status).toBe(200)
  expect((await t.json('/api/auth/login', { method: 'POST', body: { username: 'owner', password: 'new password' } })).status).toBe(200)
})

test('each person keeps their own highlight colour', async () => {
  const owner = await t.setupOwner()
  const partner = await t.addPartner(owner)
  expect(await (await t.json('/api/me', { cookie: owner })).json()).toMatchObject({ accent: 'amber' })
  const updated = await t.json('/api/me', { method: 'PATCH', cookie: owner, body: { accent: 'teal' } })
  expect(updated.status).toBe(200)
  expect(await updated.json()).toMatchObject({ accent: 'teal' })
  expect(await (await t.json('/api/me', { cookie: owner })).json()).toMatchObject({ accent: 'teal' })
  expect(await (await t.json('/api/me', { cookie: partner })).json()).toMatchObject({ accent: 'amber' })
})

test('an unknown highlight colour is refused', async () => {
  const cookie = await t.setupOwner()
  expect((await t.json('/api/me', { method: 'PATCH', cookie, body: { accent: 'neon' } })).status).toBe(400)
  expect(await (await t.json('/api/me', { cookie })).json()).toMatchObject({ accent: 'amber' })
})

test('unexpected errors return a generic 500', async () => {
  t.app.get('/api/boom', () => {
    throw new Error('kaboom secret detail')
  })
  const res = await t.json('/api/boom')
  expect(res.status).toBe(500)
  const text = await res.text()
  expect(JSON.parse(text)).toEqual({ error: 'Something went wrong' })
  expect(text).not.toContain('kaboom')
})

test('unknown api routes return JSON 404', async () => {
  const res = await t.json('/api/nope')
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'Not found' })
})

test('an active session refreshes the cookie expiry too', async () => {
  const cookie = await t.setupOwner()
  const t0 = t.now().getTime()
  t.setNow(new Date(t0 + 3_600_000))
  expect((await t.json('/api/me', { cookie })).headers.get('Set-Cookie')).toBeNull() // renewed at most daily
  t.setNow(new Date(t0 + 2 * 86_400_000))
  const res = await t.json('/api/me', { cookie })
  expect(res.status).toBe(200)
  const renewed = res.headers.get('Set-Cookie') ?? ''
  expect(renewed).toContain(cookie) // same token
  expect(renewed).toContain(`Expires=${new Date(t0 + 92 * 86_400_000).toUTCString()}`)
})
