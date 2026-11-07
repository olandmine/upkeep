import { useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import type { Accent } from '../../../shared/accent'
import type { UserDto } from '../../../shared/types'
import { client, errorMessage, unwrap } from '../../lib/api'
import { cn } from '../../lib/cn'
import { meQuery } from '../../lib/queries'
import { Card, CardHeader } from '../ui/Card'
import { useToast } from '../ui/Toast'

const COLOURS: { value: Accent; label: string; swatch: string }[] = [
  { value: 'amber', label: 'Amber', swatch: 'var(--accent-amber)' },
  { value: 'blue', label: 'Blue', swatch: 'var(--cat-blue)' },
  { value: 'violet', label: 'Violet', swatch: 'var(--cat-violet)' },
  { value: 'rose', label: 'Rose', swatch: 'var(--cat-rose)' },
  { value: 'teal', label: 'Teal', swatch: 'var(--cat-teal)' },
  { value: 'slate', label: 'Slate', swatch: 'var(--cat-slate)' },
]

/** The colour applies straight away, saves in the background, and goes back if the save fails. */
export function AppearanceCard({ value }: { value: Accent }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const latest = useRef(0)

  async function choose(accent: Accent) {
    const attempt = ++latest.current
    const before = queryClient.getQueryData<UserDto>(meQuery.queryKey)
    if (before) queryClient.setQueryData(meQuery.queryKey, { ...before, accent })
    try {
      await unwrap<UserDto>(client.api.me.$patch({ json: { accent } }))
    } catch (err) {
      toast(errorMessage(err), 'error')
      // A later pick has already moved on, so only the latest one goes back.
      if (attempt === latest.current && before) queryClient.setQueryData(meQuery.queryKey, before)
      void queryClient.invalidateQueries({ queryKey: meQuery.queryKey })
    }
  }

  return (
    <Card aria-labelledby="appearance">
      <CardHeader id="appearance" title="Appearance" />
      <fieldset className="flex flex-col gap-2">
        <legend className="type-label mb-1.5 text-fg-2">Highlight colour</legend>
        <div className="flex flex-wrap gap-2">
          {COLOURS.map((c) => (
            <label
              key={c.value}
              className={cn(
                'type-label flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border px-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                value === c.value ? 'border-accent/50 bg-accent-muted text-fg' : 'border-line-2 text-fg-2',
              )}
            >
              <input
                type="radio"
                name="accent"
                className="sr-only"
                checked={value === c.value}
                onChange={() => void choose(c.value)}
              />
              <span aria-hidden className="size-3.5 rounded-full" style={{ background: c.swatch }} />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
    </Card>
  )
}
