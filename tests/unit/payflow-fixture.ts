import type { FlowAccount, FlowGraph, FlowInput, FlowLine, FlowTx } from '../../src/server/payflow/types'

const acct = (
  id: string,
  type: string,
  ownership: 'INDIVIDUAL' | 'JOINT',
  ownerUserId: string | null,
  name = id,
): FlowAccount => ({
  id,
  name,
  type,
  ownership,
  ownerUserId,
  colorToken: `cat-${id}`,
})

export const accounts: FlowAccount[] = [
  acct('spend', 'TRANSACTIONAL', 'INDIVIDUAL', 'u1'),
  acct('emer', 'SAVER', 'INDIVIDUAL', 'u1', 'Emergency'),
  acct('hol', 'SAVER', 'INDIVIDUAL', 'u1', 'Holiday'),
  acct('joint', 'TRANSACTIONAL', 'JOINT', null),
  acct('pspend', 'TRANSACTIONAL', 'INDIVIDUAL', 'u2'),
]

export const tx = (
  id: string,
  accountId: string,
  amountCents: number,
  extra: Partial<FlowTx> = {},
): FlowTx => ({
  id,
  accountId,
  amountCents,
  transferAccountId: null,
  transactionType: null,
  categorised: false,
  lineId: null,
  debtId: null,
  createdAt: '2026-01-15T09:00:00.000Z',
  automatic: false,
  description: null,
  ...extra,
})

export const pay1 = tx('pay1', 'spend', 320_000)
export const t1 = tx('t1', 'spend', -25_000, { transferAccountId: 'emer' })
export const t1c = tx('t1c', 'emer', 25_000, { transferAccountId: 'spend' })
export const t2 = tx('t2', 'emer', -20_000, { transferAccountId: 'spend' })
export const t2c = tx('t2c', 'spend', 20_000, { transferAccountId: 'emer' })
export const t3 = tx('t3', 'spend', -140_000, { transferAccountId: 'joint' })
export const t3c = tx('t3c', 'joint', 140_000, { transferAccountId: 'spend' })
export const g1 = tx('g1', 'spend', -43_000, { categorised: true, lineId: 'groc' })
export const ru = tx('ru', 'hol', 150, { transactionType: 'Round Up', transferAccountId: 'spend' })
export const ext = tx('ext', 'spend', -5_000)
export const rf = tx('rf', 'spend', 1_200, { categorised: true, lineId: 'groc' })
/** A debt repayment that also matches a budget line. */
export const rp = tx('rp', 'spend', -30_000, { debtId: 'd1', lineId: 'groc', categorised: true })

export const input = (txs: FlowTx[], over: Partial<FlowInput> = {}): FlowInput => ({
  scope: 'me',
  scopeLabel: 'Me',
  viewerId: 'u1',
  users: [
    { id: 'u1', name: 'Owner' },
    { id: 'u2', name: 'Sam' },
  ],
  accounts,
  scopeAccountIds: ['spend', 'emer', 'hol'],
  pays: [
    {
      userId: 'u1',
      userName: 'Owner',
      amountCents: 320_000,
      accountId: 'spend',
      txIds: ['pay1'],
      date: '2026-01-15',
      description: 'ACME PAY',
    },
  ],
  txs,
  lines: [],
  debts: [],
  ...over,
})

export const all = [pay1, t1, t1c, t2, t2c, t3, t3c, g1, ru, ext, rf]

export const lines: FlowLine[] = [
  { id: 'groc', name: 'Groceries', kind: 'spending', saverAccountId: null, colorToken: 'cat-groc' },
  { id: 'ef', name: 'Emergency fund', kind: 'fund', saverAccountId: 'emer', colorToken: 'cat-ef' },
]
export const debts = [{ id: 'd1', name: 'Car loan' }]

export const edgeMap = (g: { edges: { id: string; amountCents: number }[] }) =>
  Object.fromEntries(g.edges.map((e) => [e.id, e.amountCents]))
export const node = (g: FlowGraph, id: string) => g.nodes.find((n) => n.id === id)

/** Everyone scope with Sam paid twice into their own Spending: $3,000 on 15 Jan and 29 Jan. */
export const samTwice = (): Partial<FlowInput> => ({
  scope: 'everyone',
  scopeLabel: 'Everyone',
  scopeAccountIds: accounts.map((a) => a.id),
  pays: ['2026-01-15', '2026-01-29'].map((date, i) => ({
    userId: 'u2',
    userName: 'Sam',
    amountCents: 300_000,
    accountId: 'pspend',
    txIds: [`sp${i}`],
    date,
    description: 'BETA PAY',
  })),
})
export const samPays = [tx('sp0', 'pspend', 300_000), tx('sp1', 'pspend', 300_000)]
