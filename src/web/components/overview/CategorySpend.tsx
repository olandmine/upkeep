import type { OverviewDto } from '../../../shared/types'
import { Money } from '../Money'
import { Dot } from '../ui/Badge'
import { AllocationBar } from './AllocationBar'

export function CategorySpend({ overview }: { overview: OverviewDto }) {
  const total = overview.month.spentCents
  return (
    <div className="flex flex-col gap-6">
      <AllocationBar
        label="Spending this month by category group"
        items={overview.spendingByParent.map((p) => ({ key: p.parentId ?? 'none', label: p.name, cents: p.cents, colorToken: p.colorToken }))}
      />
      {overview.topCategories.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {overview.topCategories.map((c) => (
            <li key={c.categoryId ?? 'none'} className="flex items-center gap-3 py-2">
              <Dot token={c.colorToken} />
              <span className="min-w-0 flex-1 truncate text-fg">{c.name}</span>
              <span className="type-caption num w-12 text-right text-fg-3">{total ? `${Math.round((c.cents / total) * 100)}%` : ''}</span>
              <Money cents={c.cents} className="w-28 text-right text-fg" />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
