import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { loadConfig } from '../../src/server/config'

const compose = readFileSync('compose.yaml', 'utf8')
const dockerfile = readFileSync('Dockerfile', 'utf8')
const dockerignore = readFileSync('.dockerignore', 'utf8')

const lines = (text: string) => text.split('\n').map((line) => line.trim())
const relative = (to: string) => path.relative(process.cwd(), to).replaceAll('\\', '/')

test('the app is published on loopback only', () => {
  const composeLines = lines(compose)
  const start = composeLines.indexOf('ports:')
  const end = composeLines.findIndex((line, i) => i > start && !line.startsWith('- '))
  expect(composeLines.slice(start + 1, end)).toEqual(["- '127.0.0.1:3000:3000'"])
  expect(composeLines.filter((line) => line === 'ports:')).toHaveLength(1)
  expect(compose).not.toMatch(/network_mode|published:/)
})

test('.env can set options but not move the port or the data', () => {
  expect(compose).toMatch(/path: \.env\s+required: false/)
  expect(compose).toContain('PORT: 3000')
  expect(compose).toContain('DATA_DIR: /data')
  expect(compose).toContain('TZ: ${TZ:-Australia/Sydney}')
})

test('secrets and real data never enter the build context', () => {
  expect(lines(dockerignore)).toEqual(expect.arrayContaining(['.git', '.env', 'data', 'docs', 'node_modules', 'dist']))
})

test('the image holds the paths the server reads at runtime', () => {
  const config = loadConfig({})
  expect(dockerfile).toContain(relative(config.migrationsDir))
  expect(relative(config.webDistDir)).toBe('dist/web')
  expect(dockerfile).toContain('/app/dist')
})

test('the data folder belongs to node before the image drops root', () => {
  expect(dockerfile.indexOf('chown node:node /data')).toBeGreaterThan(-1)
  expect(dockerfile.indexOf('chown node:node /data')).toBeLessThan(dockerfile.indexOf('USER node'))
})
