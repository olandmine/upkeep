import { beforeEach, expect, test } from 'vitest'
import { createTestApp, type TestApp } from '../helpers/app'

let t: TestApp
let owner: string
let partner: string

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await t.json(path, { cookie: owner, ...init })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const KEY = 'me:actual:accounts'
const get = (key: string, cookie = owner) => call(`/api/flow-layouts/${key}`, { cookie })
const put = (key: string, body: unknown, cookie = owner) =>
  call(`/api/flow-layouts/${key}`, { method: 'PUT', body, cookie })
const del = (key: string, cookie = owner) => call(`/api/flow-layouts/${key}`, { method: 'DELETE', cookie })

beforeEach(async () => {
  t = createTestApp({ now: new Date('2026-10-30T01:00:00Z') })
  owner = await t.setupOwner()
  partner = await t.addPartner(owner)
})

test('put then get', async () => {
  const positions = { 'pay:u': { x: 10, y: 20 } }
  expect((await put(KEY, { positions })).status).toBe(204)
  expect(await get(KEY)).toEqual({ status: 200, body: { positions } })
  // A second save replaces the first.
  expect((await put(KEY, { positions: { 'pay:u': { x: 1, y: 2 } } })).status).toBe(204)
  expect((await get(KEY)).body).toEqual({ positions: { 'pay:u': { x: 1, y: 2 } } })
})

test('none saved', async () => {
  expect(await get('everyone:planned:budget')).toEqual({ status: 200, body: { positions: {} } })
})

test('delete', async () => {
  await put(KEY, { positions: { a: { x: 1, y: 2 } } })
  expect((await del(KEY)).status).toBe(204)
  expect((await get(KEY)).body).toEqual({ positions: {} })
})

test('per user', async () => {
  await put(KEY, { positions: { a: { x: 1, y: 2 } } })
  expect((await get(KEY, partner)).body).toEqual({ positions: {} })
  await put(KEY, { positions: { a: { x: 9, y: 9 } } }, partner)
  expect((await get(KEY)).body).toEqual({ positions: { a: { x: 1, y: 2 } } })
})

test('bad input', async () => {
  const ok = { a: { x: 1, y: 2 } }
  expect((await put('me:actual:pie', { positions: ok })).status).toBe(400)
  expect((await get('me:actual:pie')).status).toBe(400)
  expect((await del('me:actual:pie')).status).toBe(400)

  const many = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`b${i}`, { x: 0, y: 0 }]))
  expect((await put(KEY, { positions: many })).status).toBe(400)

  expect((await put(KEY, { positions: { a: { x: 1e6, y: 0 } } })).status).toBe(400)
  expect((await put(KEY, { positions: { ['i'.repeat(81)]: { x: 0, y: 0 } } })).status).toBe(400)

  // 1e999 parses to Infinity, which JSON.stringify cannot send, so post the raw text.
  const res = await t.app.request(`/api/flow-layouts/${KEY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: owner },
    body: '{"positions":{"a":{"x":1e999,"y":0}}}',
  })
  expect(res.status).toBe(400)

  // Nothing bad was stored.
  expect((await get(KEY)).body).toEqual({ positions: {} })
})
