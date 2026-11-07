import { describe, expect, test } from 'vitest'
import { actualBudgetFlow } from '../../src/server/payflow/actual-budget'
import type { FlowGraph, FlowInput, FlowTx } from '../../src/server/payflow/types'
import { accounts, all, debts, edgeMap, ext, g1, input, lines, node, pay1, rp, samPays, samTwice, tx } from './payflow-fixture'

const budget = (txs: FlowTx[], over: Partial<FlowInput> = {}) =>
  actualBudgetFlow(input(txs, { lines, debts, ...over }))
const full = [...all, rp]
const from = (g: FlowGraph, id: string) => edgeMap({ edges: g.edges.filter((e) => e.from === id) })
const sumTo = (g: FlowGraph, id: string) =>
  g.edges.filter((e) => e.to === id).reduce((s, e) => s + e.amountCents, 0)
const sumFrom = (g: FlowGraph, id: string) =>
  g.edges.filter((e) => e.from === id).reduce((s, e) => s + e.amountCents, 0)

/** Every box is all source or all destination, and the totals agree with the lines. */
function expectBalanced(g: FlowGraph) {
  const sources = g.nodes.filter((n) => g.edges.some((e) => e.from === n.id))
  const dests = g.nodes.filter((n) => g.edges.some((e) => e.to === n.id))
  expect(sources.filter((n) => dests.includes(n))).toEqual([])
  for (const n of sources) expect(sumFrom(g, n.id)).toBe(n.amountCents)
  for (const n of dests) expect(sumTo(g, n.id)).toBe(n.amountCents)
  const out = sources.reduce((s, n) => s + n.amountCents, 0)
  expect(out).toBe(dests.reduce((s, n) => s + n.amountCents, 0))
  expect(out).toBe(g.edges.reduce((s, e) => s + e.amountCents, 0))
}

const jointScope: Partial<FlowInput> = {
  scope: 'joint',
  scopeLabel: 'Joint',
  scopeAccountIds: ['joint'],
  pays: [],
}
const j1 = tx('j1', 'spend', 50_000, { transferAccountId: 'joint' })
const j1d = tx('j1d', 'joint', -50_000, { transferAccountId: 'spend' })
const smallPay = [
  {
    userId: 'u1',
    userName: 'Owner',
    amountCents: 10_000,
    accountId: 'spend',
    txIds: ['pay1'],
    date: '2026-01-15',
    description: null,
  },
]
const refund = tx('big', 'spend', 50_000, { categorised: true, lineId: 'groc' })

