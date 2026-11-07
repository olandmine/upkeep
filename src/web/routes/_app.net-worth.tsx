import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { NetWorthRange } from '../../shared/types'
import { NetWorthChart, NetWorthHeadline } from '../components/networth/NetWorthChart'
import { Page } from '../components/shell/PageHeader'
import { PrivateNotice } from '../components/sharing/PrivateNotice'
import { Card } from '../components/ui/Card'
import { cn } from '../lib/cn'
import { netWorthQuery } from '../lib/queries'
import { useScope } from '../lib/scope'
import { usePartnerHides } from '../lib/sharing'

const RANGES: { value: NetWorthRange; label: string }[] = [
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
]

export const Route = createFileRoute('/_app/net-worth')({
  validateSearch: (s: Record<string, unknown>): { range?: NetWorthRange } => ({
    range: RANGES.some((r) => r.value === s.range) ? (s.range as NetWorthRange) : undefined,
  }),
  component: NetWorthPage,
})

function NetWorthPage() {
  const [scope] = useScope()
  const { range = '6m' } = Route.useSearch()
  const navigate = useNavigate()
  const { data, isError } = useQuery(netWorthQuery(scope, range))
  // Partner scope is only their data, so with no balances shared there's nothing to chart but zeros.
  const hidesBalances = usePartnerHides('balances', scope)
  const replaced = scope === 'partner' && hidesBalances

  return (
    <Page title="Net worth">
      <PrivateNotice needs="finances" scope={scope} />
      {isError && !replaced && <p className="text-negative">Couldn&apos;t load net worth.</p>}
      {data && !replaced && (
        <Card className="flex flex-col gap-6">
          <div className="flex flex-wrap items-start gap-4">
            <NetWorthHeadline data={data} />
            <div role="group" aria-label="Range" className="ml-auto flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={r.value === range}
                  onClick={() =>
                    void navigate({
                      to: '.',
                      search: ((prev: Record<string, unknown>) => ({
                        ...prev,
                        range: r.value === '6m' ? undefined : r.value,
                      })) as never,
                      replace: true,
                    })
                  }
                  className={cn(
                    'type-label h-7 rounded-full border px-3 transition-colors duration-150',
                    r.value === range
                      ? 'border-accent/40 bg-accent-muted text-accent'
                      : 'border-line-2 text-fg-2 hover:bg-elevated hover:text-fg',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <NetWorthChart points={data.points} />
        </Card>
      )}
    </Page>
  )
}
