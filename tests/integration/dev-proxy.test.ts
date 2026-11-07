import { serve, type ServerType } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { OWNER, createTestApp } from '../helpers/app'

// `pnpm dev`: the browser talks to Vite, which proxies /api to the server.
let api: ServerType
let vite: ViteDevServer
let base: string

beforeAll(async () => {
  const t = createTestApp()
  api = await new Promise<ServerType>((resolve) => {
    const server = serve({ fetch: t.app.fetch, port: 0 }, () => resolve(server))
  })
  process.env.PORT = String((api.address() as AddressInfo).port)
  vite = await createServer({ configFile: 'vite.config.ts', server: { port: 5299, strictPort: false }, logLevel: 'silent' })
  await vite.listen()
  base = new URL(vite.resolvedUrls!.local[0]!).origin
}, 30_000)

afterAll(async () => {
  delete process.env.PORT
  await vite?.close()
  api?.close()
})

test('same-origin writes pass the CSRF guard through the dev proxy', async () => {
  const res = await fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify(OWNER),
  })
  expect(res.status).toBe(201)
})
