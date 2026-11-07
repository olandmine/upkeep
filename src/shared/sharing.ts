// How much of their finances a person shows the other person, most to least.
export const SHARING_LEVELS = ['full', 'hide-transactions', 'balances', 'none'] as const
export type SharingLevel = (typeof SHARING_LEVELS)[number]

/** What a viewer can be shown: account balances, budget/debt/saving figures, or individual transactions. */
export type SharedData = 'balances' | 'finances' | 'transactions'

const ALLOWED: Record<SharingLevel, readonly SharedData[]> = {
  full: ['balances', 'finances', 'transactions'],
  'hide-transactions': ['balances', 'finances'],
  balances: ['balances'],
  none: [],
}

/** `null` (not chosen yet) shares nothing, like `none`. */
export function levelAllows(level: SharingLevel | null, data: SharedData): boolean {
  return level !== null && ALLOWED[level].includes(data)
}
