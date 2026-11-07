import type { PayFlowNodeDto, PayPlanDto, PlanItemDto, Scope } from '../../shared/types'
import { payNode, sideOf } from './actual-accounts'
import { GraphBuilder } from './graph'
import type { FlowAccount, FlowGraph, FlowInput, FlowLine, FlowPay } from './types'

const SLATE = 'cat-slate'
const POSITIVE = 'positive'

export interface PlannedInput {
  scope: Scope
  scopeLabel: FlowInput['scopeLabel']
  users: FlowInput['users']
  accounts: FlowAccount[]
  /** A target outside these is drawn as an outside-scope box. */
  scopeAccountIds: string[]
  lines: FlowLine[]
  pays: { pay: FlowPay; plan: PayPlanDto; landsIn: string }[]
}

const sink = (id: string, label: string): PayFlowNodeDto => ({
  id,
  kind: 'sink',
  label,
  caption: null,
  amountCents: 0,
  colorToken: SLATE,
  href: null,
})

/** The account an item ends up in, if it has one: a Saver's own, or the one behind a budget line. */
const saverOf = (it: PlanItemDto): string | null =>
  it.targetKind === 'saver' ? it.saverAccountId : it.targetKind === 'line' ? it.resolvedSaverId : null

/** Planned · Budget: each pay's plan, box by box. */
export function plannedBudgetFlow(input: PlannedInput): FlowGraph {
  return build(input, false)
}

/** Planned · Accounts: the same plan as moves between accounts. */
export function plannedAccountsFlow(input: PlannedInput): FlowGraph {
  return build(input, true)
}

