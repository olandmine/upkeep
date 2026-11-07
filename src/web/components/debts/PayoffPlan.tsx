import { useState } from 'react'
import type { PayoffPlanDto, PayoffStrategy } from '../../../shared/types'
import { money, parseDollars } from '../budgets/format'
import { Card, CardHeader } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { monthLabel } from './format'
import { PayoffChart, SCENARIO_SERIES } from './PayoffChart'

const STRATEGY_TEXT: Record<PayoffStrategy, string> = {
  'as-is': 'Each debt gets only its usual repayment.',
  avalanche:
    'Your extra, plus repayments freed up as debts are paid off, goes to the highest-rate debt first. Usually the least interest.',
  snowball: 'Your extra, plus freed-up repayments, goes to the smallest balance first. Debts disappear sooner.',
}

/** Payoff plan: extra per month, Include HECS, three scenarios, the differences and the chart. */
export function PayoffPlan({
  plan,
  onChange,
}: {
  plan: PayoffPlanDto
  onChange: (settings: { extraCents: number; includeHecs: boolean }) => void
}) {
  const [extra, setExtra] = useState((plan.extraCents / 100).toFixed(2))
  // Follow a saved value from elsewhere (another scope or device) without an effect.
  const [shown, setShown] = useState(plan.extraCents)
  if (shown !== plan.extraCents) {
    setShown(plan.extraCents)
    setExtra((plan.extraCents / 100).toFixed(2))
  }
  const extraCents = parseDollars(extra)
  const empty = (plan.scenarios[0]?.debts.length ?? 0) === 0

  return (
    <Card>
      <CardHeader title="Payoff plan" />
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div className="w-64">
          <Field
            label="Extra per month"
            error={extraCents === null ? 'Enter an amount' : null}
            hint="Added on top of your repayments in Avalanche and Snowball."
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={extra}
                disabled={!plan.canEdit}
                onChange={(e) => setExtra(e.target.value)}
                onBlur={() => {
                  if (extraCents !== null && extraCents !== plan.extraCents) {
                    onChange({ extraCents, includeHecs: plan.includeHecs })
                  }
                }}
              />
            )}
          </Field>
        </div>
        <label className="type-label mt-[22px] flex h-9 items-center gap-2 text-fg-2">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={plan.includeHecs}
            disabled={!plan.canEdit}
            onChange={(e) => onChange({ extraCents: plan.extraCents, includeHecs: e.target.checked })}
          />
          Include HECS
        </label>
      </div>

      {empty ? (
        <p className="text-fg-2">
          Nothing to pay off in this plan.
          {!plan.includeHecs && ' HECS/HELP is left out unless you tick Include HECS.'}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {SCENARIO_SERIES.map(({ strategy, label, color }) => {
            const s = plan.scenarios.find((x) => x.strategy === strategy)
            if (!s) return null
            return (
              <section key={strategy} className="rounded-md border border-line p-4">
                <h3 className="type-label mb-2 flex items-center gap-2 text-fg">
                  <span
                    aria-hidden
                    className="inline-block h-0.5 w-3 rounded-full"
                    style={{ background: color }}
                  />
                  {label}
                </h3>
                <p className="type-caption mb-2 text-fg-3">{STRATEGY_TEXT[strategy]}</p>
                <p className={s.debtFreeMonth ? 'text-fg' : 'text-warning'}>
                  {s.debtFreeMonth ? `Debt-free ${monthLabel(s.debtFreeMonth)}` : 'Never'}
                </p>
                <p className="type-caption num mb-3 text-fg-3">{`Total interest ${money(s.totalInterestCents)}`}</p>
                <ul className="flex flex-col gap-1">
                  {s.debts.map((d) => (
                    <li key={d.id} className="type-caption flex gap-2">
                      <span className="min-w-0 flex-1 truncate text-fg-2">{d.name}</span>
                      <span className="text-fg">{d.payoffMonth ? monthLabel(d.payoffMonth) : 'Never'}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {plan.differences.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1">
          {plan.differences.map((line) => (
            <li key={line} className="text-fg-2">
              {line}
            </li>
          ))}
        </ul>
      )}

      {!empty && (
        <div className="mt-5">
          <PayoffChart scenarios={plan.scenarios} />
        </div>
      )}
    </Card>
  )
}
