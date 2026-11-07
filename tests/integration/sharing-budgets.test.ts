import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import { insertLine } from '../../src/server/budgets/lines'
import * as s from '../../src/server/db/schema'
import type { SharingLevel } from '../../src/shared/sharing'
import type { BudgetDto, PayEventDto } from '../../src/shared/types'
import { createTestApp, OWNER, type TestApp } from '../helpers/app'
import { seedEvents } from '../helpers/budget-seed'

// The viewer is the owner login; the "owner" of the hidden data is the partner login, whose level varies.
const OTHER_ID = 'other'
const NOW = new Date('2026-10-29T00:00:00Z')
const PAYS = ['2026-10-01', '2026-10-15']
let t: TestApp
let cookie: string
let viewerId: string
let theirs: string
let mine: string
let joint: string
let theirLine: string

const get = (path: string) => t.json(path, { cookie })
const send = (path: string, method: string, body?: unknown) => t.json(path, { method, body, cookie })
const setLevel = (level: SharingLevel | null) =>
  t.db.update(s.users).set({ sharingLevel: level }).where(eq(s.users.id, OTHER_ID)).run()
const lineRow = () => t.db.select().from(s.budgetLines).where(eq(s.budgetLines.id, theirLine)).get()!
const newLine = { kind: 'spending' as const, name: 'Fun', amountCents: 100, categoryIds: [], saverAccountId: null }

beforeEach(async () => {
  t = createTestApp({ now: NOW })
  cookie = await t.setupOwner()
  viewerId = t.db.select().from(s.users).where(eq(s.users.username, OWNER.username)).get()!.id
  t.db
    .insert(s.users)
    .values({ id: OTHER_ID, username: 'partner', displayName: 'Partner', passwordHash: 'x', createdAt: '2026-01-01T00:00:00.000Z', sharingLevel: 'full' })
    .run()
  const budgets = (await (await get('/api/budgets')).json()) as BudgetDto[]
  theirs = budgets.find((b) => b.ownerUserId === OTHER_ID)!.id
  mine = budgets.find((b) => b.ownerUserId === viewerId)!.id
  joint = budgets.find((b) => b.kind === 'joint')!.id
  // The joint budget runs on the owner's pay, so the viewer can only read it if joint stays visible.
  t.db.update(s.budgets).set({ anchorUserId: OTHER_ID }).where(eq(s.budgets.id, joint)).run()
  seedEvents(t.db, OTHER_ID, PAYS)
  t.db
    .insert(s.payEvents)
    .values({ userId: OTHER_ID, payDate: '2026-09-17', source: 'scheduled', transactionId: null, amountCents: null, derivedAt: '2026-01-01T00:00:00.000Z' })
    .run()
  theirLine = insertLine(t.db, theirs, newLine, NOW)
})

describe.each(['balances', 'none', null] as const)('at %s', (level) => {
  beforeEach(() => setLevel(level))

  test('GET /budgets leaves out the owner personal budget', async () => {
    const budgets = (await (await get('/api/budgets')).json()) as BudgetDto[]
    expect(budgets.map((b) => b.id).sort()).toEqual([mine, joint].sort())
  })

  test("the owner's budget period is 404, like an unknown budget", async () => {
    const hidden = await get(`/api/budgets/${theirs}/period`)
    const unknown = await get('/api/budgets/nope/period')
    expect(hidden.status).toBe(404)
    expect(await hidden.json()).toEqual(await unknown.json())
  })

  test('the joint budget period is still readable', async () => {
    expect((await get(`/api/budgets/${joint}/period`)).status).toBe(200)
  })

  test.each([
    `/api/plans/${OTHER_ID}/2026-10-15`,
    `/api/budgets/standard-pay/${OTHER_ID}`,
    `/api/pay-events?userId=${OTHER_ID}`,
  ])('GET %s is 404', async (path) => {
    const res = await get(path)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'User not found' })
  })

  test('line writes are 404, like a missing line, and change nothing', async () => {
    const before = lineRow()
    const patch = await send(`/api/budget-lines/${theirLine}`, 'PATCH', { amountCents: 5 })
    const archive = await send(`/api/budget-lines/${theirLine}/archive`, 'POST')
    const create = await send(`/api/budgets/${theirs}/lines`, 'POST', newLine)
    expect([patch.status, archive.status, create.status]).toEqual([404, 404, 404])
    const missing = await send('/api/budget-lines/nope', 'PATCH', { amountCents: 5 })
    expect(await patch.json()).toEqual(await missing.json())
    expect(await archive.json()).toEqual({ error: 'Line not found' })
    expect(lineRow()).toEqual(before)
    expect(t.db.select().from(s.budgetLines).where(eq(s.budgetLines.budgetId, theirs)).all()).toHaveLength(1)
  })

  test('an archived line of a hidden budget looks missing too', async () => {
    t.db.update(s.budgetLines).set({ archivedAt: '2026-10-01T00:00:00.000Z' }).where(eq(s.budgetLines.id, theirLine)).run()
    const res = await send(`/api/budget-lines/${theirLine}`, 'PATCH', { amountCents: 5 })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Line not found' })
  })
})

describe('at hide-transactions', () => {
  beforeEach(() => setLevel('hide-transactions'))

  test('the budget and its period are visible', async () => {
    const budgets = (await (await get('/api/budgets')).json()) as BudgetDto[]
    expect(budgets.map((b) => b.id).sort()).toEqual([mine, joint, theirs].sort())
    expect((await get(`/api/budgets/${theirs}/period`)).status).toBe(200)
  })

  test('plans and standard pay are readable', async () => {
    expect((await get(`/api/plans/${OTHER_ID}/2026-10-15`)).status).toBe(200)
    expect((await get(`/api/budgets/standard-pay/${OTHER_ID}`)).status).toBe(200)
  })

  test('pay events lose their transaction ids but keep amounts and payNotSeen', async () => {
    const res = await get(`/api/pay-events?userId=${OTHER_ID}`)
    expect(res.status).toBe(200)
    const events = (await res.json()) as PayEventDto[]
    expect(events).toHaveLength(3)
    expect(events.every((e) => e.transactionId === null)).toBe(true)
    expect(events.filter((e) => e.amountCents === 400000)).toHaveLength(2)
    // Computed before the id is removed: only the scheduled pay with no deposit is "not seen".
    expect(events.map((e) => [e.payDate, e.payNotSeen])).toEqual([
      ['2026-10-15', false],
      ['2026-10-01', false],
      ['2026-09-17', true],
    ])
  })

  test('editing their line is still 403', async () => {
    const res = await send(`/api/budget-lines/${theirLine}`, 'PATCH', { amountCents: 5 })
    expect(res.status).toBe(403)
    expect((await send(`/api/budgets/${theirs}/lines`, 'POST', newLine)).status).toBe(403)
  })
})

describe('at full, and for your own pay', () => {
  test('transaction ids stay at full', async () => {
    const events = (await (await get(`/api/pay-events?userId=${OTHER_ID}`)).json()) as PayEventDto[]
    expect(events.filter((e) => e.transactionId !== null)).toHaveLength(2)
  })

  test('your own events keep ids with no userId or your own, whatever the other level', async () => {
    setLevel('none')
    seedEvents(t.db, viewerId, ['2026-10-08'])
    for (const path of ['/api/pay-events', `/api/pay-events?userId=${viewerId}`]) {
      const events = (await (await get(path)).json()) as PayEventDto[]
      expect(events.map((e) => e.transactionId)).toEqual([`${viewerId}-pay0`])
    }
  })
})
