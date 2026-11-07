import type { ReactNode } from 'react'
import { formatMoney } from '../../../shared/money'
import type { BudgetPeriodDto, StandardPayDto } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { standardHeadline, type PayView } from '../../lib/pay-view'
import { Money } from '../Money'
import { Card } from '../ui/Card'
import { shortDate } from './format'

const PACE = {
  'on-pace': { text: 'On pace', tone: 'text-positive' },
  fast: { text: 'Spending fast', tone: 'text-warning' },
  over: { text: 'Over plan', tone: 'text-negative' },
} as const

/** The colours of the pay bar's parts, in the same order as the sections below. */
export const SECTION_COLORS = { spending: 'cat-orange', yours: 'cat-teal', joint: 'cat-blue', shared: 'cat-violet' } as const

function Stat({ label, caption, className, children }: { label: string; caption?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="type-caption text-fg-3">{label}</span>
      {children}
      {caption && <span className="type-caption num text-fg-3">{caption}</span>}
    </div>
  )
}

/** One capsule per part of the pay, sized by its share; the whole is the larger of the pay and the Savers. */
function PayBar({ view, ofLabel }: { view: PayView; ofLabel: string }) {
  const section = (id: 'yours' | 'joint') => view.sections.find((s) => s.id === id)?.totalCents ?? 0
  const parts = [
    { label: 'Stays in Spending', cents: view.payCents - view.saversCents, color: SECTION_COLORS.spending },
    { label: 'Your Savers', cents: section('yours'), color: SECTION_COLORS.yours },
    { label: 'Joint Savers', cents: section('joint'), color: SECTION_COLORS.joint },
  ].filter((p) => p.cents > 0)
  const whole = Math.max(view.payCents, view.saversCents)
  if (!parts.length || whole <= 0) return null
  return (
    <div className="flex gap-1.5">
      {parts.map((p) => {
        const percent = (p.cents / whole) * 100
        const share = percent < 0.5 ? '<1%' : `${Math.round(percent)}%`
        return (
          <div key={p.label} className="min-w-16" style={{ flex: `${percent} 1 0` }}>
            <div
              role="img"
              aria-label={`${p.label}: ${share} ${ofLabel}`}
              title={`${p.label}: ${formatMoney(p.cents)}`}
              className="h-3 rounded-full"
              style={{ background: `var(--${p.color})` }}
            />
            <p className="type-caption mt-2 text-fg-3">
              {p.label} <span className="num text-fg">{share}</span>
            </p>
          </div>
        )
      })}
    </div>
  )
}

export function PaySummary({
  view,
  period,
  payDate,
  standard = null,
}: {
  view: PayView
  period: BudgetPeriodDto
  payDate: string
  /** Set for a Standard pay: usual wording, no pace, and a note on what the figures are. */
  standard?: StandardPayDto | null
}) {
  const pace = view.pace ? PACE[view.pace] : null
  const headline = standard
    ? standardHeadline(view, standard.hasUsual)
    : { label: period.isCurrent ? 'Left to spend' : 'Left over', cents: view.leftToSpendCents }
  return (
    <Card aria-label="Summary" className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:flex lg:[&>*+*]:border-l lg:[&>*+*]:border-line lg:[&>*+*]:pl-6">
        <Stat
          label={headline.label}
          caption={
            <>
              of {formatMoney(view.spendingMoneyCents)}
              {pace && (
                <>
                  {' · '}
                  <span className={pace.tone}>{pace.text}</span>
                </>
              )}
            </>
          }
          className="col-span-2 lg:mr-auto"
        >
          <Money cents={headline.cents} hero className="type-kpi-xl" />
        </Stat>
        {standard ? (
          <Stat label="Usual pay" caption={standard.payIsMedian ? 'Median of recent pays' : 'Expected'}>
            <Money cents={view.payCents} className="type-kpi" />
          </Stat>
        ) : (
          <Stat label="This pay" caption={`${view.payIsExpected ? 'Expected' : 'Paid'} ${shortDate(payDate)}`}>
            <Money cents={view.payCents} className="type-kpi" />
          </Stat>
        )}
        <Stat
          label="To Savers"
          caption={standard ? 'Every pay' : view.saverCount > 0 ? `${view.movedCount} of ${view.saverCount} moved` : undefined}
        >
          <Money cents={view.saversCents} className="type-kpi" />
        </Stat>
        {standard ? (
          standard.hasUsual && (
            <Stat label="Usually spent" caption="Per pay">
              <Money cents={view.spentCents} className="type-kpi" />
            </Stat>
          )
        ) : (
          <Stat
            label="Spent so far"
            caption={period.isCurrent ? `${period.daysElapsed} of ${period.daysTotal} days` : `${period.daysTotal} days`}
          >
            <Money cents={view.spentCents} className="type-kpi" />
          </Stat>
        )}
      </div>
      <PayBar view={view} ofLabel={standard ? 'of a standard pay' : 'of this pay'} />
      {standard && (
        <p className="type-caption text-fg-3">
          {standard.hasUsual
            ? `Uses the median of your last ${standard.payCount} finished pays. A bill that only lands now and then, like yearly car insurance, won't show here unless you set money aside for it in a Saver.`
            : 'Usual spending appears once you have 3 finished pays.'}
        </p>
      )}
      {view.overPayCents > 0 && (
        <p className="type-label text-warning">
          <span aria-hidden>⚠ </span>
          {`Over your pay by ${formatMoney(view.overPayCents)}`}
        </p>
      )}
    </Card>
  )
}
