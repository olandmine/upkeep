import { useState, type FormEvent } from 'react'
import type { UserDto } from '../../../shared/types'
import { errorMessage } from '../../lib/api'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Field, Input } from '../ui/Input'

const MAX_USERS = 2

export function UsersCard({
  users,
  onAddPartner,
}: {
  users: UserDto[]
  onAddPartner: (input: { username: string; displayName: string; password: string }) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ displayName: '', username: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onAddPartner(form)
      setForm({ displayName: '', username: '', password: '' })
      setOpen(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  return (
    <Card aria-labelledby="users">
      <CardHeader id="users" title="People" />
      <ul className="mb-4 flex flex-col divide-y divide-line">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between py-2">
            <span className="type-body text-fg">{u.displayName}</span>
            <span className="type-caption text-fg-3">@{u.username}</span>
          </li>
        ))}
      </ul>
      {users.length < MAX_USERS &&
        (open ? (
          <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
            <Field label="Partner's name">{(p) => <Input {...p} value={form.displayName} onChange={set('displayName')} />}</Field>
            <Field label="Their Up $handle" hint="They'll log in with this.">
              {(p) => <Input {...p} autoComplete="off" maxLength={50} placeholder="$theirname" value={form.username} onChange={set('username')} />}
            </Field>
            <Field label="Initial password" hint="At least 8 characters. They can change it in Settings." error={error}>
              {(p) => <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                Create login
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button onClick={() => setOpen(true)}>Add partner</Button>
        ))}
    </Card>
  )
}
