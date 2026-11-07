import path from 'node:path'
import { expect, test } from 'vitest'
import { loadConfig } from '../../src/server/config'

test('applies defaults', () => {
  const c = loadConfig({})
  expect(c).toMatchObject({
    port: 3000,
    syncIntervalMinutes: 5,
    reconcileHour: 3,
    upApiBaseUrl: 'https://api.up.com.au/api/v1',
    dataDir: path.resolve('data'),
    migrationsDir: path.resolve('src/server/db/migrations'),
    webDistDir: path.resolve('dist/web'),
  })
  expect(c.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  expect(c.secretKey).toBeUndefined()
})

test('parses overrides', () => {
  expect(loadConfig({ PORT: '8080', SYNC_INTERVAL_MINUTES: '2', TZ: 'Australia/Sydney' })).toMatchObject({
    port: 8080,
    syncIntervalMinutes: 2,
    tz: 'Australia/Sydney',
  })
})

test('rejects an invalid TZ', () => {
  expect(() => loadConfig({ TZ: 'Mars/Base' })).toThrow(/TZ/)
})

test('rejects RECONCILE_HOUR outside 0-23', () => {
  expect(() => loadConfig({ RECONCILE_HOUR: '24' })).toThrow()
})
