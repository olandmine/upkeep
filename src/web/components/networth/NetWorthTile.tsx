import type { NetWorthDto, Scope } from '../../../shared/types'
import { PlainLink, type LinkLike } from '../AppLink'
import { Money } from '../Money'
import { Card } from '../ui/Card'

/** Overview: today's net worth and its 6-month change, linking to the Net worth page. */
export function NetWorthTile({
  data,
  scope,
  LinkComponent = PlainLink,
}: {
  data: NetWorthDto
  scope: Scope
  LinkComponent?: LinkLike
}) {
  const to = scope === 'everyone' ? '/net-worth' : `/net-worth?scope=${scope}`
  return (
    <Card className="p-0">
      <LinkComponent
        to={to}
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg p-6 hover:bg-elevated"
      >
        <span className="type-label text-fg-2">Net worth</span>
        <Money cents={data.todayCents} className="type-kpi num text-fg" />
        {data.points.length > 1 && (
          <span className="type-caption flex gap-1 text-fg-3">
            <Money cents={data.changeCents} signed />
            <span>in 6 months</span>
          </span>
        )}
        <span className="type-label ml-auto text-fg-2">View net worth ›</span>
      </LinkComponent>
    </Card>
  )
}
