import { useRef, useState, type FormEvent } from 'react'
import type { SyncStatusDto } from '../../../shared/types'
import { errorMessage } from '../../lib/api'
import { formatRelative } from '../../lib/relative-time'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Input'

type Connection = SyncStatusDto['connections'][number]

const STATUS = {
  ok: { tone: 'positive', label: 'Connected' },
  unauthorized: { tone: 'warning', label: 'Needs attention' },
  error: { tone: 'warning', label: 'Sync failing' },
} as const

const count = new Intl.NumberFormat('en-AU')

export function BankConnectionCard({
  connection,
  now,
  onConnect,
  onDisconnect,
  onSyncNow,
}: {
  connection: Connection | undefined
  now: Date
  onConnect: (token: string) => Promise<void>
  onDisconnect: () => Promise<void>
  onSyncNow: () => Promise<void>
}) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const showForm = !connection || connection.status === 'unauthorized' || replacing
  const backfilling = connection?.running?.kind === 'backfill'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onConnect(token.trim())
      setToken('')
      setReplacing(false)
    } catch (err) {
      setError(errorMessage(err))
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card aria-labelledby="bank-connection">
      <CardHeader
        id="bank-connection"
        title="Bank connection"
        action={connection && <Badge tone={STATUS[connection.status].tone}>{STATUS[connection.status].label}</Badge>}
      />

      {connection && (
        <div className="mb-4 flex flex-col gap-1">
          {backfilling ? (
            <p className="type-body num text-fg">Imported {count.format(connection.running!.transactionsUpserted)} transactions…</p>
          ) : connection.running ? (
            <p className="type-body text-fg-2">Syncing…</p>
          ) : connection.lastSyncedAt ? (
            <p className="type-body text-fg-2">Last synced {formatRelative(connection.lastSyncedAt, now)}</p>
          ) : null}
          {connection.status === 'unauthorized' && (
            <p className="type-body text-warning">Up rejected the saved token. Paste a new one to resume syncing.</p>
          )}
          {connection.status === 'error' && connection.lastError && (
            <p className="type-body text-warning">{connection.lastError}</p>
          )}
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <Field
            label="Up personal access token"
            error={error}
            hint={!error ? 'Create one in the Up app or at api.up.com.au. It is stored encrypted and never shown again.' : undefined}
          >
            {(p) => (
              <Input
                {...p}
                ref={inputRef}
                type="password"
                autoComplete="new-password"
                data-1p-ignore
                spellCheck={false}
                placeholder="up:yeah:…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy || !token.trim()}>
              Connect
            </Button>
            {replacing && (
              <Button variant="ghost" onClick={() => setReplacing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}

      {connection && !showForm && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run(onSyncNow)} disabled={busy || !!connection.running}>
            Sync now
          </Button>
          <Button variant="ghost" onClick={() => setReplacing(true)}>
            Replace token
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="destructive" className="sm:ml-auto">
                Disconnect
              </Button>
            }
            description="Disconnect Up? Synced transactions stay; syncing stops until you add a token again."
            confirmLabel="Disconnect"
            onConfirm={() => void run(onDisconnect)}
          />
        </div>
      )}
    </Card>
  )
}
