import { formatMoney } from '../../shared/money'
import type { PayFlowNodeDto } from '../../shared/types'
import { GraphBuilder } from './graph'
import type { FlowAccount, FlowGraph, FlowInput, FlowPay, FlowTx } from './types'

const SLATE = 'cat-slate'
const POSITIVE = 'positive'
// Up's pay splitting moves the money within seconds of the pay landing.
const SPLIT_WINDOW_MS = 10 * 60_000

/** 'YYYY-MM-DD' → "15 Jan" without timezone drift. */
function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function payNode(pay: FlowPay, scopeLabel: FlowInput['scopeLabel']): PayFlowNodeDto {
  const named = scopeLabel === 'Everyone' || scopeLabel === 'Joint'
  return {
    id: `pay:${pay.userId}`,
    kind: 'pay',
    label: named ? `${pay.userName}'s pay` : 'Pay',
    caption: `${pay.description ?? 'Expected'} · ${shortDate(pay.date)}`,
    amountCents: pay.amountCents,
    colorToken: POSITIVE,
    href: null,
  }
}

/** One box per person: someone paid more than once in the cycle gets "2 pays · 15 Jan, 29 Jan". */
export function payNodes(pays: FlowPay[], scopeLabel: FlowInput['scopeLabel']): PayFlowNodeDto[] {
  const byUser = new Map<string, FlowPay[]>()
  for (const p of pays) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p])
  return [...byUser.values()].map((own) => {
    const n = payNode(own[0], scopeLabel)
    if (own.length === 1) return n
    return {
      ...n,
      caption: `${own.length} pays · ${own.map((p) => shortDate(p.date)).join(', ')}`,
      amountCents: own.reduce((s, p) => s + p.amountCents, 0),
    }
  })
}

/** What an account keeps: its money in and interest, minus its money out and spending, never below zero. */
export function keptCents(graph: Pick<FlowGraph, 'edges' | 'nodes'>, nodeId: string): number {
  const n = graph.nodes.find((x) => x.id === nodeId)
  let net = (n?.interestCents ?? 0) - (n?.spentCents ?? 0)
  for (const e of graph.edges) {
    if (e.to === nodeId) net += e.amountCents
    if (e.from === nodeId) net -= e.amountCents
  }
  return Math.max(0, net)
}

/**
 * Where a box goes in an Accounts view: money in on the left; Spending accounts and money
 * out on the right; everything else between.
 */
export function sideOf(n: PayFlowNodeDto, byId: Map<string, FlowAccount>): PayFlowNodeDto['side'] {
  if (n.kind === 'pay' || n.kind === 'source' || n.id.startsWith('unsynced-in')) return 'in'
  if (n.kind === 'sink' || n.id.startsWith('unsynced-out')) return 'out'
  if (n.id.startsWith('account:') && byId.get(n.id.slice('account:'.length))?.type === 'TRANSACTIONAL') return 'out'
  return undefined
}

/** "$sam" from "Transfer from $sam", "Forward to $sam" and the like; null when Up gives no name. */
function counterparty(description: string | null): string | null {
  return /\b(?:from|to)\s+(\S.*)$/i.exec(description ?? '')?.[1].trim() ?? null
}

