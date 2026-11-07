import { beforeEach, expect, test } from 'vitest'
import type { DebtDetailDto, DebtInputDto, HelpImportSummaryDto } from '../../src/shared/types'
import { createTestApp, type TestApp } from '../helpers/app'
import { local, seedAccount, seedTx } from '../helpers/budget-seed'
import * as s from '../../src/server/db/schema'

const NOW = new Date('2026-10-30T01:00:00Z')

let t: TestApp
let owner: string
let partner: string
let ownerId: string

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await t.json(path, { cookie: owner, ...init })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const createDebt = async (over: Partial<DebtInputDto> = {}) =>
  (
    await call('/api/debts', {
      method: 'POST',
      body: {
        name: 'Hecs',
        kind: 'hecs',
        ownerUserId: ownerId,
        rateBp: 280,
        repaymentCents: 0,
        repaymentFrequency: 'monthly',
        balanceCents: 6_000_000,
        asOf: '2026-10-29',
        ...over,
      },
    })
  ).body.id as string

const detail = async (id: string) => (await call(`/api/debts/${id}`)).body as DebtDetailDto
const importCsv = (id: string, csv: string, dryRun: boolean, cookie = owner) =>
  call(`/api/debts/${id}/import`, { method: 'POST', body: { csv, dryRun }, cookie })

const HEADER = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'
const line = (...f: string[]) => f.map((x) => `"${x}"`).join(',')
// Ends at $5,850.00 on 20 Aug 2026; the repayment and the closing check share that day.
const CSV = [
  '"Higher Education Loan Program (HELP) 001"',
  '"CITIZEN, JANE"',
  HEADER,
  line(
    '20 Aug 2026',
    '20 Aug 2026',
    "' 2026 HELP Compulsory repayment credit",
    '',
    '$1,000.00',
    '$5,850.00 DR',
  ),
  line(
    '01 Jun 2026',
    '01 Jun 2026',
    "'Indexation applied on HELP debt of $6000.00 @ 2.50 %",
    '$150.00',
    '',
    '$6,850.00 DR',
  ),
  line('10 Mar 2026', '01 Jun 2025', "'Amendment to indexation", '', '$40.00', '$6,700.00 DR'),
  line(
    '01 Jun 2025',
    '01 Jun 2025',
    "'Indexation applied on HELP debt of $4000.00 @ .60 %",
    '$40.00',
    '',
    '$6,740.00 DR',
  ),
  line(
    '15 Apr 2025',
    '31 Mar 2025',
    "' New loan for HELP for XX000A ( ABCD1234 ) at A UNIVERSITY",
    '$2,700.00',
    '',
    '$6,700.00 DR',
  ),
  line(
    '02 Jul 2024',
    '01 Jan 2024',
    "'Combined HELP file - HELP for the period",
    '$4,000.00',
    '',
    '$4,000.00 DR',
  ),
].join('\n')

const counts = (id: string) => ({
  balances: t.db
    .select()
    .from(s.debtBalances)
    .all()
    .filter((r) => r.debtId === id).length,
  rates: t.db
    .select()
    .from(s.debtRates)
    .all()
    .filter((r) => r.debtId === id).length,
  entries: t.db
    .select()
    .from(s.debtEntries)
    .all()
    .filter((r) => r.debtId === id).length,
  edits: t.db
    .select()
    .from(s.debtInterestEdits)
    .all()
    .filter((r) => r.debtId === id).length,
})

beforeEach(async () => {
  t = createTestApp({ now: NOW })
  owner = await t.setupOwner()
  partner = await t.addPartner(owner)
  ownerId = (await call('/api/me')).body.id
  seedAccount(t.db, { id: 'acc-spend', owner: ownerId })
})

test('a preview summarises the statement and writes nothing', async () => {
  const id = await createDebt()
  const before = counts(id)
  const res = await importCsv(id, CSV, true)
  expect(res.status).toBe(200)
  expect(res.body).toEqual({
    rows: 6,
    from: '2024-01-01',
    to: '2026-08-20',
    added: { count: 2, cents: 670_000 },
    credits: { count: 1, cents: 100_000 },
    indexationYears: 1,
    closingCents: 585_000,
    replayCents: 585_000,
    replaces: { balances: 1, rates: 1, entries: 0, edits: 0 },
  } satisfies HelpImportSummaryDto)
  expect(counts(id)).toEqual(before)
})

