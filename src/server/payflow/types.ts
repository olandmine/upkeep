import type { PayFlowDto, Scope } from '../../shared/types'

export interface FlowAccount {
  id: string
  name: string
  type: string
  ownership: 'INDIVIDUAL' | 'JOINT'
  ownerUserId: string | null
  colorToken: string
}

export interface FlowPay {
  userId: string
  userName: string
  amountCents: number
  accountId: string | null
  txIds: string[]
  date: string
  description: string | null
}

export interface FlowTx {
  id: string
  accountId: string
  amountCents: number
  transferAccountId: string | null
  transactionType: string | null
  categorised: boolean
  lineId: string | null
  debtId: string | null
  /** ISO timestamp. */
  createdAt: string
  /** Up did it, not a person (no performing customer): pay splits and other automatic transfers. */
  automatic: boolean
  description: string | null
}

export interface FlowLine {
  id: string
  name: string
  kind: 'spending' | 'fund'
  saverAccountId: string | null
  colorToken: string
  /** On a Joint budget; the planned views send these to the Joint account. */
  joint?: boolean
}

export interface FlowInput {
  scope: Scope
  scopeLabel: 'Me' | 'Partner' | 'Joint' | 'Everyone'
  viewerId: string
  users: { id: string; name: string }[]
  /** Every synced account. */
  accounts: FlowAccount[]
  scopeAccountIds: string[]
  pays: FlowPay[]
  /** In the cycle, on or into scope accounts, deleted excluded. */
  txs: FlowTx[]
  /** Lines of the budgets in scope. */
  lines: FlowLine[]
  debts: { id: string; name: string }[]
}

export type FlowGraph = Pick<PayFlowDto, 'nodes' | 'edges' | 'baseCents' | 'baseLabel' | 'overAllocatedCents'>
