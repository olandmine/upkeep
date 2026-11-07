import { expect, test } from 'vitest'
import { parseHelpStatement, planHelpImport, type HelpRow } from '../../src/server/debts/help-statement'

const HEADER = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'
const line = (
  processed: string,
  effective: string,
  description: string,
  debit: string,
  credit: string,
  balance: string,
) => [processed, effective, description, debit, credit, balance].map((f) => `"${f}"`).join(',')
const statement = (...rows: string[]) =>
  ['"Higher Education Loan Program (HELP) 001"', '"CITIZEN, JANE"', HEADER, ...rows].join('\n')

// Newest processed first, as the ATO lists them. Ends at $5,850.00.
const SAMPLE = statement(
  line(
    '20 Aug 2025',
    '20 Aug 2025',
    "' 2025 HELP Compulsory repayment credit",
    '',
    '$1,000.00',
    '$5,850.00 DR',
  ),
  line(
    '01 Jun 2025',
    '01 Jun 2025',
    "'Indexation applied on HELP debt of $6000.00 @ 2.50 %",
    '$150.00',
    '',
    '$6,850.00 DR',
  ),
  line('10 Mar 2025', '01 Jun 2024', "'Amendment to indexation", '', '$40.00', '$6,700.00 DR'),
  line(
    '01 Jun 2024',
    '01 Jun 2024',
    "'Indexation applied on HELP debt of $4000.00 @ .60 %",
    '$40.00',
    '',
    '$6,740.00 DR',
  ),
  line(
    '15 Apr 2024',
    '31 Mar 2024',
    "' New loan for HELP for XX000A ( ABCD1234 ) at A UNIVERSITY",
    '$2,700.00',
    '',
    '$6,700.00 DR',
  ),
  line(
    '02 Jul 2022',
    '01 Jan 2022',
    "'Combined HELP file - HELP for the period from 01 Jun 21 to 31 May 22",
    '$4,000.00',
    '',
    '$4,000.00 DR',
  ),
)

test('reads rows past the title lines, with quoted commas, signs and cleaned descriptions', () => {
  const rows = parseHelpStatement(SAMPLE)
  expect(rows).toHaveLength(6)
  expect(rows[0]).toEqual({
    line: 4,
    processed: '2025-08-20',
    effective: '2025-08-20',
    description: '2025 HELP Compulsory repayment credit',
    amountCents: -100_000,
    balanceCents: 585_000,
  })
  expect(rows[1]!.amountCents).toBe(15_000)
  expect(rows[5]!.effective).toBe('2022-01-01')
})

test('ignores a byte-order mark, CRLF line endings and blank lines', () => {
  const rows = parseHelpStatement(`${String.fromCharCode(0xfeff)}${SAMPLE.replaceAll('\n', '\r\n')}\r\n\r\n`)
  expect(rows).toHaveLength(6)
})

test('reads amounts without a dollar sign or with spaces, and a CR balance as negative', () => {
  const [row] = parseHelpStatement(
    statement(line('01 Jul 2025', '01 Jul 2025', 'Refund', '', ' 1,925.72 ', '$12.50 CR')),
  )
  expect(row!.amountCents).toBe(-192_572)
  expect(row!.balanceCents).toBe(-1_250)
})

test('refuses a file without the header', () => {
  expect(() => parseHelpStatement('Date,Amount\n"01 Jun 2025","$5.00"')).toThrow(
    "That isn't an ATO HELP statement. Download the CSV from your ATO HELP account.",
  )
})

test('refuses a header with no rows', () => {
  expect(() => parseHelpStatement(statement())).toThrow("That isn't an ATO HELP statement.")
})

test('refuses a row with both or neither amount, naming its line', () => {
  expect(() =>
    parseHelpStatement(statement(line('01 Jun 2025', '01 Jun 2025', 'x', '$1.00', '$1.00', '$0.00 DR'))),
  ).toThrow("Line 4 of the statement couldn't be read.")
  expect(() =>
    parseHelpStatement(
      statement(SAMPLE.split('\n')[3]!, line('28 Feb 2025', '01 Jun 2025', 'x', '', '', '$0.00 DR')),
    ),
  ).toThrow("Line 5 of the statement couldn't be read.")
})

test('refuses a row with a bad date', () => {
  expect(() =>
    parseHelpStatement(statement(line('1 June 2025', '01 Jun 2025', 'x', '$1.00', '', '$1.00 DR'))),
  ).toThrow("Line 4 of the statement couldn't be read.")
})

const row = (over: Partial<HelpRow>): HelpRow => ({
  line: 4,
  processed: '2025-01-01',
  effective: '2025-01-01',
  description: 'New loan',
  amountCents: 100,
  balanceCents: 100,
  ...over,
})

test('plans the sample: start, closing, entries, indexation edits and rates', () => {
  const plan = planHelpImport(parseHelpStatement(SAMPLE))
  expect(plan.start).toBe('2021-12-31')
  expect(plan.closing).toEqual({ asOf: '2025-08-20', balanceCents: 585_000 })
  expect(plan.entries).toEqual([
    {
      kind: 'added',
      date: '2022-01-01',
      amountCents: 400_000,
      note: 'Combined HELP file - HELP for the period from 01 Jun 21 to 31 May 22',
    },
    {
      kind: 'added',
      date: '2024-03-31',
      amountCents: 270_000,
      note: 'New loan for HELP for XX000A ( ABCD1234 ) at A UNIVERSITY',
    },
    {
      kind: 'payment',
      date: '2025-08-20',
      amountCents: 100_000,
      note: '2025 HELP Compulsory repayment credit',
    },
  ])
  // 2022 and 2023 had no indexation; 2024's $40 was amended away to $0.
  expect(plan.edits).toEqual({ '2022-06-01': 0, '2023-06-01': 0, '2024-06-01': 0, '2025-06-01': 15_000 })
  expect(plan.rates).toEqual([
    { fromDate: '2024-06-01', rateBp: 60 },
    { fromDate: '2025-06-01', rateBp: 250 },
  ])
})

