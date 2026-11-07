import { useState } from 'react'
import type { CategoryDto, SpendingHistoryDto } from '../../../shared/types'
import type { Bucket, SaverOption, SectionId } from '../../lib/pay-view'
import { PlainLink, type LinkLike } from '../AppLink'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Input'
import { money, parseDollars } from './format'

export interface BucketFormValues {
  name: string
  amountCents: number
  categoryIds: string[]
  saverAccountId: string | null
}

interface Props {
  section: SectionId
  /** The bucket being changed; without one the form adds a bucket. */
  bucket?: Bucket
  categories: CategoryDto[]
  /** Savers this bucket may use, each saying why it can't be chosen when that's so. */
  savers: SaverOption[]
  /** categoryId → name of the other bucket that already has it. */
  taken: Map<string, string>
  /** Recent spending, for suggestions and the warning when adding a limit; without it the form just goes without them. */
  history?: SpendingHistoryDto
  /** Transactions filtered to what `history` counts as uncategorised. */
  categoriseHref?: string
  LinkComponent?: LinkLike
  onSave: (values: BucketFormValues) => void
  onRemove?: () => void
  onCancel: () => void
}

const select = 'type-body h-9 rounded-sm border border-line-2 bg-elevated px-3 text-fg'
const MAX_SUGGESTIONS = 5