/** Actual · Accounts: how the money moved between accounts in the cycle. */
export function actualAccountsFlow(input: FlowInput): FlowGraph {
  const g = new GraphBuilder()
  const byId = new Map<string, FlowAccount>(input.accounts.map((a) => [a.id, a]))
  const inScope = new Set(input.scopeAccountIds)
  const acc = (id: string) => `account:${id}`
  // An edge needs at least one end in scope; `account:<id>` ends are in scope when the account is.
  const link = (from: string, to: string, cents: number, fromId: string | null, toId: string | null) => {
    if (!(fromId !== null && inScope.has(fromId)) && !(toId !== null && inScope.has(toId))) return
    g.edge(from, to, cents)
  }
  const touched = new Set<string>()
  const spent = new Map<string, number>()
  const interest = new Map<string, number>()
  // Accounts that aren't synced: one box per person Up names (or one "Not synced"), each way.
  const outsiders = new Map<string, { way: 'in' | 'out'; name: string | null }>()
  const outsider = (way: 'in' | 'out', t: FlowTx) => {
    const name = counterparty(t.description)
    const id = name ? `unsynced-${way}:${name}` : `unsynced-${way}`
    outsiders.set(id, { way, name })
    return id
  }

  const synced = (id: string | null): id is string => id !== null && byId.has(id)
  const txById = new Map(input.txs.map((t) => [t.id, t]))

  // Pay splits: Up's automatic transfers out of the pay's account just after it
  // lands are drawn straight from the pay, not through the account.
  const splits = new Map<string, FlowPay>()
  for (const p of input.pays) {
    const landed = p.txIds.map((id) => txById.get(id)?.createdAt).filter((at) => at !== undefined)
    if (!p.accountId || landed.length === 0) continue
    const from = Math.min(...landed.map((at) => Date.parse(at)))
    for (const t of input.txs) {
      const after = Date.parse(t.createdAt) - from
      if (
        t.accountId === p.accountId &&
        t.amountCents < 0 &&
        t.automatic &&
        synced(t.transferAccountId) &&
        t.transferAccountId !== p.accountId &&
        after >= 0 &&
        after <= SPLIT_WINDOW_MS
      ) {
        splits.set(t.id, p)
      }
    }
  }

  for (const n of payNodes(input.pays, input.scopeLabel)) g.node(n)
  for (const p of input.pays) {
    if (p.accountId && byId.has(p.accountId)) {
      const splitOff = [...splits].filter(([, q]) => q === p).reduce((s, [id]) => s - txById.get(id)!.amountCents, 0)
      link(`pay:${p.userId}`, acc(p.accountId), p.amountCents - splitOff, null, p.accountId)
      touched.add(p.accountId)
    }
  }
  const payTxIds = new Set(input.pays.flatMap((p) => p.txIds))

  for (const t of input.txs) {
    if (payTxIds.has(t.id) || t.amountCents === 0) continue
    const cents = Math.abs(t.amountCents)
    const split = splits.get(t.id)
    if (split && synced(t.transferAccountId)) {
      link(`pay:${split.userId}`, acc(t.transferAccountId), cents, t.accountId, t.transferAccountId)
      touched.add(t.transferAccountId)
      continue
    }
    if (t.amountCents < 0) {
      if (!byId.has(t.accountId)) continue
      if (synced(t.transferAccountId)) {
        // A transfer is counted from its outflow side only.
        link(acc(t.accountId), acc(t.transferAccountId), cents, t.accountId, t.transferAccountId)
        touched.add(t.accountId).add(t.transferAccountId)
      } else if (t.transferAccountId !== null && inScope.has(t.accountId)) {
        // To an account that isn't synced: boxed by the person Up names.
        link(acc(t.accountId), outsider('out', t), cents, t.accountId, null)
        touched.add(t.accountId)
      } else if (inScope.has(t.accountId)) {
        spent.set(t.accountId, (spent.get(t.accountId) ?? 0) + cents)
        touched.add(t.accountId)
      }
      continue
    }
    // Credits: Up records only the credit side of round-ups, and transfers from unsynced accounts.
    if (t.transferAccountId !== null && byId.has(t.transferAccountId) && t.transactionType !== 'Round Up') continue
    if (!inScope.has(t.accountId) && !(synced(t.transferAccountId) && inScope.has(t.transferAccountId))) continue
    if (synced(t.transferAccountId)) {
      link(acc(t.transferAccountId), acc(t.accountId), cents, t.transferAccountId, t.accountId)
      touched.add(t.transferAccountId)
    } else if (t.transferAccountId !== null) {
      link(outsider('in', t), acc(t.accountId), cents, null, t.accountId)
    } else if (t.transactionType === 'Interest' && inScope.has(t.accountId)) {
      // A few cents into every Saver: a figure in the box's info, not a line from Other money in.
      interest.set(t.accountId, (interest.get(t.accountId) ?? 0) + cents)
    } else {
      link('other-in', acc(t.accountId), cents, null, t.accountId)
    }
    touched.add(t.accountId)
  }

  // An account that paid out more than came in drew on its earlier balance.
  for (const id of inScope) {
    const out = g.outCents(acc(id)) + (spent.get(id) ?? 0)
    const into = g.inCents(acc(id)) + (interest.get(id) ?? 0)
    if (out > into) g.edge('earlier', acc(id), out - into)
  }

  for (const id of touched) {
    const a = byId.get(id)
    const key = acc(id)
    const into = g.inCents(key)
    const out = g.outCents(key)
    if (inScope.has(id) && a) {
      const spentCents = spent.get(id) ?? 0
      const interestCents = interest.get(id) ?? 0
      const parts = [`In ${formatMoney(into)}`, spentCents > 0 ? `spent ${formatMoney(spentCents)}` : null]
      g.node({
        id: key,
        kind: 'account',
        label: a.name,
        caption: [...parts, `kept ${formatMoney(Math.max(0, into + interestCents - out - spentCents))}`]
          .filter(Boolean)
          .join(' · '),
        amountCents: into,
        colorToken: a.colorToken,
        href: `/accounts/${id}`,
        spentCents,
        interestCents,
      })
    } else if (a) {
      g.node({
        id: key,
        kind: 'outside-account',
        label: a.name,
        caption: `Outside ${input.scopeLabel}`,
        amountCents: Math.max(into, out),
        colorToken: a.colorToken,
        href: `/accounts/${id}`,
      })
    }
  }

  for (const [id, { way, name }] of outsiders) {
    const cents = way === 'in' ? g.outCents(id) : g.inCents(id)
    if (cents > 0) {
      const label = name ? `${way === 'in' ? 'From' : 'To'} ${name}` : 'Not synced'
      const caption = name ? `Outside ${input.scopeLabel}` : `Money ${way} · Outside ${input.scopeLabel}`
      g.node({ id, kind: 'outside-account', label, caption, amountCents: cents, colorToken: SLATE, href: null })
    }
  }
  const otherIn = g.outCents('other-in')
  if (otherIn > 0) {
    g.node({ id: 'other-in', kind: 'source', label: 'Other money in', caption: null, amountCents: otherIn, colorToken: SLATE, href: null })
  }
  const earlier = g.outCents('earlier')
  if (earlier > 0) {
    g.node({ id: 'earlier', kind: 'source', label: 'Earlier balance', caption: null, amountCents: earlier, colorToken: SLATE, href: null })
  }

  const built = g.build()
  for (const n of built.nodes) {
    const side = sideOf(n, byId)
    if (side) n.side = side
  }
  const joint = input.scope === 'joint'
  // The base: total pay, or in the Joint scope the money that came in from outside it.
  const baseCents = joint
    ? built.edges
        .filter((e) => e.from !== 'earlier' && e.to.startsWith('account:') && inScope.has(e.to.slice(8)) && !(e.from.startsWith('account:') && inScope.has(e.from.slice(8))))
        .reduce((s, e) => s + e.amountCents, 0)
    : input.pays.reduce((s, p) => s + p.amountCents, 0)
  return { ...built, baseCents, baseLabel: joint ? 'money in' : 'pay', overAllocatedCents: null }
}
