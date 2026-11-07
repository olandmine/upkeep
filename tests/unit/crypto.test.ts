import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { createSecretBox, loadOrCreateKey } from '../../src/server/crypto'

const key = randomBytes(32)

test('round-trips and uses a fresh IV', () => {
  const box = createSecretBox(key)
  const a = box.encrypt('up:yeah:secret')
  const b = box.encrypt('up:yeah:secret')
  expect(a.startsWith('v1:')).toBe(true)
  expect(a).not.toBe(b)
  expect(a).not.toContain('up:yeah')
  expect(box.decrypt(a)).toBe('up:yeah:secret')
})

test('detects tampering', () => {
  const box = createSecretBox(key)
  const blob = box.encrypt('up:yeah:secret')
  const raw = Buffer.from(blob.slice(3), 'base64')
  raw[raw.length - 1] ^= 0xff
  expect(() => box.decrypt(`v1:${raw.toString('base64')}`)).toThrow()
})

test('rejects the wrong key', () => {
  const blob = createSecretBox(key).encrypt('up:yeah:secret')
  expect(() => createSecretBox(randomBytes(32)).decrypt(blob)).toThrow()
})

test('uses UPKEEP_SECRET_KEY when set', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'upkeep-key-'))
  expect(loadOrCreateKey({ secretKey: key.toString('base64'), dataDir }).equals(key)).toBe(true)
  expect(existsSync(path.join(dataDir, 'secret.key'))).toBe(false)
  expect(() => loadOrCreateKey({ secretKey: randomBytes(16).toString('base64'), dataDir })).toThrow(/32 bytes/)
})

test('creates and then reuses data/secret.key', () => {
  const dataDir = path.join(mkdtempSync(path.join(tmpdir(), 'upkeep-key-')), 'nested')
  const first = loadOrCreateKey({ dataDir })
  const file = path.join(dataDir, 'secret.key')
  expect(first).toHaveLength(32)
  expect(Buffer.from(readFileSync(file, 'utf8').trim(), 'base64').equals(first)).toBe(true)
  expect(loadOrCreateKey({ dataDir }).equals(first)).toBe(true)
})
