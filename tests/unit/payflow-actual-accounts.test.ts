import { describe, expect, test } from 'vitest'
import { actualAccountsFlow, keptCents } from '../../src/server/payflow/actual-accounts'
import { all, edgeMap, ext, g1, input, node, pay1, samPays, samTwice, t1, t1c, tx } from './payflow-fixture'

describe('actualAccountsFlow', () => {
  test('round trip', () => {
    const g = actualAccountsFlow(input(all))
    expect(edgeMap(g)).toEqual({
      'pay:u1->account:spend': 320_000,
      'account:spend->account:emer': 25_000,
      'account:emer->account:spend': 20_000,
      'account:spend->account:joint': 140_000,
      'account:spend->account:hol': 150,
      'other-in->account:spend': 1_200,
    })
    expect(g.edges).toHaveLength(6)
    expect(node(g, 'account:joint')).toMatchObject({ kind: 'outside-account', caption: 'Outside Me', href: '/accounts/joint' })
    expect(node(g, 'account:spend')).toMatchObject({ kind: 'account', caption: 'In $3,412.00 · spent $480.00 · kept $1,280.50', spentCents: 48_000, colorToken: 'cat-spend', href: '/accounts/spend' })
    expect(node(g, 'account:emer')?.caption).toBe('In $250.00 · kept $50.00')
    expect(node(g, 'account:hol')?.caption).toBe('In $1.50 · kept $1.50')
    expect(g.baseCents).toBe(320_000)
    expect(g.baseLabel).toBe('pay')
    expect(g.overAllocatedCents).toBeNull()
  })

  test('pay, sink and source boxes', () => {
    const g = actualAccountsFlow(input(all))
    expect(node(g, 'pay:u1')).toEqual({
      id: 'pay:u1',
      kind: 'pay',
      label: 'Pay',
      caption: 'ACME PAY · 15 Jan',
      amountCents: 320_000,
      colorToken: 'positive',
      href: null,
      side: 'in',
    })
    // Spending is a figure on the account's box, not a box of its own.
    expect(g.nodes.some((n) => n.kind === 'sink')).toBe(false)
    expect(node(g, 'account:emer')?.spentCents).toBe(0)
    expect(node(g, 'other-in')).toMatchObject({ kind: 'source', label: 'Other money in', amountCents: 1_200, colorToken: 'cat-slate' })
  })

  test('pay label names the person in Everyone and Joint, and a placeholder says Expected', () => {
    const pays = [{ userId: 'u1', userName: 'Owner', amountCents: 0, accountId: null, txIds: [], date: '2026-03-03', description: null }]
    const g = actualAccountsFlow(input([], { scope: 'everyone', scopeLabel: 'Everyone', pays }))
    expect(node(g, 'pay:u1')).toMatchObject({ label: "Owner's pay", caption: 'Expected · 3 Mar', amountCents: 0 })
  })

  test('balances: in + interest = out + spent + kept for every account', () => {
    const g = actualAccountsFlow(input(all))
    const accountNodes = g.nodes.filter((n) => n.kind === 'account')
    expect(accountNodes.length).toBe(3)
    for (const n of accountNodes) {
      const inSum = g.edges.filter((e) => e.to === n.id).reduce((s, e) => s + e.amountCents, 0)
      const outSum = g.edges.filter((e) => e.from === n.id).reduce((s, e) => s + e.amountCents, 0)
      expect(inSum + (n.interestCents ?? 0)).toBe(outSum + (n.spentCents ?? 0) + keptCents(g, n.id))
      expect(n.amountCents).toBe(inSum)
    }
    expect(keptCents(g, 'account:spend')).toBe(128_050)
  })

  test('just paid', () => {
    const g = actualAccountsFlow(input([pay1]))
    expect(g.edges).toEqual([{ id: 'pay:u1->account:spend', from: 'pay:u1', to: 'account:spend', amountCents: 320_000 }])
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['account:spend', 'pay:u1'])
    expect(node(g, 'account:spend')?.caption).toBe('In $3,200.00 · kept $3,200.00')
  })

  test('transfer counted once', () => {
    expect(edgeMap(actualAccountsFlow(input([t1])))['account:spend->account:emer']).toBe(25_000)
    expect(edgeMap(actualAccountsFlow(input([t1, t1c])))['account:spend->account:emer']).toBe(25_000)
    expect(edgeMap(actualAccountsFlow(input([t1c])))['account:spend->account:emer']).toBeUndefined()
  })

  test('overdrawn', () => {
    const pays = [{ userId: 'u1', userName: 'Owner', amountCents: 10_000, accountId: 'spend', txIds: ['pay1'], date: '2026-01-15', description: null }]
    const g = actualAccountsFlow(input([tx('pay1', 'spend', 10_000), g1], { pays }))
    expect(edgeMap(g)['earlier->account:spend']).toBe(33_000)
    expect(node(g, 'earlier')).toMatchObject({ kind: 'source', label: 'Earlier balance', amountCents: 33_000 })
    expect(node(g, 'account:spend')?.caption).toBe('In $430.00 · spent $430.00 · kept $0.00')
    expect(keptCents(g, 'account:spend')).toBe(0)
  })

  test('not synced', () => {
    const g = actualAccountsFlow(
      input([tx('x1', 'joint', 5_000, { transferAccountId: 'gone' })], {
        scope: 'joint',
        scopeLabel: 'Joint',
        scopeAccountIds: ['joint'],
        pays: [],
      }),
    )
    expect(edgeMap(g)).toEqual({ 'unsynced-in->account:joint': 5_000 })
    expect(node(g, 'unsynced-in')).toMatchObject({ kind: 'outside-account', label: 'Not synced', caption: 'Money in · Outside Joint', href: null })
    expect(g.baseCents).toBe(5_000)
    expect(g.baseLabel).toBe('money in')
  })

  test('money sent to an account that is not synced goes to Not synced, not spending', () => {
    const g = actualAccountsFlow(input([pay1, tx('out', 'spend', -1_500, { transferAccountId: 'gone' })]))
    expect(edgeMap(g)).toEqual({ 'pay:u1->account:spend': 320_000, 'account:spend->unsynced-out': 1_500 })
    expect(node(g, 'unsynced-out')).toMatchObject({
      kind: 'outside-account',
      label: 'Not synced',
      caption: 'Money out · Outside Me',
      amountCents: 1_500,
      href: null,
    })
    expect(node(g, 'account:spend')?.spentCents).toBe(0)
  })

  test('accounts that are not synced share one box each way', () => {
    const g = actualAccountsFlow(
      input([
        pay1,
        tx('in1', 'spend', 5_000, { transferAccountId: 'gone1' }),
        tx('in2', 'spend', 200, { transferAccountId: 'gone2' }),
        tx('out1', 'spend', -1_500, { transferAccountId: 'gone1' }),
        tx('out2', 'spend', -500, { transferAccountId: 'gone3' }),
      ]),
    )
    expect(edgeMap(g)).toEqual({
      'pay:u1->account:spend': 320_000,
      'unsynced-in->account:spend': 5_200,
      'account:spend->unsynced-out': 2_000,
    })
    expect(g.nodes.filter((n) => n.label === 'Not synced').map((n) => [n.id, n.amountCents])).toEqual([
      ['unsynced-in', 5_200],
      ['unsynced-out', 2_000],
    ])
  })

  test('money from or to someone outside Upkeep is boxed by the name Up gives', () => {
    const g = actualAccountsFlow(
      input([
        pay1,
        tx('in1', 'spend', 5_000, { transferAccountId: 'sam1', description: 'Transfer from $sam' }),
        tx('in2', 'spend', 200, { transferAccountId: 'sam2', description: 'Forward from $sam' }),
        tx('out1', 'spend', -1_500, { transferAccountId: 'sam1', description: 'Transfer to $sam' }),
        tx('in3', 'spend', 700, { transferAccountId: 'x', description: 'Transfer from $alex' }),
      ]),
    )
    expect(edgeMap(g)).toEqual({
      'pay:u1->account:spend': 320_000,
      'unsynced-in:$sam->account:spend': 5_200,
      'unsynced-in:$alex->account:spend': 700,
      'account:spend->unsynced-out:$sam': 1_500,
    })
    expect(node(g, 'unsynced-in:$sam')).toMatchObject({
      kind: 'outside-account',
      label: 'From $sam',
      caption: 'Outside Me',
      amountCents: 5_200,
      href: null,
    })
    expect(node(g, 'unsynced-out:$sam')).toMatchObject({ label: 'To $sam', caption: 'Outside Me', amountCents: 1_500 })
  })

  test('interest is a figure on the account, not a line', () => {
    const interest = (id: string, account: string, cents: number) => tx(id, account, cents, { transactionType: 'Interest' })
    const g = actualAccountsFlow(input([pay1, t1, interest('i1', 'emer', 175), interest('i2', 'spend', 12), ext]))
    expect(edgeMap(g)).toEqual({
      'pay:u1->account:spend': 320_000,
      'account:spend->account:emer': 25_000,
    })
    expect(node(g, 'other-in')).toBeUndefined()
    expect(node(g, 'account:emer')).toMatchObject({ interestCents: 175, amountCents: 25_000, caption: 'In $250.00 · kept $251.75' })
    expect(node(g, 'account:spend')?.interestCents).toBe(12)
    expect(keptCents(g, 'account:emer')).toBe(25_175)
  })

  test('money in is marked for the left, spending accounts and money out for the right', () => {
    const g = actualAccountsFlow(
      input([
        ...all,
        tx('in1', 'spend', 5_000, { transferAccountId: 'sam1', description: 'Transfer from $sam' }),
        tx('out1', 'spend', -1_500, { transferAccountId: 'sam1', description: 'Transfer to $sam' }),
      ]),
    )
    const side = (id: string) => node(g, id)?.side
    expect([side('pay:u1'), side('other-in'), side('unsynced-in:$sam')]).toEqual(['in', 'in', 'in'])
    expect([side('account:spend'), side('account:joint'), side('unsynced-out:$sam')]).toEqual(['out', 'out', 'out'])
    expect(side('account:emer')).toBeUndefined()
  })

  test('outside has no own lines', () => {
    const g = actualAccountsFlow(input(all))
    expect(g.edges.filter((e) => e.from === 'account:joint')).toEqual([])
    expect(g.edges.some((e) => e.to === 'earlier' || e.from === 'spent:joint')).toBe(false)
  })

  test('edges with neither end in scope are skipped', () => {
    const g = actualAccountsFlow(input([pay1, tx('far', 'joint', -7_000, { transferAccountId: 'pspend' }), tx('far2', 'pspend', -900)]))
    expect(g.edges).toHaveLength(1)
  })

  test('a person paid twice in the cycle has one pay box with both pays', () => {
    const g = actualAccountsFlow(input(samPays, samTwice()))
    expect(node(g, 'pay:u2')).toMatchObject({
      kind: 'pay',
      label: "Sam's pay",
      caption: '2 pays · 15 Jan, 29 Jan',
      amountCents: 600_000,
    })
    expect(edgeMap(g)).toEqual({ 'pay:u2->account:pspend': 600_000 })
    expect(node(g, 'account:pspend')?.caption).toBe('In $6,000.00 · kept $6,000.00')
    expect(g.baseCents).toBe(600_000)
  })

  describe('pay splits', () => {
    const PAID = '2026-01-15T09:00:00.000Z'
    const after = (seconds: number) => new Date(Date.parse(PAID) + seconds * 1000).toISOString()
    const split = (id: string, to: string, cents: number, seconds: number, automatic = true) =>
      tx(id, 'spend', -cents, { transferAccountId: to, transactionType: 'Transfer', createdAt: after(seconds), automatic })

    test("Up's automatic transfers just after the pay go straight from the pay", () => {
      const g = actualAccountsFlow(input([pay1, split('s1', 'emer', 25_000, 3), split('s2', 'hol', 10_000, 5)]))
      expect(edgeMap(g)).toEqual({
        'pay:u1->account:spend': 285_000,
        'pay:u1->account:emer': 25_000,
        'pay:u1->account:hol': 10_000,
      })
      expect(node(g, 'account:spend')?.caption).toBe('In $2,850.00 · kept $2,850.00')
      expect(node(g, 'account:emer')?.caption).toBe('In $250.00 · kept $250.00')
    })

    test('a transfer made by hand, or after ten minutes, still leaves from the account', () => {
      const g = actualAccountsFlow(
        input([pay1, split('hand', 'emer', 5_000, 30, false), split('late', 'hol', 1_600, 601), split('edge', 'hol', 700, 600)]),
      )
      expect(edgeMap(g)).toEqual({
        'pay:u1->account:spend': 319_300,
        'pay:u1->account:hol': 700,
        'account:spend->account:emer': 5_000,
        'account:spend->account:hol': 1_600,
      })
    })

    test('a transfer before the pay arrived is not part of it', () => {
      const g = actualAccountsFlow(input([pay1, split('early', 'emer', 5_000, -60)]))
      expect(edgeMap(g)['account:spend->account:emer']).toBe(5_000)
    })

    test('a split to an account outside the scope goes to its outside box', () => {
      const g = actualAccountsFlow(input([pay1, split('j', 'joint', 140_000, 4)]))
      expect(edgeMap(g)).toEqual({ 'pay:u1->account:spend': 180_000, 'pay:u1->account:joint': 140_000 })
      expect(node(g, 'account:joint')).toMatchObject({ kind: 'outside-account' })
    })
  })
})
