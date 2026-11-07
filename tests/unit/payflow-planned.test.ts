import { describe, expect, test } from 'vitest'
import { plannedAccountsFlow, plannedBudgetFlow, type PlannedInput } from '../../src/server/payflow/planned'
import type { PayPlanDto, PlanItemDto } from '../../src/shared/types'
import { accounts, edgeMap, lines, node } from './payflow-fixture'

const item = (over: Partial<PlanItemDto> & Pick<PlanItemDto, 'targetKind' | 'amountCents'>): PlanItemDto => ({
  id: `i-${over.targetKind}-${over.lineId ?? over.saverAccountId ?? 'buffer'}`,
  lineId: null,
  saverAccountId: null,
  targetName: 'Target',
  resolvedSaverId: null,
  check: null,
  movedCents: null,
  ...over,
})

const items = (): PlanItemDto[] => [
  item({ targetKind: 'line', lineId: 'groc', amountCents: 40_000, targetName: 'Groceries' }),
  item({ targetKind: 'line', lineId: 'ef', amountCents: 25_000, targetName: 'Emergency fund', resolvedSaverId: 'emer' }),
  item({ targetKind: 'saver', saverAccountId: 'hol', amountCents: 10_000, targetName: 'Holiday' }),
  item({ targetKind: 'buffer', amountCents: 5_000, targetName: 'Leave in Spending' }),
]

const plan = (its: PlanItemDto[], income = 320_000): PayPlanDto => ({
  userId: 'u1',
  payDate: '2026-01-15',
  incomeCents: income,
  incomeIsExpected: false,
  allocatedCents: its.reduce((s, i) => s + i.amountCents, 0),
  customised: false,
  items: its,
})

const planned = (its: PlanItemDto[] = items(), over: Partial<PlannedInput> = {}, income = 320_000): PlannedInput => ({
  scope: 'me',
  scopeLabel: 'Me',
  users: [
    { id: 'u1', name: 'Owner' },
    { id: 'u2', name: 'Sam' },
  ],
  accounts,
  scopeAccountIds: ['spend', 'emer', 'hol'],
  lines,
  pays: [
    {
      pay: {
        userId: 'u1',
        userName: 'Owner',
        amountCents: income,
        accountId: 'spend',
        txIds: [],
        date: '2026-01-15',
        description: null,
      },
      plan: plan(its, income),
      landsIn: 'spend',
    },
  ],
  ...over,
})

const jl = { id: 'jl', name: 'Rates', kind: 'spending' as const, saverAccountId: null, colorToken: 'cat-jl', joint: true }
const jlItem = item({ targetKind: 'line', lineId: 'jl', amountCents: 30_000, targetName: 'Rates' })

describe('plannedBudgetFlow', () => {
  test('planned budget', () => {
    const g = plannedBudgetFlow(planned())
    expect(edgeMap(g)).toEqual({
      'pay:u1->line:groc': 40_000,
      'pay:u1->line:ef': 25_000,
      'pay:u1->saver:hol': 10_000,
      'pay:u1->buffer': 5_000,
      'pay:u1->unallocated': 240_000,
    })
    expect(g.overAllocatedCents).toBeNull()
    expect(g.baseCents).toBe(320_000)
    expect(g.baseLabel).toBe('pay')
    expect(node(g, 'pay:u1')).toMatchObject({ kind: 'pay', label: 'Pay', amountCents: 320_000 })
    expect(node(g, 'line:groc')).toMatchObject({ kind: 'line', label: 'Groceries', colorToken: 'cat-groc', href: '/budgets' })
    expect(node(g, 'saver:hol')).toMatchObject({ kind: 'saver', label: 'Holiday', colorToken: 'cat-hol', href: '/accounts/hol' })
    expect(node(g, 'buffer')).toMatchObject({ kind: 'sink', label: 'Leave in Spending', amountCents: 5_000 })
    expect(node(g, 'unallocated')).toMatchObject({ kind: 'sink', label: 'Not allocated yet', amountCents: 240_000 })
  })

  test('over-allocated', () => {
    const its = items()
    its[0] = { ...its[0], amountCents: 80_000 }
    const g = plannedBudgetFlow(planned(its, {}, 100_000))
    expect(g.overAllocatedCents).toBe(20_000)
    expect(node(g, 'unallocated')).toBeUndefined()
    expect(edgeMap(g)).toEqual({
      'pay:u1->line:groc': 80_000,
      'pay:u1->line:ef': 25_000,
      'pay:u1->saver:hol': 10_000,
      'pay:u1->buffer': 5_000,
    })
  })

  test('targets missing from lines and accounts use the item name', () => {
    const g = plannedBudgetFlow(
      planned([
        item({ targetKind: 'line', lineId: 'gone', amountCents: 1_000, targetName: 'Old line' }),
        item({ targetKind: 'saver', saverAccountId: 'gone-acct', amountCents: 2_000, targetName: 'Old saver' }),
      ]),
    )
    expect(node(g, 'line:gone')).toMatchObject({ label: 'Old line', colorToken: 'cat-slate' })
    expect(node(g, 'saver:gone-acct')).toMatchObject({ label: 'Old saver', colorToken: 'cat-slate' })
  })

  test('joint scope', () => {
    const g = plannedBudgetFlow(
      planned([...items(), jlItem], {
        scope: 'joint',
        scopeLabel: 'Joint',
        lines: [jl],
      }),
    )
    expect(edgeMap(g)).toEqual({ 'from:u1->line:jl': 30_000 })
    expect(node(g, 'from:u1')).toMatchObject({ kind: 'source', label: 'From Owner', amountCents: 30_000, colorToken: 'positive' })
    expect(g.baseCents).toBe(30_000)
    expect(g.baseLabel).toBe('money in')
    expect(g.overAllocatedCents).toBeNull()
  })

  test('joint scope keeps a Saver that is Joint', () => {
    const jointSaver = { ...accounts[3], id: 'jsav', type: 'SAVER', name: 'Joint saver' }
    const g = plannedBudgetFlow(
      planned([item({ targetKind: 'saver', saverAccountId: 'jsav', amountCents: 7_000 }), ...items()], {
        scope: 'joint',
        scopeLabel: 'Joint',
        accounts: [...accounts, jointSaver],
        lines: [],
      }),
    )
    expect(edgeMap(g)).toEqual({ 'from:u1->saver:jsav': 7_000 })
  })

  test('two pays add up', () => {
    const one = planned()
    const two = planned(
      [item({ targetKind: 'line', lineId: 'groc', amountCents: 1_000 })],
      {},
      50_000,
    ).pays[0]
    two.pay = { ...two.pay, userId: 'u2', userName: 'Sam', accountId: 'pspend' }
    two.plan = { ...two.plan, userId: 'u2' }
    two.landsIn = 'pspend'
    const g = plannedBudgetFlow({ ...one, scopeLabel: 'Everyone', scope: 'everyone', pays: [...one.pays, two] })
    expect(g.baseCents).toBe(370_000)
    expect(edgeMap(g)['pay:u2->line:groc']).toBe(1_000)
    expect(edgeMap(g)['pay:u1->line:groc']).toBe(40_000)
    expect(node(g, 'unallocated')?.amountCents).toBe(240_000 + 49_000)
  })
})