describe('actualBudgetFlow', () => {
  test('budget view', () => {
    const g = budget(full)
    expect(from(g, 'pay:u1')).toEqual({
      'pay:u1->line:groc': 41_800,
      'pay:u1->line:ef': 5_000,
      'pay:u1->saver:hol': 150,
      'pay:u1->debt:d1': 30_000,
      'pay:u1->to-joint': 140_000,
      'pay:u1->not-budgeted': 5_000,
      'pay:u1->unspent': 98_050,
    })
    expect(g.edges).toHaveLength(7)
    expect(node(g, 'other-in')).toBeUndefined()
    expect(node(g, 'earlier')).toBeUndefined()
    expect(g.baseCents).toBe(320_000)
    expect(g.baseLabel).toBe('pay')
    expect(g.overAllocatedCents).toBeNull()
  })

  test('boxes', () => {
    const g = budget(full)
    expect(node(g, 'pay:u1')).toMatchObject({
      kind: 'pay',
      label: 'Pay',
      caption: 'ACME PAY · 15 Jan',
      amountCents: 320_000,
    })
    expect(node(g, 'line:groc')).toEqual({
      id: 'line:groc',
      kind: 'line',
      label: 'Groceries',
      caption: null,
      amountCents: 41_800,
      colorToken: 'cat-groc',
      href: '/budgets',
    })
    expect(node(g, 'line:ef')).toMatchObject({
      kind: 'line',
      label: 'Emergency fund',
      amountCents: 5_000,
      colorToken: 'cat-ef',
      href: '/budgets',
    })
    expect(node(g, 'saver:hol')).toEqual({
      id: 'saver:hol',
      kind: 'saver',
      label: 'Holiday',
      caption: null,
      amountCents: 150,
      colorToken: 'cat-hol',
      href: '/accounts/hol',
    })
    expect(node(g, 'debt:d1')).toEqual({
      id: 'debt:d1',
      kind: 'debt',
      label: 'Car loan',
      caption: null,
      amountCents: 30_000,
      colorToken: 'cat-rose',
      href: '/debts/d1',
    })
    expect(node(g, 'to-joint')).toMatchObject({
      kind: 'sink',
      label: 'To Joint',
      amountCents: 140_000,
      colorToken: 'cat-slate',
      href: null,
    })
    expect(node(g, 'not-budgeted')).toMatchObject({
      kind: 'sink',
      label: 'Other spending',
      colorToken: 'cat-slate',
    })
    expect(node(g, 'unspent')).toMatchObject({
      kind: 'sink',
      label: 'Unspent',
      amountCents: 98_050,
      colorToken: 'cat-slate',
    })
  })

  test('sources equal destinations', () => {
    const roundUp = tx('ru2', 'hol', 333, { transactionType: 'Round Up', transferAccountId: 'spend' })
    const fixtures: FlowGraph[] = [
      budget(full),
      budget(full.map((t) => (t.id === 'rp' ? { ...t, debtId: null } : t))),
      budget(full.filter((t) => t.id !== 't1' && t.id !== 't1c')),
      budget([...full, j1, j1d]),
      budget([pay1, g1], { pays: smallPay }),
      budget(full, jointScope),
      budget([pay1, g1, refund]),
      budget([pay1, g1, ext, tx('oi', 'spend', 777)]),
      budget([
        pay1,
        tx('oi', 'spend', 777),
        tx('oi2', 'spend', 1_234),
        tx('x', 'spend', 5_001, { transferAccountId: 'pspend' }),
        g1,
        ext,
        roundUp,
      ]),
    ]
    for (const g of fixtures) expectBalanced(g)
  })

  test('repayment only counts once', () => {
    const g = budget(full.map((t) => (t.id === 'rp' ? { ...t, debtId: null } : t)))
    expect(from(g, 'pay:u1')['pay:u1->line:groc']).toBe(71_800)
    expect(node(g, 'debt:d1')).toBeUndefined()
  })

  test('saver net', () => {
    const rest = full.filter((t) => t.id !== 't1' && t.id !== 't1c')
    const g = budget(rest, { lines: [lines[0]] })
    expect(node(g, 'saver:emer')).toEqual({
      id: 'saver:emer',
      kind: 'saver',
      label: 'From Emergency',
      caption: null,
      amountCents: 20_000,
      colorToken: 'cat-emer',
      href: '/accounts/emer',
    })
    expect(node(g, 'line:ef')).toBeUndefined()
    const fund = budget(rest)
    expect(node(fund, 'line:ef')).toMatchObject({
      kind: 'line',
      label: 'From Emergency fund',
      amountCents: 20_000,
      href: '/budgets',
    })
    expect(node(fund, 'saver:emer')).toBeUndefined()
    expectBalanced(g)
    expectBalanced(fund)
  })

  test('transfers between in-scope accounts only matter through saver nets', () => {
    const g = budget([
      pay1,
      tx('t1', 'spend', -25_000, { transferAccountId: 'emer' }),
      tx('t1c', 'emer', 25_000, { transferAccountId: 'spend' }),
    ])
    expect(edgeMap(g)).toEqual({ 'pay:u1->line:ef': 25_000, 'pay:u1->unspent': 295_000 })
  })

  test('from joint', () => {
    const net = budget([...full, j1, j1d])
    expect(node(net, 'to-joint')).toMatchObject({ kind: 'sink', label: 'To Joint', amountCents: 90_000 })
    const g = budget([pay1, j1, j1d])
    expect(node(g, 'to-joint')).toMatchObject({
      kind: 'source',
      label: 'From Joint',
      amountCents: 50_000,
      colorToken: 'cat-slate',
    })
    expect(edgeMap(g)).toEqual({ 'pay:u1->unspent': 320_000, 'to-joint->unspent': 50_000 })
    expect(g.baseCents).toBe(320_000)
  })

  test('earlier', () => {
    const g = budget([tx('pay1', 'spend', 10_000), g1], { pays: smallPay })
    expect(edgeMap(g)).toEqual({ 'pay:u1->line:groc': 10_000, 'earlier->line:groc': 33_000 })
    expect(node(g, 'earlier')).toMatchObject({
      kind: 'source',
      label: 'Earlier balance',
      amountCents: 33_000,
      colorToken: 'cat-slate',
    })
    expect(node(g, 'unspent')).toBeUndefined()
  })

  test('joint scope', () => {
    const g = budget(full, jointScope)
    expect(edgeMap(g)).toEqual({ 'from:u1->unspent': 140_000 })
    expect(node(g, 'from:u1')).toMatchObject({
      kind: 'source',
      label: 'From Owner',
      amountCents: 140_000,
      colorToken: 'positive',
    })
    expect(g.baseLabel).toBe('money in')
    expect(g.baseCents).toBe(140_000)
    expect(node(g, 'to-joint')).toBeUndefined()
    expect(g.overAllocatedCents).toBeNull()
  })

  test('joint scope: the base leaves out the earlier balance', () => {
    const g = budget(
      [
        tx('a', 'joint', 90_000, { transferAccountId: 'pspend' }),
        tx('b', 'joint', -100_000, { categorised: true, lineId: 'groc' }),
      ],
      jointScope,
    )
    expect(node(g, 'from:u2')).toMatchObject({ label: 'From Sam', amountCents: 90_000 })
    expect(node(g, 'earlier')?.amountCents).toBe(10_000)
    expect(g.baseCents).toBe(90_000)
  })

  test('people outside the scope', () => {
    const g = budget([
      pay1,
      tx('p1', 'spend', 12_000, { transferAccountId: 'pspend' }),
      tx('p2', 'spend', -3_000, { transferAccountId: 'pspend' }),
    ])
    expect(node(g, 'from:u2')).toMatchObject({
      kind: 'source',
      label: 'From Sam',
      amountCents: 9_000,
      colorToken: 'positive',
    })
    const out = budget([pay1, tx('p2', 'spend', -3_000, { transferAccountId: 'pspend' })])
    expect(node(out, 'from:u2')).toMatchObject({
      kind: 'sink',
      label: 'To Sam',
      amountCents: 3_000,
      colorToken: 'cat-slate',
    })
    expect(out.baseCents).toBe(320_000)
  })

  test('an account that is not synced', () => {
    const g = budget([
      pay1,
      tx('in', 'spend', 4_000, { transferAccountId: 'gone' }),
      tx('out', 'spend', -1_500, { transferAccountId: 'gone2' }),
    ])
    expect(node(g, 'other-in')).toMatchObject({
      kind: 'source',
      label: 'Other money in',
      amountCents: 4_000,
      colorToken: 'cat-slate',
    })
    expect(node(g, 'not-budgeted')?.amountCents).toBe(1_500)
  })

  test('negative line', () => {
    const g = budget([pay1, g1, refund])
    expect(node(g, 'line:groc')).toBeUndefined()
    expect(g.edges.some((e) => e.to === 'line:groc')).toBe(false)
    expect(node(g, 'other-in')).toMatchObject({ kind: 'source', amountCents: 7_000 })
    expect(edgeMap(g)).toEqual({ 'pay:u1->unspent': 320_000, 'other-in->unspent': 7_000 })
  })

  test('categorised inflows with no line reduce Not budgeted', () => {
    const g = budget([pay1, ext, tx('r2', 'spend', 2_000, { categorised: true })])
    expect(node(g, 'not-budgeted')?.amountCents).toBe(3_000)
  })

  test('outflows with an unknown line or debt are Not budgeted', () => {
    const g = budget([
      pay1,
      tx('a', 'spend', -1_000, { lineId: 'nope', categorised: true }),
      tx('b', 'spend', -2_000, { debtId: 'nope' }),
    ])
    expect(node(g, 'not-budgeted')?.amountCents).toBe(3_000)
  })

  test('two sources split exactly', () => {
    const g = budget([pay1, g1, ext, tx('oi', 'spend', 777)])
    expect(sumFrom(g, 'pay:u1')).toBe(320_000)
    expect(sumFrom(g, 'other-in')).toBe(777)
    expect(sumTo(g, 'line:groc')).toBe(43_000)
    expect(sumTo(g, 'not-budgeted')).toBe(5_000)
    expect(sumTo(g, 'unspent')).toBe(272_777)
    expect(g.edges.every((e) => e.amountCents > 0)).toBe(true)
    expect(g.edges).toHaveLength(6)
  })

  test('an empty cycle is a lone pay', () => {
    const g = budget([])
    expect(g.edges).toEqual([{ id: 'pay:u1->unspent', from: 'pay:u1', to: 'unspent', amountCents: 320_000 }])
  })

  test('a person paid twice in the cycle has one pay box with both pays', () => {
    const g = budget(samPays, samTwice())
    expect(node(g, 'pay:u2')).toMatchObject({
      kind: 'pay',
      label: "Sam's pay",
      caption: '2 pays · 15 Jan, 29 Jan',
      amountCents: 600_000,
    })
    expect(edgeMap(g)).toEqual({ 'pay:u2->unspent': 600_000 })
    expect(node(g, 'unspent')?.amountCents).toBe(600_000)
    expect(g.baseCents).toBe(600_000)
    expectBalanced(g)
  })

  test('a transfer into a home loan in scope is paid to the loan, not left Unspent', () => {
    const home = { id: 'home', name: 'Home loan', type: 'HOME_LOAN', ownership: 'JOINT' as const, ownerUserId: null, colorToken: 'cat-home' }
    const withLoan = { accounts: [...accounts, home] }
    const paid = [
      tx('in', 'joint', 300_000, { transferAccountId: 'pspend' }),
      tx('hl', 'joint', -250_000, { transferAccountId: 'home' }),
      tx('hlc', 'home', 250_000, { transferAccountId: 'joint' }),
    ]
    const j = budget(paid, { ...jointScope, ...withLoan, scopeAccountIds: ['joint', 'home'] })
    expect(node(j, 'account:home')).toEqual({
      id: 'account:home',
      kind: 'account',
      label: 'Home loan',
      caption: null,
      amountCents: 250_000,
      colorToken: 'cat-rose',
      href: '/accounts/home',
    })
    expect(edgeMap(j)).toEqual({ 'from:u2->account:home': 250_000, 'from:u2->unspent': 50_000 })
    expect(j.baseCents).toBe(300_000)
    expectBalanced(j)

    const e = budget([...samPays, ...paid], { ...samTwice(), ...withLoan, scopeAccountIds: [...samTwice().scopeAccountIds!, 'home'] })
    expect(node(e, 'account:home')?.amountCents).toBe(250_000)
    expect(node(e, 'unspent')?.amountCents).toBe(600_000 - 250_000)
    expectBalanced(e)

    // Redrawn from the loan: a source, like money from a Saver.
    const redraw = budget(
      [tx('rd', 'home', -40_000, { transferAccountId: 'joint' }), tx('rdc', 'joint', 40_000, { transferAccountId: 'home' }), tx('b', 'joint', -40_000, { categorised: true, lineId: 'groc' })],
      { ...jointScope, ...withLoan, scopeAccountIds: ['joint', 'home'] },
    )
    expect(node(redraw, 'account:home')).toMatchObject({ kind: 'account', label: 'From Home loan', amountCents: 40_000 })
    expect(edgeMap(redraw)).toEqual({ 'account:home->line:groc': 40_000 })
    expect(redraw.baseCents).toBe(0)
    expectBalanced(redraw)
  })
})
