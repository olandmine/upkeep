import { useState } from 'react'
import { formatMoney } from '../../../shared/money'
import type {
  AccountDto,
  BudgetDto,
  CategoryDto,
  LineInputDto,
  PayCandidateDto,
  PlanItemInput,
  PlanProposalDto,
  UserDto,
} from '../../../shared/types'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Input } from '../ui/Input'
import { money, parseDollars } from './format'

export interface PlanProposal {
  expectedIncomeCents: number
  items: (PlanProposalDto['items'][number] & { targetName: string })[]
}

interface Props {
  budget: BudgetDto
  users: UserDto[]
  candidates: PayCandidateDto[]
  /** Savers this budget's lines may link. */
  savers: AccountDto[]
  categories: CategoryDto[]
  proposal: PlanProposal | null
  onMarkPay: (transactionId: string) => Promise<{ count: number; since: string | null }>
  onSetAnchor: (userId: string) => Promise<void>
  onCreateLines: (lines: LineInputDto[]) => Promise<void>
  onSavePlan: (plan: { expectedIncomeCents: number; items: PlanItemInput[] }) => Promise<void>
  onDone: () => void
}

interface DraftLine {
  key: string
  saverId: string | null
  name: string
  kind: 'spending' | 'fund'
  amount: string
  categoryId: string
  skipped: boolean
}

