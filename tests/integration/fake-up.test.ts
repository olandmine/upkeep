import { expect, test } from 'vitest'
import { UpClient } from '../../src/server/up/client'
import { UpUnauthorizedError } from '../../src/server/up/errors'
import { buildAccount, buildTransaction } from '../fake-up/builders'
import { createFakeUp } from '../fake-up/fake-up'

const noSleep = async () => {}

function seeded(count = 150) {
  const fake = createFakeUp()
  fake.addAccount(buildAccount({ id: 'acc-1' }))
  fake.addAccount(buildAccount({ id: 'acc-2' }))
  fake.addCustomer('up:yeah:a', ['acc-1'])
  fake.addCustomer('up:yeah:b', ['acc-2'])
  const start = Date.parse('2026-01-01T00:00:00Z')
  for (let i = 0; i < count; i++) {
    fake.addTransaction(
      buildTransaction({
        id: `t${String(i).padStart(3, '0')}`,
        accountId: 'acc-1',
        amountCents: -100 - i,
        createdAt: new Date(start + i * 86_400_000).toISOString(),
      }),
    )
  }
  return fake
}

const clientFor = (fake: ReturnType<typeof createFakeUp>, token: string) =>
  new UpClient({ token, baseUrl: fake.baseUrl, fetchImpl: fake.fetch, sleep: noSleep })

test('pages transactions newest first', async () => {
  const fake = seeded()
  const sizes: number[] = []
  const ids: string[] = []
  for await (const p of clientFor(fake, 'up:yeah:a').transactionPages()) {
    sizes.push(p.items.length)
    ids.push(...p.items.map((t) => t.id))
  }
  expect(sizes).toEqual([100, 50])
  expect(ids[0]).toBe('t149')
  expect(new Set(ids).size).toBe(150)
})

test('filters by since and until', async () => {
  const fake = seeded()
  const ids: string[] = []
  for await (const p of clientFor(fake, 'up:yeah:a').transactionPages({
    since: '2026-01-11T00:00:00.000Z',
    until: '2026-01-13T00:00:00.000Z',
  })) {
    ids.push(...p.items.map((t) => t.id))
  }
  expect(ids).toEqual(['t011', 't010'])
})

test('limits visibility per token', async () => {
  const fake = seeded(10)
  let count = 0
  for await (const p of clientFor(fake, 'up:yeah:b').transactionPages()) count += p.items.length
  expect(count).toBe(0)
  expect((await clientFor(fake, 'up:yeah:b').listAccounts()).map((a) => a.id)).toEqual(['acc-2'])
  await expect(clientFor(fake, 'up:yeah:nope').ping()).rejects.toBeInstanceOf(UpUnauthorizedError)
})

test('injects failures that the client retries', async () => {
  const fake = seeded(10)
  fake.failNext(/\/transactions/, 500, 1)
  let count = 0
  for await (const p of clientFor(fake, 'up:yeah:a').transactionPages()) count += p.items.length
  expect(count).toBe(10)
  expect(fake.requests.filter((r) => r.url.pathname.endsWith('/transactions'))).toHaveLength(2)
})

test('supports category and tag write-back', async () => {
  const fake = seeded(1)
  const c = clientFor(fake, 'up:yeah:a')
  await c.setCategory('t000', 'groceries')
  expect(fake.categoryOf('t000')).toBe('groceries')
  expect((await c.getTransaction('t000'))?.relationships.parentCategory.data?.id).toBe('home')
  await c.addTags('t000', ['bali', 'trip'])
  await c.removeTags('t000', ['trip'])
  expect(fake.tagsOf('t000')).toEqual(['bali'])
  expect(await c.listTags()).toEqual(['bali'])
  expect(fake.requests.at(-1)?.token).toBe('up:yeah:a')
})

test('settle, remove and revoke change what clients see', async () => {
  const fake = seeded(2)
  const c = clientFor(fake, 'up:yeah:a')
  fake.addTransaction(buildTransaction({ id: 'h1', accountId: 'acc-1', amountCents: -500, createdAt: '2026-02-01T00:00:00Z', status: 'HELD' }))
  fake.settle('h1', -4210)
  expect((await c.getTransaction('h1'))?.attributes).toMatchObject({ status: 'SETTLED', amount: { valueInBaseUnits: -4210 } })
  fake.remove('h1')
  expect(await c.getTransaction('h1')).toBeNull()
  fake.revokeToken('up:yeah:a')
  await expect(c.ping()).rejects.toBeInstanceOf(UpUnauthorizedError)
})