test('an import replaces the history and ends at the statement balance', async () => {
  const id = await createDebt()
  t.db.insert(s.debtRepaymentRules).values({ id: 'rule-1', debtId: id, match: 'ato help' }).run()
  const res = await importCsv(id, CSV, false)
  expect(res.status).toBe(200)

  const d = await detail(id)
  expect(d.interest).toEqual({ calc: 'on_charge', charge: 'yearly', chargeDay: null, chargeDate: '06-01' })
  expect(d.balances).toEqual([
    expect.objectContaining({ asOf: '2023-12-31', balanceCents: 0 }),
    expect.objectContaining({ asOf: '2026-08-20', balanceCents: 585_000, correctionCents: 0 }),
  ])
  expect(d.rates.map((r) => [r.fromDate, r.rateBp])).toEqual([
    ['2025-06-01', 60],
    ['2026-06-01', 250],
  ])
  expect(d.balanceCents).toBe(585_000)
  const interest = d.activity.filter((r) => r.kind === 'interest').map((r) => [r.date, r.amountCents])
  expect(interest).toEqual([
    ['2026-06-01', 15_000],
    ['2025-06-01', 0],
    ['2024-06-01', 0],
  ])
  expect(d.repaymentRules).toEqual([expect.objectContaining({ match: 'ato help' })])
})

test('importing again replaces everything again, hand-made entries included', async () => {
  const id = await createDebt()
  await importCsv(id, CSV, false)
  await call(`/api/debts/${id}/entries`, {
    method: 'POST',
    body: { kind: 'added', date: '2026-09-01', amountCents: 500, note: 'By hand' },
  })
  const preview = await importCsv(id, CSV, true)
  expect(preview.body.replaces).toEqual({ balances: 2, rates: 2, entries: 4, edits: 3 })
  await importCsv(id, CSV, false)
  expect(counts(id)).toEqual({ balances: 2, rates: 2, entries: 3, edits: 3 })
  expect((await detail(id)).activity.some((r) => r.kind === 'added' && r.note === 'By hand')).toBe(false)
})

test('a statement without indexation keeps the current rate from its start', async () => {
  const id = await createDebt()
  const csv = [HEADER, line('02 Jul 2026', '01 Jul 2026', 'New loan', '$100.00', '', '$100.00 DR')].join('\n')
  await importCsv(id, csv, false)
  expect((await detail(id)).rates.map((r) => [r.fromDate, r.rateBp])).toEqual([['2026-06-30', 280]])
})

test('only HECS debts import, only editors can, and bad files are refused', async () => {
  const loan = await createDebt({ kind: 'loan', name: 'Car' })
  const refused = await importCsv(loan, CSV, true)
  expect(refused.status).toBe(400)
  expect(refused.body.error).toBe('Only HECS debts can import an ATO HELP statement.')

  const id = await createDebt()
  expect((await importCsv(id, CSV, false, partner)).status).toBe(403)
  expect((await importCsv('nope', CSV, true)).status).toBe(404)

  const bad = await importCsv(id, 'Date,Amount', true)
  expect(bad.status).toBe(400)
  expect(bad.body.error).toBe(
    "That isn't an ATO HELP statement. Download the CSV from your ATO HELP account.",
  )
  expect((await importCsv(id, '', true)).status).toBe(400)
  expect(counts(id)).toEqual({ balances: 1, rates: 1, entries: 0, edits: 0 })
})

