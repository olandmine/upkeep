import type { DebtEntryKind } from '../../shared/types'
import { addDays, type LocalDate } from '../budgets/dates'
import { BudgetError } from '../budgets/errors'

/** One transaction from an ATO HELP statement. */
export interface HelpRow {
  /** The file's line number, from 1. */
  line: number
  processed: LocalDate
  effective: LocalDate
  description: string
  /** Debits are positive, credits negative. */
  amountCents: number
  /** `DR` is positive, `CR` negative. */
  balanceCents: number
}

/** What an import writes to the debt. */
export interface HelpImportPlan {
  /** The $0 starting balance's date: the day before the earliest effective date. */
  start: LocalDate
  closing: { asOf: LocalDate; balanceCents: number }
  /** Oldest first. */
  entries: { kind: DebtEntryKind; date: LocalDate; amountCents: number; note: string }[]
  /** 1 June → the indexation the ATO charged. */
  edits: Record<LocalDate, number>
  /** Oldest first. */
  rates: { fromDate: LocalDate; rateBp: number }[]
}

const HEADER = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'
const NOT_A_STATEMENT = "That isn't an ATO HELP statement. Download the CSV from your ATO HELP account."
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const INDEXATION = /^Indexation applied .*@\s*(\d*\.?\d+)\s*%/
const AMENDMENT = /^Amendment to indexation/
const NOTE_MAX = 100

/** Splits one CSV line; quoted fields may hold commas and doubled quotes. */
function fields(text: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(field)
      field = ''
    } else field += ch
  }
  out.push(field)
  return out
}

/** Drops empty fields from the end of a line, past the sixth. */
function trimEmpty(f: string[]): string[] {
  const out = [...f]
  while (out.length > 6 && out.at(-1)!.trim() === '') out.pop()
  return out
}

/** `01 Jun 2026` → `2026-06-01`, or null. */
function date(text: string): LocalDate | null {
  const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(text.trim())
  const month = m ? MONTHS.indexOf(m[2]!) + 1 : 0
  if (!m || month === 0) return null
  const iso = `${m[3]}-${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  const check = new Date(`${iso}T00:00:00Z`)
  return check.getUTCMonth() + 1 === month && check.getUTCDate() === Number(m[1]) ? iso : null
}

/** `$1,925.72` → 192572; blank → null; anything else → NaN. */
function cents(text: string): number | null {
  const t = text
    .trim()
    .replace(/^\$\s*/, '')
    .replaceAll(',', '')
  if (t === '') return null
  return /^\d*\.?\d+$/.test(t) ? Math.round(Number(t) * 100) : NaN
}

export function parseHelpStatement(text: string): HelpRow[] {
  // A byte-order mark isn't part of the first title line.
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)
  const header = lines.slice(0, 10).findIndex((l) => trimEmpty(fields(l)).join(',').trim() === HEADER)
  if (header < 0) throw new BudgetError(400, NOT_A_STATEMENT)
  const rows: HelpRow[] = []
  for (let i = header + 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '') continue
    const bad = () => new BudgetError(400, `Line ${i + 1} of the statement couldn't be read.`)
    // A spreadsheet re-save can add empty columns at the end.
    const f = trimEmpty(fields(lines[i]!))
    if (f.length !== 6) throw bad()
    const [processed, effective, description, debitText, creditText] = [
      date(f[0]!),
      date(f[1]!),
      f[2]!,
      cents(f[3]!),
      cents(f[4]!),
    ]
    // $0.00 beside a real amount counts as blank.
    const debit = debitText === 0 && creditText !== null ? null : debitText
    const credit = creditText === 0 && debit !== null ? null : creditText
    const balance = /^(.*?)\s*(DR|CR)?\s*$/.exec(f[5]!)!
    const balanceCents = cents(balance[1]!)
    if (!processed || !effective || (debit === null) === (credit === null) || balanceCents === null)
      throw bad()
    const amountCents = debit ?? (credit === 0 ? 0 : -credit!)
    if (Number.isNaN(amountCents) || Number.isNaN(balanceCents)) throw bad()
    rows.push({
      line: i + 1,
      processed,
      effective,
      description: description.trim().replace(/^'\s*/, ''),
      amountCents,
      balanceCents: balance[2] === 'CR' ? -balanceCents : balanceCents,
    })
  }
  if (rows.length === 0) throw new BudgetError(400, NOT_A_STATEMENT)
  return rows
}

const juneFirst = (year: number) => `${year}-06-01`
const yearOf = (d: LocalDate) => Number(d.slice(0, 4))

/** Turns statement rows into what the debt's history becomes. `rows` is in file order. */
export function planHelpImport(rows: HelpRow[]): HelpImportPlan {
  const start = addDays(
    rows.reduce((min, r) => (r.effective < min ? r.effective : min), rows[0]!.effective),
    -1,
  )
  // The latest processed row; the file lists newest first, so the first of a tie wins.
  const last = rows.reduce((best, r) => (r.processed > best.processed ? r : best), rows[0]!)
  const closing = { asOf: last.processed, balanceCents: Math.max(0, last.balanceCents) }

  const entries: HelpImportPlan['entries'] = []
  const edits: Record<LocalDate, number> = {}
  const rates = new Map<LocalDate, number>()
  const entry = (date: LocalDate, amountCents: number, note: string) =>
    entries.push({
      kind: amountCents > 0 ? 'added' : 'payment',
      date,
      amountCents: Math.abs(amountCents),
      note: note.slice(0, NOTE_MAX),
    })

  for (const r of rows) {
    const indexation = INDEXATION.exec(r.description)
    const isJune = r.effective === juneFirst(yearOf(r.effective))
    if (r.amountCents === 0) continue
    if (indexation && r.amountCents > 0 && isJune) {
      edits[r.effective] = (edits[r.effective] ?? 0) + r.amountCents
      rates.set(r.effective, Math.round(Number(indexation[1]) * 100))
    } else if (AMENDMENT.test(r.description) && isJune) {
      edits[r.effective] = (edits[r.effective] ?? 0) + r.amountCents
    } else {
      entry(r.effective, r.amountCents, r.description)
    }
  }

  for (const [chargeDate, cents] of Object.entries(edits)) {
    if (cents >= 0) continue
    edits[chargeDate] = 0
    entry(chargeDate, cents, 'Amendment to indexation')
  }
  // The ATO charged nothing on these 1 Junes; without an edit Upkeep would work out indexation itself.
  for (let y = yearOf(start); juneFirst(y) <= closing.asOf; y++) {
    if (juneFirst(y) > start) edits[juneFirst(y)] ??= 0
  }

  entries.sort((a, b) => a.date.localeCompare(b.date))
  return {
    start,
    closing,
    entries,
    edits: Object.fromEntries(Object.entries(edits).sort()),
    rates: [...rates].sort().map(([fromDate, rateBp]) => ({ fromDate, rateBp })),
  }
}
