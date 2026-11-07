import { useState, type FormEvent } from 'react'
import type { NegativeStyle, UserDto } from '../../../shared/types'
import { errorMessage } from '../../lib/api'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Field, Input } from '../ui/Input'

export interface ProfilePatch {
  displayName?: string
  upDisplayName?: string | null
  negativeStyle?: NegativeStyle
  currentPassword?: string
  newPassword?: string
}

const STYLES: { value: NegativeStyle; label: string; example: string }[] = [
  { value: 'minus', label: 'Minus', example: '−$1,240.00' },
  { value: 'parentheses', label: 'Parentheses', example: '($1,240.00)' },
]

export function ProfileCard({ me, onSave }: { me: UserDto; onSave: (patch: ProfilePatch) => Promise<void> }) {
  const [profile, setProfile] = useState({
    displayName: me.displayName,
    upDisplayName: me.upDisplayName ?? '',
    negativeStyle: me.negativeStyle,
  })
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' })
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(patch: ProfilePatch, setError: (e: string | null) => void, after?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await onSave(patch)
      after?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = (e: FormEvent) => {
    e.preventDefault()
    void save({ ...profile, upDisplayName: profile.upDisplayName.trim() || null }, setProfileError)
  }
  const changePassword = (e: FormEvent) => {
    e.preventDefault()
    void save(passwords, setPasswordError, () => setPasswords({ currentPassword: '', newPassword: '' }))
  }

  return (
    <Card aria-labelledby="profile">
      <CardHeader id="profile" title="Profile" />
      <form onSubmit={saveProfile} className="flex flex-col gap-4" noValidate>
        <Field label="Display name">
          {(p) => <Input {...p} value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} />}
        </Field>
        <Field label="Your Up $handle" hint="For example $yourname, so joint spending on 2Up can be matched to you." error={profileError}>
          {(p) => (
            <Input {...p} value={profile.upDisplayName} onChange={(e) => setProfile({ ...profile, upDisplayName: e.target.value })} />
          )}
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="type-label mb-1.5 text-fg-2">Negative numbers</legend>
          <div className="flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <label
                key={s.value}
                className={cn(
                  'type-label flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-2',
                  profile.negativeStyle === s.value ? 'border-accent/50 bg-accent-muted text-fg' : 'border-line-2 text-fg-2',
                )}
              >
                <input
                  type="radio"
                  name="negativeStyle"
                  className="accent-[var(--accent)]"
                  checked={profile.negativeStyle === s.value}
                  onChange={() => setProfile({ ...profile, negativeStyle: s.value })}
                />
                {s.label} <span className="num text-fg-3">{s.example}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <Button type="submit" disabled={busy}>
            Save profile
          </Button>
        </div>
      </form>

      <form onSubmit={changePassword} className="mt-6 flex flex-col gap-4 border-t border-line pt-6" noValidate>
        <h3 className="type-label text-fg">Change password</h3>
        <Field label="Current password">
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="current-password"
              value={passwords.currentPassword}
              onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
            />
          )}
        </Field>
        <Field label="New password" hint="At least 8 characters" error={passwordError}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={passwords.newPassword}
              onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
            />
          )}
        </Field>
        <div>
          <Button type="submit" disabled={busy || !passwords.currentPassword || !passwords.newPassword}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  )
}
