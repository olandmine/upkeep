import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { ArchivedGoalDto, GoalDto } from '../../../shared/types'
import { keepScope } from '../../lib/scope'
import { money, shortDate } from '../budgets/format'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ArchivedGoals } from './ArchivedGoals'
import { GoalCard } from './GoalCard'
import { goalSections, goalSummary } from './summary'

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export function Figure({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="min-w-[8rem] flex-1">
      <p className="type-label text-fg-2">{label}</p>
      <p className="num type-heading text-fg">{value}</p>
      {detail && <p className="num type-caption text-fg-3">{detail}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `goals-${title.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="type-heading text-fg">
        {title}
      </h2>
      {children}
    </section>
  )
}

/**
 * The Goals page body: summary strip, then the goals grouped by need. `renderForm` supplies the edit
 * form, which replaces the card (or compact row) of the Saver being edited.
 */
export function GoalsList({
  goals,
  archived,
  today,
  editingId,
  renderForm,
  onEdit,
  onRemove,
  onSeen,
  onNewTarget,
  onArchive,
  onDeleteArchived,
}: {
  goals: GoalDto[]
  archived: ArchivedGoalDto[]
  today: string
  editingId: string | null
  renderForm: (g: GoalDto) => ReactNode
  onEdit: (g: GoalDto) => void
  onRemove: (g: GoalDto) => void
  onSeen: (g: GoalDto) => void
  onNewTarget: (g: GoalDto, targetCents: number) => Promise<unknown> | void
  onArchive: (g: GoalDto) => void
  onDeleteArchived: (a: ArchivedGoalDto) => void
}) {
  const s = goalSummary(goals, today)
  const sections = goalSections(goals)
  const attention = [
    s.behind > 0 && `${s.behind} behind`,
    s.datePassed > 0 && `${s.datePassed} date passed`,
    s.buffersLow > 0 && `${plural(s.buffersLow, 'buffer')} low`,
  ].filter(Boolean)

  const grid = (items: GoalDto[]) => (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((g) =>
        editingId === g.accountId ? (
          <Card key={g.accountId}>{renderForm(g)}</Card>
        ) : (
          <GoalCard
            key={g.accountId}
            goal={g}
            onEdit={() => onEdit(g)}
            onRemove={() => onRemove(g)}
            onSeen={() => onSeen(g)}
            onNewTarget={(cents) => onNewTarget(g, cents)}
            onArchive={() => onArchive(g)}
          />
        ),
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      {goals.some((g) => g.goal) && (
        <Card className="flex flex-wrap gap-x-6 gap-y-4 p-4">
          {s.count > 0 && (
            <Figure
              label={`Saved toward ${plural(s.count, 'goal')}`}
              value={`${money(s.savedCents)} of ${money(s.targetCents)}`}
            />
          )}
          <Figure label="Need attention" value={attention.length ? attention.join(' · ') : 'All good'} />
          <Figure label="On track" value={plural(s.onTrack, 'goal')} />
          {s.next && <Figure label="Next deadline" value={`${s.next.name} · ${shortDate(s.next.date)}`} />}
        </Card>
      )}
      {sections.attention.length > 0 && <Section title="Needs attention">{grid(sections.attention)}</Section>}
      {sections.dated.length > 0 && <Section title="With a date">{grid(sections.dated)}</Section>}
      {sections.undated.length > 0 && <Section title="No date">{grid(sections.undated)}</Section>}
      {sections.reached.length > 0 && <Section title="Reached">{grid(sections.reached)}</Section>}
      {sections.withoutGoal.length > 0 && (
        <Section title="Savers without a goal">
          <ul className="flex flex-col gap-2">
            {sections.withoutGoal.map((g) =>
              editingId === g.accountId ? (
                <li key={g.accountId}>
                  <Card>{renderForm(g)}</Card>
                </li>
              ) : (
                <li
                  key={g.accountId}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-raised px-4 py-2"
                >
                  <Link
                    to="/goals/$accountId"
                    params={{ accountId: g.accountId }}
                    search={keepScope}
                    className="min-w-0 flex-1 truncate rounded-sm text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {g.saverName}
                  </Link>
                  <span className="num text-fg-2">{money(g.balanceCents)}</span>
                  {g.canEdit && <Button aria-label={`Set goal for ${g.saverName}`} onClick={() => onEdit(g)}>
                      Set goal
                    </Button>}
                </li>
              ),
            )}
          </ul>
        </Section>
      )}
      <ArchivedGoals archived={archived} onDelete={onDeleteArchived} />
    </div>
  )
}
