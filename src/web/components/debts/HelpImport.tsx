import { useRef, useState } from 'react'
import type { HelpImportSummaryDto } from '../../../shared/types'
import { errorMessage } from '../../lib/api'
import { money } from '../budgets/format'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { longDate } from './DebtSections'

/** The server refuses longer statements; checked here before reading the file. */
const MAX_BYTES = 500_000

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A previewed statement, ready to import. */
export interface ReadyStatement {
  csv: string
  summary: HelpImportSummaryDto
}

/**
 * Picks an ATO HELP statement and shows its preview. `onReady` gets the
 * previewed statement, or null while there's none. `debtName` names what an import replaces.
 */
export function StatementField({
  debtName,
  onPreview,
  onReady,
}: {
  debtName?: string
  onPreview: (csv: string) => Promise<HelpImportSummaryDto>
  onReady: (ready: ReadyStatement | null) => void
}) {
  const [summary, setSummary] = useState<HelpImportSummaryDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  // The input is cleared after each pick, so the name is shown here instead.
  const [fileName, setFileName] = useState<string | null>(null)
  // Only the latest pick's preview is shown when files are picked quickly in a row.
  const latest = useRef(0)

  const pick = async (file: File) => {
    const id = ++latest.current
    setFileName(file.name)
    setSummary(null)
    setError(null)
    onReady(null)
    if (file.size > MAX_BYTES) {
      setError('That file is too big for an ATO HELP statement.')
      return
    }
    setReading(true)
    try {
      const text = await file.text()
      const preview = await onPreview(text)
      if (id !== latest.current) return
      setSummary(preview)
      onReady({ csv: text, summary: preview })
    } catch (err) {
      if (id === latest.current) setError(errorMessage(err))
    } finally {
      if (id === latest.current) setReading(false)
    }
  }

  const { replaces } = summary ?? {}
  return (
    <>
      <Field
        label="ATO HELP statement (CSV)"
        hint={fileName ?? 'Download it from your HELP account in ATO online services.'}
      >
        {(p) => (
          <Input
            {...p}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Cleared so picking the same file again previews it again.
              e.target.value = ''
              if (file) void pick(file)
            }}
          />
        )}
      </Field>

      <div aria-live="polite" className="type-body flex flex-col gap-1 text-fg-2">
        {reading && <p>Reading the statement…</p>}
        {error && (
          <p role="alert" className="text-negative">
            {error}
          </p>
        )}
        {summary && replaces && (
          <>
            <p className="text-fg">{`${count(summary.rows, 'row', 'rows')} from ${longDate(summary.from)} to ${longDate(summary.to)}`}</p>
            <p className="num">{`${summary.added.count} added · ${money(summary.added.cents)}`}</p>
            <p className="num">{`${count(summary.credits.count, 'credit', 'credits')} · ${money(summary.credits.cents)}`}</p>
            <p>{count(summary.indexationYears, 'year of indexation', 'years of indexation')}</p>
            {summary.replayCents === summary.closingCents ? (
              <p className="num text-positive">{`Ends at ${money(summary.closingCents)}, matching the statement.`}</p>
            ) : (
              <p className="num text-warning">
                {`Upkeep reaches ${money(summary.replayCents)} but the statement says ${money(summary.closingCents)}. Check the file before importing.`}
              </p>
            )}
            {debtName !== undefined && (
              <p className="type-caption mt-2 text-fg-3">
                {`This replaces ${debtName}'s ${count(replaces.balances, 'balance', 'balances')}, ${count(replaces.rates, 'rate', 'rates')}, ${count(replaces.entries, 'entry', 'entries')} and ${count(replaces.edits, 'interest edit', 'interest edits')}.`}
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}

/** Upload an ATO HELP statement, preview what it does, then replace the debt's history. */
export function HelpImportCard({
  debtName,
  onPreview,
  onImport,
  onCancel,
}: {
  debtName: string
  onPreview: (csv: string) => Promise<HelpImportSummaryDto>
  onImport: (csv: string) => Promise<void>
  onCancel: () => void
}) {
  const [ready, setReady] = useState<ReadyStatement | null>(null)
  const [importing, setImporting] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <StatementField debtName={debtName} onPreview={onPreview} onReady={setReady} />
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={!ready || importing}
          onClick={() => {
            if (!ready) return
            setImporting(true)
            // The page reports a failed import; the card stays open to try again.
            void onImport(ready.csv)
              .catch(() => {})
              .finally(() => setImporting(false))
          }}
        >
          {importing ? 'Importing…' : 'Replace history'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
