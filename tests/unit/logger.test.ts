import { expect, test } from 'vitest'
import { createLogger } from '../../src/server/logger'

test('writes one JSON line and redacts secrets', () => {
  const lines: string[] = []
  createLogger({ write: (l) => lines.push(l) }).info('sync', {
    token: 'up:yeah:x',
    authorization: 'Bearer y',
    cookie: 'z',
    count: 3,
  })
  expect(lines).toHaveLength(1)
  const o = JSON.parse(lines[0])
  expect(o).toMatchObject({
    level: 'info',
    msg: 'sync',
    token: '[redacted]',
    authorization: '[redacted]',
    cookie: '[redacted]',
    count: 3,
  })
  expect(o.time).toMatch(/Z$/)
})