test('folds debit amendments into the year and starts a year with only amendments at $0', () => {
  const plan = planHelpImport([
    row({
      processed: '2024-03-06',
      effective: '2023-06-01',
      description: 'Amendment to indexation',
      amountCents: 32_837,
    }),
    row({
      processed: '2023-06-01',
      effective: '2023-06-01',
      description: 'Indexation applied on HELP debt of $1.00 @ 7.10 %',
      amountCents: 400_000,
    }),
    row({
      processed: '2024-12-11',
      effective: '2022-06-01',
      description: 'Amendment to indexation',
      amountCents: 5_000,
    }),
    row({ processed: '2021-01-01', effective: '2021-01-01', amountCents: 100_000 }),
  ])
  expect(plan.edits['2023-06-01']).toBe(432_837)
  expect(plan.edits['2022-06-01']).toBe(5_000)
  expect(plan.edits['2021-06-01']).toBe(0)
  expect(plan.rates).toEqual([{ fromDate: '2023-06-01', rateBp: 710 }])
})

test('a year amended below $0 gets a $0 edit and a payment for the rest', () => {
  const plan = planHelpImport([
    row({
      processed: '2025-03-01',
      effective: '2024-06-01',
      description: 'Amendment to indexation',
      amountCents: -5_000,
    }),
    row({
      processed: '2024-06-01',
      effective: '2024-06-01',
      description: 'Indexation applied on HELP debt of $1.00 @ 1.00 %',
      amountCents: 3_000,
    }),
    row({ processed: '2024-01-01', effective: '2024-01-01', amountCents: 900_000 }),
  ])
  expect(plan.edits['2024-06-01']).toBe(0)
  expect(plan.entries).toContainEqual({
    kind: 'payment',
    date: '2024-06-01',
    amountCents: 2_000,
    note: 'Amendment to indexation',
  })
})

test('an amendment on another date is an ordinary entry', () => {
  const plan = planHelpImport([
    row({
      processed: '2025-03-01',
      effective: '2024-07-15',
      description: 'Amendment to indexation',
      amountCents: -700,
    }),
    row({ processed: '2024-01-01', effective: '2024-01-01', amountCents: 900_000 }),
  ])
  expect(plan.entries).toContainEqual({
    kind: 'payment',
    date: '2024-07-15',
    amountCents: 700,
    note: 'Amendment to indexation',
  })
})

test('1 Junes after the closing date stay calculated', () => {
  const plan = planHelpImport([row({ processed: '2025-05-01', effective: '2025-05-01' })])
  expect(plan.edits).toEqual({})
})

test('the closing balance is the latest processed row, the first listed when tied, with CR as $0', () => {
  const plan = planHelpImport([
    row({ processed: '2025-03-01', effective: '2025-03-01', balanceCents: -500, amountCents: -100 }),
    row({ processed: '2025-03-01', effective: '2025-02-01', balanceCents: 400 }),
    row({ processed: '2024-01-01', effective: '2025-04-01', balanceCents: 999 }),
  ])
  expect(plan.closing).toEqual({ asOf: '2025-03-01', balanceCents: 0 })
})

test('notes are cut to 100 characters', () => {
  const plan = planHelpImport([row({ description: 'x'.repeat(140) })])
  expect(plan.entries[0]!.note).toHaveLength(100)
})

test('reads a file re-saved with trailing commas and "$ 5.00" amounts', () => {
  const rows = parseHelpStatement(
    [`${HEADER},`, `${line('01 Jul 2025', '01 Jul 2025', 'New loan', '$ 5.00', '', '$ 5.00 DR')},`].join(
      '\n',
    ),
  )
  expect(rows).toEqual([expect.objectContaining({ amountCents: 500, balanceCents: 500 })])
})

test('a $0.00 amount counts as blank, and a row of only $0.00 is left out of the plan', () => {
  const [both, zero] = parseHelpStatement(
    statement(
      line('02 Jul 2025', '02 Jul 2025', 'Credit', '$0.00', '$7.00', '$5.00 DR'),
      line('01 Jul 2025', '01 Jul 2025', 'Nothing', '$0.00', '', '$12.00 DR'),
    ),
  )
  expect(both!.amountCents).toBe(-700)
  expect(zero!.amountCents).toBe(0)
  const plan = planHelpImport([zero!, row({ effective: '2025-06-30', amountCents: 1_200 })])
  expect(plan.entries).toEqual([expect.objectContaining({ amountCents: 1_200 })])
})

test('indexation dated other than 1 June is an ordinary entry', () => {
  const plan = planHelpImport([
    row({
      processed: '2025-06-02',
      effective: '2025-06-02',
      description: 'Indexation applied on HELP debt of $1.00 @ 3.20 %',
      amountCents: 900,
    }),
    row({ processed: '2025-01-01', effective: '2025-01-01' }),
  ])
  expect(plan.rates).toEqual([])
  expect(plan.entries).toContainEqual(
    expect.objectContaining({ kind: 'added', date: '2025-06-02', amountCents: 900 }),
  )
})