const monthYear = (date: string) => {
  const [y, m] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
const select = 'type-body h-9 rounded-sm border border-line-2 bg-elevated px-2 text-fg'

/** Whose paydays the Joint budget follows. Also shown in Joint's edit mode. */
export function AnchorPicker({
  users,
  anchorUserId,
  onChange,
}: {
  users: UserDto[]
  anchorUserId: string | null
  onChange: (userId: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="type-label text-fg-2">Joint budgets follow</span>
      <select aria-label="Joint budgets follow" className={select} value={anchorUserId ?? ''} onChange={(e) => onChange(e.target.value)}>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Mark your pay → create buckets → build your plan. Joint swaps step 1 for the anchor. */
export function SetupWizard(props: Props) {
  const { budget, users, candidates, savers, categories, proposal } = props
  const joint = budget.kind === 'joint'
  // 4: Joint buckets are done but the anchor's pay isn't marked yet, so there are no periods to show.
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [found, setFound] = useState<{ count: number; since: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  // Only rows that have been changed, and new buckets: Savers can still be loading when the wizard opens.
  const [changed, setChanged] = useState<DraftLine[]>([])
  const drafts: DraftLine[] = [
    ...savers.map(
      (s): DraftLine =>
        changed.find((d) => d.key === s.id) ?? { key: s.id, saverId: s.id, name: s.displayName, kind: 'fund', amount: '', categoryId: '', skipped: false },
    ),
    ...changed.filter((d) => !d.saverId),
  ]

  if (budget.setup === 'partner-not-connected') {
    const anchor = users.find((u) => u.id === budget.anchorUserId)?.displayName
    const who = joint ? (anchor ?? 'Your partner') : budget.name === 'Mine' ? 'You' : budget.name
    return (
      <Card>
        <div className="flex flex-col gap-4">
          <p className="text-fg-2">{`${who} ${who === 'You' ? "haven't" : "hasn't"} connected Up yet`}</p>
          {joint && (
            <AnchorPicker users={users} anchorUserId={budget.anchorUserId} onChange={(id) => void props.onSetAnchor(id)} />
          )}
        </div>
      </Card>
    )
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const set = (key: string, patch: Partial<DraftLine>) => {
    const next = { ...drafts.find((d) => d.key === key)!, ...patch }
    setChanged((prev) => (prev.some((d) => d.key === key) ? prev.map((d) => (d.key === key ? next : d)) : [...prev, next]))
  }
  const parents = categories.filter((c) => c.parentId === null)
  const label = (d: DraftLine) => d.name || 'new bucket'
  const ready = drafts.filter((d) => !d.skipped && d.name.trim() && parseDollars(d.amount) !== null)

  if (step === 1) {
    const anchorName = users.find((u) => u.id === budget.anchorUserId)?.displayName ?? 'the owner'
    return (
      <Card>
        <CardHeader title={joint ? 'Joint budget' : 'Mark your pay'} />
        {joint ? (
          <div className="flex flex-col gap-4">
            <p className="text-fg">{`Joint budgets follow ${anchorName}'s paydays`}</p>
            <AnchorPicker
              users={users}
              anchorUserId={budget.anchorUserId}
              onChange={(id) => void run(() => props.onSetAnchor(id))}
            />
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </div>
        ) : found ? (
          <div className="flex flex-col gap-4">
            <p className="text-fg">
              {found.since
                ? `Found ${found.count} paydays since ${monthYear(found.since)}`
                : `Found ${found.count} paydays`}
            </p>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="type-caption mb-2 text-fg-3">Pick a recent pay deposit. Upkeep finds the rest of your paydays from it.</p>
            {candidates.length === 0 && <p className="text-fg-2">No deposits in the last 60 days.</p>}
            {candidates.map(({ transaction: t, sameDescriptionCount }) => (
              <button
                key={t.id}
                type="button"
                disabled={busy}
                aria-label={`This is my pay: ${t.description}, ${formatMoney(t.amountCents)}`}
                onClick={() =>
                  void run(async () => {
                    setFound(await props.onMarkPay(t.id))
                  })
                }
                className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-left transition-colors hover:bg-elevated"
              >
                <span className="min-w-0 flex-1 truncate text-fg">{t.description}</span>
                <span className="type-caption text-fg-3">{sameDescriptionCount > 1 ? `${sameDescriptionCount}× in 60 days` : 'once'}</span>
                <span className="num text-fg">{money(t.amountCents)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
    )
  }

  if (step === 2) {
    const finish = () => {
      if (!joint) return setStep(3)
      setStep(4)
      props.onDone()
    }
    // Other Savers Up moved money into, such as joint ones, have no row here. The plan step offers them.
    const fromSplit = (proposal?.items ?? []).filter((i) => savers.some((s) => s.id === i.saverId))
    return (
      <Card>
        <CardHeader title="Create buckets" />
        <div className="flex flex-col gap-3">
          {proposal && fromSplit.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="type-caption text-fg-3">
                {`Up moved money into ${fromSplit.length} of your Savers after your last pay of ${money(proposal.expectedIncomeCents)}.`}
              </p>
              <Button onClick={() => fromSplit.forEach((i) => set(i.saverId, { amount: (i.amountCents / 100).toFixed(2), skipped: false }))}>
                Start from pay split
              </Button>
            </div>
          )}
          {drafts
            .filter((d) => !d.skipped)
            .map((d) => (
              <div key={d.key} className="flex flex-wrap items-center gap-2">
                {d.saverId ? (
                  <span className="min-w-28 text-fg">{d.name}</span>
                ) : (
                  <Input
                    aria-label="Name for new bucket"
                    className="w-40"
                    value={d.name}
                    onChange={(e) => set(d.key, { name: e.target.value })}
                  />
                )}
                {d.saverId && (
                  <select
                    aria-label={`Kind for ${d.name}`}
                    className={select}
                    value={d.kind}
                    onChange={(e) => set(d.key, { kind: e.target.value as DraftLine['kind'] })}
                  >
                    <option value="fund">Saving</option>
                    <option value="spending">Spending</option>
                  </select>
                )}
                <Input
                  aria-label={`Amount for ${label(d)}`}
                  inputMode="decimal"
                  placeholder="Amount"
                  className="w-28"
                  value={d.amount}
                  onChange={(e) => set(d.key, { amount: e.target.value })}
                />
                {d.kind === 'spending' && (
                  <select
                    aria-label={`Category for ${label(d)}`}
                    className={select}
                    value={d.categoryId}
                    onChange={(e) => set(d.key, { categoryId: e.target.value })}
                  >
                    <option value="">Category…</option>
                    {parents.map((p) => (
                      <optgroup key={p.id} label={p.name}>
                        <option value={p.id}>{`All of ${p.name}`}</option>
                        {categories
                          .filter((c) => c.parentId === p.id)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                )}
                <Button variant="ghost" onClick={() => set(d.key, { skipped: true })}>
                  {`Skip ${label(d)}`}
                </Button>
              </div>
            ))}
          {ready.length === 0 && <p className="type-caption text-fg-3">A bucket needs a name and an amount before it can be created.</p>}
          <div className="flex flex-wrap justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                setChanged((prev) => [
                  ...prev,
                  { key: `new-${prev.length}`, saverId: null, name: '', kind: 'spending', amount: '', categoryId: '', skipped: false },
                ])
              }
            >
              Add a spending bucket
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={finish}>
                Skip this step
              </Button>
              <Button
                variant="primary"
                disabled={busy || ready.length === 0}
                onClick={() =>
                  void run(async () => {
                    await props.onCreateLines(
                      ready.map((d) => ({
                        kind: d.kind,
                        name: d.name.trim(),
                        amountCents: parseDollars(d.amount)!,
                        categoryIds: d.kind === 'spending' && d.categoryId ? [d.categoryId] : [],
                        saverAccountId: d.saverId,
                      })),
                    )
                    finish()
                  })
                }
              >
                Create buckets
              </Button>
            </div>
          </div>
        </div>
      </Card>
    )
  }

  if (step === 4) {
    const anchorName = users.find((u) => u.id === budget.anchorUserId)?.displayName ?? 'the anchor'
    return (
      <Card>
        <CardHeader title="Joint budget" />
        <p className="text-fg-2">{`Joint periods start once ${anchorName}'s pay is marked on their budget tab.`}</p>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title="Build your plan" />
      {proposal && proposal.items.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="type-caption text-fg-3">
            {`From what Up moved after your last pay of ${money(proposal.expectedIncomeCents)}. You can change it any time.`}
          </p>
          <ul className="flex flex-col divide-y divide-line">
            {proposal.items.map((item, i) => (
              <li key={i} className="flex items-center justify-between py-2">
                <span className="text-fg">{item.targetName}</span>
                <span className="num text-fg">{money(item.amountCents)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={props.onDone}>
              Skip
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await props.onSavePlan({
                    expectedIncomeCents: proposal.expectedIncomeCents,
                    items: proposal.items.map(({ targetKind, lineId, saverAccountId, amountCents }) => ({
                      targetKind,
                      lineId,
                      saverAccountId,
                      amountCents,
                    })),
                  })
                  props.onDone()
                })
              }
            >
              Save as my plan
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-fg-2">No Saver transfers found after your last pay. You can add Savers to your pay any time with Edit.</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={props.onDone}>
              Finish
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
