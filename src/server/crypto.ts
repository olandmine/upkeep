import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Config } from './config'

const VERSION = 'v1:'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export interface SecretBox {
  encrypt(plain: string): string
  decrypt(blob: string): string
}

/** AES-256-GCM. Blob format: `v1:` + base64(iv ‖ tag ‖ ciphertext). */
export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== KEY_BYTES) throw new Error(`Secret key must be ${KEY_BYTES} bytes`)
  return {
    encrypt(plain) {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return VERSION + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
    },
    decrypt(blob) {
      if (!blob.startsWith(VERSION)) throw new Error('Unsupported secret format')
      const raw = Buffer.from(blob.slice(VERSION.length), 'base64')
      const iv = raw.subarray(0, IV_BYTES)
      const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
    },
  }
}

/** Key from UPKEEP_SECRET_KEY (base64), else DATA_DIR/secret.key, generated on first run. */
export function loadOrCreateKey(cfg: Pick<Config, 'secretKey' | 'dataDir'>): Buffer {
  if (cfg.secretKey) {
    const key = Buffer.from(cfg.secretKey, 'base64')
    if (key.length !== KEY_BYTES) throw new Error(`UPKEEP_SECRET_KEY must decode to ${KEY_BYTES} bytes`)
    return key
  }
  const file = path.join(cfg.dataDir, 'secret.key')
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
    if (key.length !== KEY_BYTES) throw new Error(`${file} must contain ${KEY_BYTES} bytes (base64)`)
    return key
  }
  mkdirSync(cfg.dataDir, { recursive: true })
  const key = randomBytes(KEY_BYTES)
  writeFileSync(file, key.toString('base64') + '\n', { mode: 0o600 })
  return key
}
