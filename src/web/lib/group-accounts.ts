import { PALETTE } from '../../shared/categories'
import type { AccountDto } from '../../shared/types'

export type AccountGroupLabel = 'Spending' | 'Savers · Personal' | 'Savers · Joint' | 'Home loan'

export interface AccountGroup {
  label: AccountGroupLabel
  accounts: AccountDto[]
  totalCents: number
}

const GROUPS: { label: AccountGroupLabel; type: string; ownership?: AccountDto['ownership'] }[] = [
  { label: 'Spending', type: 'TRANSACTIONAL' },
  { label: 'Savers · Personal', type: 'SAVER', ownership: 'INDIVIDUAL' },
  { label: 'Savers · Joint', type: 'SAVER', ownership: 'JOINT' },
  { label: 'Home loan', type: 'HOME_LOAN' },
]

export const accountColorToken = (a: AccountDto) => PALETTE[a.colorIndex % PALETTE.length]!

/** The groups that have accounts, in a fixed order, each with its largest balance first. */
export function groupAccounts(accounts: AccountDto[]): AccountGroup[] {
  return GROUPS.map(({ label, type, ownership }) => {
    const members = accounts
      .filter((a) => a.accountType === type && (!ownership || a.ownership === ownership))
      .sort((a, b) => b.balanceCents - a.balanceCents)
    return { label, accounts: members, totalCents: members.reduce((sum, a) => sum + a.balanceCents, 0) }
  }).filter((g) => g.accounts.length > 0)
}