function build(input: PlannedInput, byAccount: boolean): FlowGraph {
  const g = new GraphBuilder()
  const joint = input.scope === 'joint'
  const accountById = new Map<string, FlowAccount>(input.accounts.map((a) => [a.id, a]))
  const inScope = new Set(input.scopeAccountIds)
  const lineById = new Map<string, FlowLine>(input.lines.map((l) => [l.id, l]))
  const nameOf = (userId: string) => input.users.find((u) => u.id === userId)?.name ?? 'Someone'
  const jointAccount = input.accounts.find((a) => a.ownership === 'JOINT' && a.type === 'TRANSACTIONAL')

  const lineNode = (it: PlanItemDto): PayFlowNodeDto => {
    const l = it.lineId ? lineById.get(it.lineId) : undefined
    return {
      id: `line:${it.lineId}`,
      kind: 'line',
      label: l?.name ?? it.targetName,
      caption: null,
      amountCents: 0,
      colorToken: l?.colorToken ?? SLATE,
      href: '/budgets',
    }
  }
  const saverNode = (id: string, fallbackName: string): PayFlowNodeDto => {
    const a = accountById.get(id)
    return {
      id: `saver:${id}`,
      kind: 'saver',
      label: a?.name ?? fallbackName,
      caption: null,
      amountCents: 0,
      colorToken: a?.colorToken ?? SLATE,
      href: `/accounts/${id}`,
    }
  }
  const accountNode = (id: string, fallbackName: string): PayFlowNodeDto => {
    const a = accountById.get(id)
    const outside = !inScope.has(id)
    return {
      id: `account:${id}`,
      kind: outside ? 'outside-account' : 'account',
      label: a?.name ?? fallbackName,
      caption: outside ? `Outside ${input.scopeLabel}` : null,
      amountCents: 0,
      colorToken: a?.colorToken ?? SLATE,
      href: `/accounts/${id}`,
    }
  }

  /** The Joint scope keeps only what goes to a Joint budget line or a Joint Saver. */
  const kept = (it: PlanItemDto): boolean => {
    if (!joint) return true
    if (it.targetKind === 'buffer') return false
    if (it.targetKind === 'line' && it.lineId && lineById.has(it.lineId)) return true
    const saver = saverOf(it)
    return saver !== null && accountById.get(saver)?.ownership === 'JOINT'
  }

  const payNodes = new Map<string, PayFlowNodeDto>()
  let overAllocated = 0

  for (const { pay, plan, landsIn } of input.pays) {
    const items = plan.items.filter(kept)
    const allocated = items.reduce((s, i) => s + i.amountCents, 0)
    // In the Joint scope the money comes from each person; everywhere else from their pay.
    const from = joint ? `from:${pay.userId}` : `pay:${pay.userId}`
    const first = payNodes.get(from)
    if (first) first.amountCents += plan.incomeCents
    else if (joint) {
      payNodes.set(from, {
        id: from,
        kind: 'source',
        label: `From ${nameOf(pay.userId)}`,
        caption: null,
        amountCents: 0,
        colorToken: POSITIVE,
        href: null,
      })
    } else {
      payNodes.set(from, { ...payNode(pay, input.scopeLabel), amountCents: plan.incomeCents })
    }
    if (!joint) overAllocated += Math.max(0, allocated - plan.incomeCents)

    // The account the plan is drawn from; the Joint scope starts at the Joint account.
    const home = joint ? (jointAccount?.id ?? landsIn) : landsIn
    const origin = byAccount ? `account:${home}` : from
    // Where an item goes in Planned · Accounts: another account, or null to stay in `home`.
    const destOf = (it: PlanItemDto): string | null => {
      let dest = saverOf(it)
      if (dest === null && it.targetKind === 'line' && !joint) {
        const l = it.lineId ? lineById.get(it.lineId) : undefined
        // A Joint budget line with no Saver is paid into the Joint account itself.
        if (l?.joint === true && jointAccount) dest = jointAccount.id
      }
      return dest !== null && dest !== home ? dest : null
    }
    // Outside the Joint scope, what goes to other accounts leaves straight from the pay, as a pay split does.
    const direct = byAccount && !joint
    if (byAccount) {
      g.node(accountNode(home, 'Account'))
      const splitOff = direct
        ? items.filter((it) => it.targetKind !== 'buffer' && destOf(it) !== null).reduce((s, i) => s + i.amountCents, 0)
        : 0
      g.edge(from, origin, joint ? allocated : plan.incomeCents - splitOff)
    }

    for (const it of items) {
      if (it.targetKind === 'buffer') {
        g.node(sink('buffer', 'Leave in Spending'))
        g.edge(origin, 'buffer', it.amountCents)
        continue
      }
      if (!byAccount) {
        if (it.targetKind === 'line') {
          g.node(lineNode(it))
          g.edge(origin, `line:${it.lineId}`, it.amountCents)
        } else if (it.saverAccountId) {
          g.node(saverNode(it.saverAccountId, it.targetName))
          g.edge(origin, `saver:${it.saverAccountId}`, it.amountCents)
        }
        continue
      }
      const dest = destOf(it)
      if (dest !== null) {
        g.node(accountNode(dest, it.targetName))
        g.edge(direct ? from : origin, `account:${dest}`, it.amountCents)
      } else {
        g.node(sink(`kept:${home}`, 'Kept for lines'))
        g.edge(origin, `kept:${home}`, it.amountCents)
      }
    }

    if (!joint && plan.incomeCents > allocated) {
      g.node(sink('unallocated', 'Not allocated yet'))
      g.edge(origin, 'unallocated', plan.incomeCents - allocated)
    }
  }

  for (const n of payNodes.values()) {
    if (joint) n.amountCents = g.outCents(n.id)
    g.node(n)
  }
  const built = g.build()
  // Box amounts are what flows into them (what flows out of a source).
  for (const n of built.nodes) {
    if (n.kind !== 'pay' && n.kind !== 'source') n.amountCents = g.inCents(n.id)
    const side = byAccount ? sideOf(n, accountById) : undefined
    if (side) n.side = side
  }
  const baseCents = joint
    ? [...payNodes.values()].reduce((s, n) => s + n.amountCents, 0)
    : input.pays.reduce((s, p) => s + p.plan.incomeCents, 0)
  return {
    ...built,
    baseCents,
    baseLabel: joint ? 'money in' : 'pay',
    overAllocatedCents: overAllocated > 0 ? overAllocated : null,
  }
}
