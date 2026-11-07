import type { PayFlowNodeDto } from '../../shared/types'
import { payNodes } from './actual-accounts'
import { GraphBuilder } from './graph'
import type { FlowAccount, FlowGraph, FlowInput, FlowLine } from './types'

const SLATE = 'cat-slate'
const POSITIVE = 'positive'
const ROSE = 'cat-rose'

type Boxes = Map<string, PayFlowNodeDto>

const add = (m: Map<string, number>, key: string, cents: number) => m.set(key, (m.get(key) ?? 0) + cents)

/** Adds to a box, creating it on first use; amounts of zero or less make no box. */
function put(boxes: Boxes, n: PayFlowNodeDto): void {
  const existing = boxes.get(n.id)
  if (existing) existing.amountCents += n.amountCents
  else if (n.amountCents > 0) boxes.set(n.id, n)
}

function plain(
  id: string,
  kind: PayFlowNodeDto['kind'],
  label: string,
  cents: number,
  colorToken = SLATE,
): PayFlowNodeDto {
  return { id, kind, label, caption: null, amountCents: cents, colorToken, href: null }
}

/**
 * Splits every source across every destination in proportion to its share of the total. Each destination is
 * rounded by largest remainder, then single cents move between sources until each source's lines add up too.
 */
function split(sources: PayFlowNodeDto[], dests: PayFlowNodeDto[]): [string, string, number][] {
  const total = sources.reduce((s, n) => s + n.amountCents, 0)
  if (total <= 0) return []
  const m = sources.map(() => dests.map(() => 0))
  dests.forEach((d, j) => {
    const parts = sources.map((s, i) => {
      const exact = d.amountCents * s.amountCents
      return { i, whole: Math.floor(exact / total), rem: exact % total }
    })
    let left = d.amountCents - parts.reduce((s, p) => s + p.whole, 0)
    for (const p of [...parts].sort((a, b) => b.rem - a.rem || a.i - b.i)) {
      m[p.i][j] = p.whole + (left > 0 ? 1 : 0)
      if (left > 0) left--
    }
  })
  const dev = (i: number) => m[i].reduce((s, c) => s + c, 0) - sources[i].amountCents
  for (;;) {
    const over = sources.findIndex((_, i) => dev(i) > 0)
    const under = sources.findIndex((_, i) => dev(i) < 0)
    if (over < 0 || under < 0) break
    const j = m[over].findIndex((c) => c > 0)
    m[over][j]--
    m[under][j]++
  }
  const out: [string, string, number][] = []
  sources.forEach((s, i) => dests.forEach((d, j) => out.push([s.id, d.id, m[i][j]])))
  return out
}