/** Adds a bucket, or changes one: what it's called, what it covers, its Saver, or taking it away. */
export function BucketForm({
  section,
  bucket,
  categories,
  savers,
  taken,
  history,
  categoriseHref = '',
  LinkComponent = PlainLink,
  onSave,
  onRemove,
  onCancel,
}: Props) {
  const adding = !bucket
  const isSaver = section === 'yours' || section === 'joint'
  // A Saver row that is really a limit paid from a Saver: its limit is changed here.
  const linked = isSaver && bucket?.lineKind === 'spending'
  // Limits, and Savers added fresh, have fields to fill; a plain Saver row has none.
  const limitLike = !isSaver || linked
  const [name, setName] = useState((linked ? bucket.lineName : null) ?? bucket?.name ?? '')
  const [amount, setAmount] = useState(linked ? ((bucket.limitCents ?? 0) / 100).toFixed(2) : '')
  const [picked, setPicked] = useState<Set<string>>(new Set(bucket?.categoryIds ?? []))
  const [saverId, setSaverId] = useState(bucket?.saverAccountId ?? '')

  const amountCents = parseDollars(amount)
  const valid = limitLike
    ? name.trim() !== '' && picked.size > 0 && (adding || linked ? amountCents !== null : true)
    : saverId !== '' && amountCents !== null
  // A plain Saver bucket has nothing to change once it exists, except to take it out.
  const editable = limitLike || adding

  const parents = categories.filter((c) => c.parentId === null)
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const offered = adding && limitLike ? history : undefined
  const named = new Map(categories.map((c) => [c.id, c]))
  const suggestions = (offered?.categories ?? [])
    .filter((s) => {
      const c = named.get(s.categoryId)
      return c && !taken.has(c.id) && !(c.parentId && taken.has(c.parentId))
    })
    .slice(0, MAX_SUGGESTIONS)
  // Ticks the category. The name and limit are only filled in when they're still empty, and nothing saves until Add.
  const suggest = (s: SpendingHistoryDto['categories'][number]) => {
    toggle(s.categoryId)
    if (picked.has(s.categoryId)) return
    if (name.trim() === '') setName(named.get(s.categoryId)?.name ?? '')
    if (amount.trim() === '') setAmount((s.perPayCents / 100).toFixed(2))
  }
  const uncategorised = offered?.uncategorised.count ?? 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    onSave({
      name: !limitLike ? (savers.find((s) => s.id === saverId)?.name ?? name) : name.trim(),
      amountCents: amountCents ?? bucket?.amountCents ?? 0,
      categoryIds: [...picked].sort(),
      saverAccountId: saverId || null,
    })
  }

  const categoryBox = (c: CategoryDto, indent: boolean) => {
    const takenBy = taken.get(c.id)
    return (
      <label key={c.id} className={`flex items-center gap-2 py-1 ${indent ? 'pl-6' : ''} ${takenBy ? 'text-fg-3' : 'text-fg'}`}>
        <input type="checkbox" checked={picked.has(c.id)} disabled={Boolean(takenBy)} onChange={() => toggle(c.id)} />
        <span>{c.name}</span>
        {takenBy && <span className="type-caption">{`in ${takenBy}`}</span>}
      </label>
    )
  }

  const saverField = (
    <Field
      label="Saver"
      hint={
        section === 'shared'
          ? 'Optional: shows whether it covers this limit'
          : section === 'spending'
            ? 'Optional: pay this limit from a Saver'
            : undefined
      }
    >
      {(p) => (
        <select {...p} className={select} value={saverId} onChange={(e) => setSaverId(e.target.value)}>
          <option value="">{limitLike ? 'No Saver' : 'Choose a Saver'}</option>
          {savers.map((s) => (
            <option key={s.id} value={s.id} disabled={s.disabledReason !== null}>
              {s.disabledReason ? `${s.name} (${s.disabledReason})` : s.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  )

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-4 py-4" aria-label={adding ? 'Add bucket' : `${bucket.name} options`}>
      {suggestions.length > 0 && (
        <fieldset>
          <legend className="type-label mb-1.5 text-fg-2">
            {offered?.payCount === 1 ? 'Top spending in your last pay' : `Top spending in your last ${offered?.payCount} pays`}
          </legend>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.categoryId}
                type="button"
                aria-pressed={picked.has(s.categoryId)}
                onClick={() => suggest(s)}
                className="type-label num min-h-11 rounded-full border border-line-2 px-3 text-fg-2 hover:bg-elevated aria-pressed:border-accent/40 aria-pressed:bg-accent-muted aria-pressed:text-accent sm:min-h-8"
              >
                {`${named.get(s.categoryId)?.name} · ${money(s.perPayCents).replace(/\.00$/, '')} a pay`}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {uncategorised > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="type-label num text-warning">
            <span aria-hidden>⚠ </span>
            {`${uncategorised} ${uncategorised === 1 ? 'transaction' : 'transactions'} (${money(offered?.uncategorised.cents ?? 0)}) ${
              uncategorised === 1 ? "isn't" : "aren't"
            } categorised${suggestions.length > 0 ? `, so ${uncategorised === 1 ? "it's" : "they're"} not in these suggestions.` : '.'}`}
          </p>
          <LinkComponent
            to={categoriseHref}
            className="type-label inline-flex min-h-11 shrink-0 items-center rounded-md border border-line-2 bg-elevated px-2 text-fg hover:border-line-3 sm:min-h-7"
          >
            Categorise
          </LinkComponent>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {limitLike && <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>}
        {(limitLike || adding) && saverField}
        {(adding || linked) && (
          <Field
            label={limitLike ? 'Limit' : 'Amount'}
            hint={!limitLike ? 'What you move into the Saver each pay' : 'Spending limit for each pay'}
            error={amount !== '' && amountCents === null ? 'Enter an amount like 25 or 25.50' : null}
          >
            {(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
        )}
      </div>
      {!editable && <p className="text-fg-2">Take it out of your pay, or leave it as it is.</p>}
      {limitLike && (
        <fieldset>
          <legend className="type-label mb-1.5 text-fg-2">Categories</legend>
          <div className="grid max-h-64 gap-x-6 overflow-y-auto sm:grid-cols-2">
            {parents.map((parent) => (
              <div key={parent.id}>
                {categoryBox(parent, false)}
                {categories.filter((c) => c.parentId === parent.id).map((c) => categoryBox(c, true))}
              </div>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onRemove && (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" className="mr-auto">
                Remove
              </Button>
            }
            description={
              isSaver
                ? bucket?.lineKind === 'spending'
                  ? `Take ${bucket.name} out of your pay and remove its limit? What the limit covers counts as Other spending. Nothing changes until you apply.`
                  : `Take ${bucket?.name} out of your pay? Nothing changes until you apply.`
                : `Remove ${bucket?.name}? What it covers counts as Other spending. Nothing changes until you apply.`
            }
            confirmLabel="Remove bucket"
            onConfirm={onRemove}
          />
        )}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {editable && (
          <Button variant="primary" type="submit" disabled={!valid}>
            {adding ? 'Add' : 'Save'}
          </Button>
        )}
      </div>
    </form>
  )
}