describe('plannedAccountsFlow', () => {
  test('planned accounts', () => {
    const g = plannedAccountsFlow(planned())
    // What the plan sends to other accounts goes straight from the pay, as a pay split does.
    expect(edgeMap(g)).toEqual({
      'pay:u1->account:spend': 285_000,
      'pay:u1->account:emer': 25_000,
      'pay:u1->account:hol': 10_000,
      'account:spend->kept:spend': 40_000,
      'account:spend->buffer': 5_000,
      'account:spend->unallocated': 240_000,
    })
    expect(g.overAllocatedCents).toBeNull()
    expect(node(g, 'account:spend')).toMatchObject({ kind: 'account', label: 'spend', amountCents: 285_000, caption: null, href: '/accounts/spend' })
    expect(node(g, 'account:emer')).toMatchObject({ kind: 'account', label: 'Emergency', amountCents: 25_000, colorToken: 'cat-emer' })
    expect(node(g, 'kept:spend')).toMatchObject({ kind: 'sink', label: 'Kept for lines', amountCents: 40_000 })
    expect(node(g, 'buffer')).toMatchObject({ kind: 'sink', label: 'Leave in Spending' })
  })

  test('planned accounts marks money in for the left, Spending and what stays there for the right', () => {
    const g = plannedAccountsFlow(planned())
    const side = (id: string) => node(g, id)?.side
    expect(side('pay:u1')).toBe('in')
    expect([side('account:spend'), side('kept:spend'), side('buffer'), side('unallocated')]).toEqual(['out', 'out', 'out', 'out'])
    expect(side('account:emer')).toBeUndefined()
    // The Budget view keeps its plain fan.
    expect(plannedBudgetFlow(planned()).nodes.every((n) => n.side === undefined)).toBe(true)
  })

  test('over-allocated', () => {
    const its = items()
    its[0] = { ...its[0], amountCents: 80_000 }
    const g = plannedAccountsFlow(planned(its, {}, 100_000))
    expect(g.overAllocatedCents).toBe(20_000)
    expect(node(g, 'unallocated')).toBeUndefined()
    expect(edgeMap(g)['pay:u1->account:spend']).toBe(65_000)
    expect(edgeMap(g)['account:spend->kept:spend']).toBe(80_000)
  })

  test('joint line without saver', () => {
    const g = plannedAccountsFlow(
      planned([jlItem], {
        scope: 'everyone',
        scopeLabel: 'Everyone',
        scopeAccountIds: accounts.map((a) => a.id),
        lines: [...lines, jl],
      }),
    )
    expect(edgeMap(g)['pay:u1->account:joint']).toBe(30_000)
    expect(node(g, 'account:joint')).toMatchObject({ kind: 'account', amountCents: 30_000 })
    expect(edgeMap(g)['account:spend->kept:spend']).toBeUndefined()
  })

  test('a target outside the scope is drawn as outside it', () => {
    const g = plannedAccountsFlow(planned([...items(), jlItem], { lines: [...lines, jl] }))
    expect(node(g, 'account:joint')).toMatchObject({
      kind: 'outside-account',
      label: 'joint',
      caption: 'Outside Me',
      amountCents: 30_000,
      href: '/accounts/joint',
    })
    expect(node(g, 'account:emer')).toMatchObject({ kind: 'account', caption: null })
    expect(node(g, 'account:spend')).toMatchObject({ kind: 'account', caption: null })
  })

  test('joint scope', () => {
    const g = plannedAccountsFlow(
      planned([...items(), jlItem], { scope: 'joint', scopeLabel: 'Joint', scopeAccountIds: ['joint'], lines: [jl] }),
    )
    expect(edgeMap(g)).toEqual({
      'from:u1->account:joint': 30_000,
      'account:joint->kept:joint': 30_000,
    })
    expect(g.baseCents).toBe(30_000)
    expect(g.baseLabel).toBe('money in')
  })
})
