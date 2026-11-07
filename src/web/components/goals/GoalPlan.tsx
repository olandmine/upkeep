import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { GoalDto } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { money } from '../budgets/format'
import { canTryAmount, perOf, planComparison, planLine, SLIDER_STEP_CENTS, sliderRange, tryResult } from './plan'

const LINK_CLASS =
  'type-caption rounded-sm text-accent underline underline-offset-2 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

const roundToStep = (n: number) => Math.round(n / SLIDER_STEP_CENTS) * SLIDER_STEP_CENTS

function TryAmount({ goal: g }: { goal: GoalDto }) {
  const { maxCents, startCents } = sliderRange(g)
  const [picked, setCents] = useState(startCents)
  // A refetch can lower the top (a repayment); never show more than the slider now reaches.
  const cents = Math.min(picked, maxCents)
  const label = `${money(cents)} ${perOf(g)}`
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-3">
        <input
          type="range"
          aria-label={`${g.goal?.name ?? g.saverName}: try an amount`}
          aria-valuetext={label}
          min={0}
          max={maxCents}
          step={SLIDER_STEP_CENTS}
          value={Math.min(roundToStep(cents), maxCents)}
          onChange={(e) => setCents(Number(e.target.value))}
          className="block h-6 min-w-0 flex-1 cursor-pointer"
        />
        <span className="num type-label shrink-0 text-fg">{label}</span>
      </div>
      <p aria-live="polite" className="type-caption text-fg-2">
        {tryResult(g, cents)}
      </p>
    </div>
  )
}

/** The plan's amounts, how they measure up, and a what-if slider that never saves. */
export function GoalPlan({ goal: g, alwaysOpen = false }: { goal: GoalDto; alwaysOpen?: boolean }) {
  const [open, setOpen] = useState(false)
  const line = planLine(g)
  const cmp = planComparison(g)
  const showLink = g.canEdit && g.status !== 'reached'
  const canTry = canTryAmount(g)
  if (!line && !showLink && !canTry) return null
  return (
    <div className="mt-2">
      {line && (
        <p className="type-caption text-fg-3">
          {line}
          {cmp && (
            <>
              {' · '}
              <span className={cn(cmp.warning && 'text-warning')}>{cmp.text}</span>
            </>
          )}
        </p>
      )}
      {g.plan?.partial && <p className="type-caption text-fg-3">Includes only your plan</p>}
      {(showLink || (canTry && !alwaysOpen)) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          {showLink && (
            <Link to="/budgets" search={{ view: 'standard' }} className={LINK_CLASS}>
              {g.plan && g.plan.mineCents > 0 ? 'Change in Budgets' : 'Add it to your plan'}
            </Link>
          )}
          {canTry && !alwaysOpen && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className={cn(LINK_CLASS, 'cursor-pointer')}
            >
              Try an amount
            </button>
          )}
        </div>
      )}
      {canTry && (alwaysOpen || open) && <TryAmount goal={g} />}
    </div>
  )
}