test('before the closing date the statement stands alone: no assumed or Up repayments', async () => {
  // A usual repayment with no rule would otherwise be assumed on every due date back to 2023.
  const assumed = await createDebt({ repaymentCents: 20_000 })
  await importCsv(assumed, CSV, false)
  let d = await detail(assumed)
  expect(d.activity.filter((r) => r.kind === 'assumed' && r.date <= '2026-08-20')).toEqual([])
  expect(d.balances.at(-1)).toMatchObject({ asOf: '2026-08-20', correctionCents: 0 })

  // A BPAY from Up inside the statement period is already one of its credits.
  const ruled = await createDebt({ name: 'Hecs 2' })
  seedTx(t.db, {
    id: 'bpay-1',
    accountId: 'acc-spend',
    amountCents: -30_000,
    createdAt: local('2025-09-01'),
    description: 'ATO HELP',
  })
  seedTx(t.db, {
    id: 'bpay-2',
    accountId: 'acc-spend',
    amountCents: -10_000,
    createdAt: local('2026-09-01'),
    description: 'ATO HELP',
  })
  t.db.insert(s.debtRepaymentRules).values({ id: 'rule-2', debtId: ruled, match: 'ato help' }).run()
  await importCsv(ruled, CSV, false)
  d = await detail(ruled)
  expect(d.activity.filter((r) => r.kind === 'repayment').map((r) => r.date)).toEqual(['2026-09-01'])
  expect(d.balances.at(-1)).toMatchObject({ correctionCents: 0 })
  expect(d.balanceCents).toBe(575_000)
})

test('a statement with dates after today is refused', async () => {
  const id = await createDebt()
  const csv = [HEADER, line('02 Nov 2026', '02 Nov 2026', 'New loan', '$100.00', '', '$100.00 DR')].join('\n')
  const res = await importCsv(id, csv, true)
  expect(res.status).toBe(400)
  expect(res.body.error).toBe('That statement has dates after today.')
})

const NEW_DEBT = { name: 'Hecs', repaymentCents: 0, repaymentFrequency: 'monthly', rateBp: 280 }
const debtCount = () => t.db.select().from(s.debts).all().length

test('a new HECS debt previews from a statement without a debt, and writes nothing', async () => {
  const res = await call('/api/debts/statement/preview', { method: 'POST', body: { csv: CSV } })
  expect(res.status).toBe(200)
  expect(res.body).toMatchObject({
    rows: 6,
    to: '2026-08-20',
    closingCents: 585_000,
    replayCents: 585_000,
    replaces: { balances: 0, rates: 0, entries: 0, edits: 0 },
  })
  expect(debtCount()).toBe(0)
})

test('a new HECS debt can start from a statement', async () => {
  const res = await call('/api/debts/statement', {
    method: 'POST',
    body: { ...NEW_DEBT, ownerUserId: ownerId, csv: CSV },
  })
  expect(res.status).toBe(201)
  expect(res.body).toMatchObject({ name: 'Hecs', kind: 'hecs', balanceCents: 585_000 })
  const d = await detail(res.body.id)
  expect(d.interest).toEqual({ calc: 'on_charge', charge: 'yearly', chargeDay: null, chargeDate: '06-01' })
  expect(d.rates.map((r) => [r.fromDate, r.rateBp])).toEqual([
    ['2025-06-01', 60],
    ['2026-06-01', 250],
  ])
  expect(d.balances.at(-1)).toMatchObject({ asOf: '2026-08-20', balanceCents: 585_000, correctionCents: 0 })
  expect(counts(res.body.id)).toEqual({ balances: 2, rates: 2, entries: 3, edits: 3 })
})

test('a new debt from a statement without indexation takes the rate given', async () => {
  const csv = [HEADER, line('02 Jul 2026', '01 Jul 2026', 'New loan', '$100.00', '', '$100.00 DR')].join('\n')
  const res = await call('/api/debts/statement', {
    method: 'POST',
    body: { ...NEW_DEBT, ownerUserId: null, rateBp: 320, csv },
  })
  expect(res.status).toBe(201)
  expect((await detail(res.body.id)).rates.map((r) => [r.fromDate, r.rateBp])).toEqual([['2026-06-30', 320]])
})

test('a new debt from a bad statement, or for someone else, creates nothing', async () => {
  const bad = await call('/api/debts/statement', {
    method: 'POST',
    body: { ...NEW_DEBT, ownerUserId: ownerId, csv: 'Date,Amount' },
  })
  expect(bad.status).toBe(400)
  const partnerId = (await call('/api/me', { cookie: partner })).body.id
  const theirs = await call('/api/debts/statement', {
    method: 'POST',
    body: { ...NEW_DEBT, ownerUserId: partnerId, csv: CSV },
  })
  expect(theirs.status).toBe(403)
  expect(debtCount()).toBe(0)
})
