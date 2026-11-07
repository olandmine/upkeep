import { Search } from 'lucide-react'
import { useEffect, useState, type ReactNode, type SelectHTMLAttributes } from 'react'
import { UNCATEGORISED } from '../../../shared/categories'
import type { AccountDto, CategoryDto } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

/** Transactions filters as they live in the URL: dates are local YYYY-MM-DD, amounts are dollars. */
export interface TransactionSearch {
  q?: string
  accountId?: string
  categoryId?: string
  /** Comma-separated: a budget line's categories. */
  categoryIds?: string
  tag?: string
  status?: 'HELD' | 'SETTLED'
  from?: string
  to?: string
  min?: number
  max?: number
  transfers?: 'hide'
}

const control =
  'type-label h-8 rounded-full border border-line-2 bg-transparent px-3 text-fg-2 hover:bg-elevated aria-[current=true]:border-accent/40 aria-[current=true]:bg-accent-muted aria-[current=true]:text-accent'

function Select({ label, active, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; active: boolean; children: ReactNode }) {
  return (
    <select aria-label={label} aria-current={active || undefined} className={control} {...props}>
      {children}
    </select>
  )
}

export function FilterBar({
  value,
  onChange,
  accounts,
  categories,
  tags,
}: {
  value: TransactionSearch
  onChange: (next: TransactionSearch) => void
  accounts: AccountDto[]
  categories: CategoryDto[]
  tags: string[]
}) {
  const [q, setQ] = useState(value.q ?? '')
  const [urlQ, setUrlQ] = useState(value.q)
  if (urlQ !== value.q) {
    // The URL changed underneath us (e.g. "Clear filters"): follow it.
    setUrlQ(value.q)
    setQ(value.q ?? '')
  }
  useEffect(() => {
    const id = setTimeout(() => {
      if ((value.q ?? '') !== q) onChange({ ...value, q: q || undefined })
    }, 250)
    return () => clearTimeout(id)
  }, [q, value, onChange])

  const set = <K extends keyof TransactionSearch>(key: K, v: TransactionSearch[K] | '') =>
    onChange({ ...value, [key]: v === '' ? undefined : v })
  const parents = categories.filter((c) => c.parentId === null)
  const active = Object.values(value).some((v) => v !== undefined)

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search aria-hidden size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3" />
        <Input aria-label="Search transactions" placeholder="Search payee, message or raw text" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select label="Account" active={!!value.accountId} value={value.accountId ?? ''} onChange={(e) => set('accountId', e.target.value)}>
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </Select>
        <Select label="Category" active={!!value.categoryId} value={value.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}>
          <option value="">All categories</option>
          <option value={UNCATEGORISED}>Uncategorised spending</option>
          {parents.map((p) => (
            <optgroup key={p.id} label={p.name}>
              <option value={p.id}>All {p.name}</option>
              {categories
                .filter((c) => c.parentId === p.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
        {tags.length > 0 && (
          <Select label="Tag" active={!!value.tag} value={value.tag ?? ''} onChange={(e) => set('tag', e.target.value)}>
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        )}
        <Select label="Status" active={!!value.status} value={value.status ?? ''} onChange={(e) => set('status', e.target.value as TransactionSearch['status'] | '')}>
          <option value="">Any status</option>
          <option value="HELD">Pending</option>
          <option value="SETTLED">Settled</option>
        </Select>
        <label className={cn(control, 'flex items-center gap-1.5')} aria-current={!!value.from || undefined}>
          <span>From</span>
          <input type="date" aria-label="From date" className="bg-transparent text-fg outline-none" value={value.from ?? ''} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className={cn(control, 'flex items-center gap-1.5')} aria-current={!!value.to || undefined}>
          <span>To</span>
          <input type="date" aria-label="To date" className="bg-transparent text-fg outline-none" value={value.to ?? ''} onChange={(e) => set('to', e.target.value)} />
        </label>
        <label className={cn(control, 'flex items-center gap-1')} aria-current={value.min !== undefined || value.max !== undefined || undefined}>
          <span>$</span>
          <input type="number" min={0} step="0.01" inputMode="decimal" aria-label="Minimum amount" placeholder="min" className="num w-16 bg-transparent text-fg outline-none" value={value.min ?? ''} onChange={(e) => set('min', e.target.value === '' ? '' : Number(e.target.value))} />
          <span>–</span>
          <input type="number" min={0} step="0.01" inputMode="decimal" aria-label="Maximum amount" placeholder="max" className="num w-16 bg-transparent text-fg outline-none" value={value.max ?? ''} onChange={(e) => set('max', e.target.value === '' ? '' : Number(e.target.value))} />
        </label>
        <label className={cn(control, 'flex cursor-pointer items-center gap-2')} aria-current={value.transfers === 'hide' || undefined}>
          <input type="checkbox" className="accent-[var(--accent)]" checked={value.transfers === 'hide'} onChange={(e) => set('transfers', e.target.checked ? 'hide' : '')} />
          Hide transfers
        </label>
        {active && (
          <Button variant="ghost" className="h-8" onClick={() => onChange({})}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  )
}

const localMidnightIso = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

/** URL search → API filters: local dates become UTC instants, `to` is inclusive of that whole day. */
export function toTxFilters(s: TransactionSearch) {
  const nextDay = (date: string) => {
    const [y, m, d] = date.split('-').map(Number)
    return new Date(y, m - 1, d + 1).toISOString()
  }
  return {
    q: s.q,
    accountId: s.accountId,
    categoryId: s.categoryId,
    categoryIds: s.categoryIds ? s.categoryIds.split(',') : undefined,
    tag: s.tag,
    status: s.status,
    from: s.from ? localMidnightIso(s.from) : undefined,
    to: s.to ? nextDay(s.to) : undefined,
    minCents: s.min !== undefined ? Math.round(s.min * 100) : undefined,
    maxCents: s.max !== undefined ? Math.round(s.max * 100) : undefined,
    includeTransfers: s.transfers === 'hide' ? false : undefined,
  }
}