/** Actual · Budget: what the pay paid for in the cycle. */
export function actualBudgetFlow(input: FlowInput): FlowGraph {
  const inScope = new Set(input.scopeAccountIds)
  const byId = new Map<string, FlowAccount>(input.accounts.map((a) => [a.id, a]))
  const lineById = new Map<string, FlowLine>(input.lines.map((l) => [l.id, l]))
  const debtById = new Map(input.debts.map((d) => [d.id, d]))
  const nameOf = (userId: string) => input.users.find((u) => u.id === userId)?.name ?? 'Someone'
  const payTxIds = new Set(input.pays.flatMap((p) => p.txIds))

  const lineNet = new Map<string, number>() // spent minus refunded
  const debtPaid = new Map<string, number>()
  // Savers, home loans: any account in scope that isn't for spending, by its net for the cycle.
  const saverNet = new Map<string, number>()
  const personNet = new Map<string, number>()
  let notBudgeted = 0
  let otherIn = 0
  let jointNet = 0

  for (const t of input.txs) {
    const acct = byId.get(t.accountId)
    if (!acct || !inScope.has(t.accountId) || payTxIds.has(t.id) || t.amountCents === 0) continue
    const cents = t.amountCents
    if (t.transferAccountId === null) {
      if (cents < 0) {
        // A repayment counts toward its debt only; then a line; then Not budgeted.
        if (t.debtId && debtById.has(t.debtId)) add(debtPaid, t.debtId, -cents)
        else if (t.lineId && lineById.has(t.lineId)) add(lineNet, t.lineId, -cents)
        else notBudgeted -= cents
      } else if (!t.categorised) otherIn += cents
      else if (t.lineId && lineById.has(t.lineId)) add(lineNet, t.lineId, -cents)
      else notBudgeted -= cents
      continue
    }
    // Transfers between two accounts in scope only matter through a Saver's (or home loan's) net.
    if (acct.type !== 'TRANSACTIONAL') add(saverNet, acct.id, cents)
    const other = byId.get(t.transferAccountId)
    if (!other) {
      if (cents > 0) otherIn += cents
      else notBudgeted -= cents
    } else if (inScope.has(other.id)) {
      continue
    } else if (other.ownership === 'JOINT') {
      jointNet += cents
    } else if (other.ownerUserId) {
      add(personNet, other.ownerUserId, cents)
    } else if (cents > 0) {
      otherIn += cents
    } else {
      notBudgeted -= cents
    }
  }

  // A line or Not budgeted that ends below $0 shows $0; the excess joins other money in.
  for (const [id, net] of lineNet) {
    if (net < 0) {
      otherIn -= net
      lineNet.set(id, 0)
    }
  }
  if (notBudgeted < 0) {
    otherIn -= notBudgeted
    notBudgeted = 0
  }

  const sources: Boxes = new Map()
  const dests: Boxes = new Map()
  const saverSources = new Set<string>()
  const fundLine = new Map<string, FlowLine>()
  for (const l of input.lines)
    if (l.kind === 'fund' && l.saverAccountId && !fundLine.has(l.saverAccountId))
      fundLine.set(l.saverAccountId, l)
  const lineBox = (l: FlowLine, cents: number, label = l.name): PayFlowNodeDto => ({
    id: `line:${l.id}`,
    kind: 'line',
    label,
    caption: null,
    amountCents: cents,
    colorToken: l.colorToken,
    href: '/budgets',
  })

  // Set, not put: a pay of $0 (an expected one) still gets its box.
  for (const n of payNodes(input.pays, input.scopeLabel)) sources.set(n.id, n)
  put(sources, plain('other-in', 'source', 'Other money in', otherIn))
  for (const [userId, net] of personNet) {
    if (net > 0) put(sources, plain(`from:${userId}`, 'source', `From ${nameOf(userId)}`, net, POSITIVE))
  }
  if (jointNet > 0) put(sources, plain('to-joint', 'source', 'From Joint', jointNet))

  for (const l of input.lines) put(dests, lineBox(l, lineNet.get(l.id) ?? 0))
  for (const a of input.accounts) {
    const net = saverNet.get(a.id) ?? 0
    if (net === 0) continue
    const fund = fundLine.get(a.id)
    const saver = a.type === 'SAVER'
    // A Saver keeps its own colour; a home loan is a debt, so rose.
    const box = (label: string): PayFlowNodeDto => ({
      id: saver ? `saver:${a.id}` : `account:${a.id}`,
      kind: saver ? 'saver' : 'account',
      label,
      caption: null,
      amountCents: Math.abs(net),
      colorToken: saver ? a.colorToken : ROSE,
      href: `/accounts/${a.id}`,
    })
    if (net > 0) put(dests, fund ? lineBox(fund, net) : box(a.name))
    else {
      const src = fund ? lineBox(fund, -net, `From ${fund.name}`) : box(`From ${a.name}`)
      saverSources.add(src.id)
      put(sources, src)
    }
  }
  for (const d of input.debts) {
    const paid = debtPaid.get(d.id) ?? 0
    put(dests, {
      id: `debt:${d.id}`,
      kind: 'debt',
      label: d.name,
      caption: null,
      amountCents: paid,
      colorToken: ROSE,
      href: `/debts/${d.id}`,
    })
  }
  if (jointNet < 0) put(dests, plain('to-joint', 'sink', 'To Joint', -jointNet))
  for (const [userId, net] of personNet) {
    if (net < 0) put(dests, plain(`from:${userId}`, 'sink', `To ${nameOf(userId)}`, -net))
  }
  put(dests, plain('not-budgeted', 'sink', 'Other spending', notBudgeted))

  // A box on both sides (a Fund line that was spent from and saved into) keeps only the difference.
  for (const [id, s] of sources) {
    const d = dests.get(id)
    if (!d) continue
    const diff = d.amountCents - s.amountCents
    if (diff > 0) {
      d.amountCents = diff
      sources.delete(id)
    } else {
      s.amountCents = -diff
      dests.delete(id)
      if (diff === 0) sources.delete(id)
    }
  }

  // Close the gap last.
  const sum = (m: Boxes) => [...m.values()].reduce((s, n) => s + n.amountCents, 0)
  const gap = sum(dests) - sum(sources)
  if (gap > 0) put(sources, plain('earlier', 'source', 'Earlier balance', gap))
  else if (gap < 0) put(dests, plain('unspent', 'sink', 'Unspent', -gap))

  const g = new GraphBuilder()
  const src = [...sources.values()]
  const dst = [...dests.values()]
  for (const n of [...src, ...dst]) g.node(n)
  for (const [from, to, cents] of split(src, dst)) g.edge(from, to, cents)

  const joint = input.scope === 'joint'
  const baseCents = joint
    ? src.filter((n) => n.id !== 'earlier' && !saverSources.has(n.id)).reduce((s, n) => s + n.amountCents, 0)
    : input.pays.reduce((s, p) => s + p.amountCents, 0)
  return { ...g.build(), baseCents, baseLabel: joint ? 'money in' : 'pay', overAllocatedCents: null }
}
