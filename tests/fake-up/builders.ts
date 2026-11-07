import {
  UpAccountSchema,
  UpTransactionSchema,
  type UpAccount,
  type UpMoney,
  type UpTransaction,
} from '../../src/server/up/schemas'

export const money = (cents: number, currencyCode = 'AUD'): UpMoney => ({
  currencyCode,
  value: (cents / 100).toFixed(2),
  valueInBaseUnits: cents,
})

const ref = (type: string, id: string | null | undefined) => ({ data: id ? { type, id } : null })

export function buildAccount(p: {
  id: string
  displayName?: string
  accountType?: 'TRANSACTIONAL' | 'SAVER' | 'HOME_LOAN'
  ownershipType?: 'INDIVIDUAL' | 'JOINT'
  balanceCents?: number
  createdAt?: string
}): UpAccount {
  return UpAccountSchema.parse({
    type: 'accounts',
    id: p.id,
    attributes: {
      displayName: p.displayName ?? p.id,
      accountType: p.accountType ?? 'TRANSACTIONAL',
      ownershipType: p.ownershipType ?? 'INDIVIDUAL',
      balance: money(p.balanceCents ?? 0),
      createdAt: p.createdAt ?? '2020-01-01T00:00:00+11:00',
    },
    relationships: { transactions: { links: { related: `https://fake-up.test/api/v1/accounts/${p.id}/transactions` } } },
  })
}

export function buildTransaction(p: {
  id: string
  accountId: string
  amountCents: number
  createdAt: string
  status?: 'HELD' | 'SETTLED'
  description?: string
  message?: string | null
  rawText?: string | null
  categoryId?: string | null
  parentCategoryId?: string | null
  isCategorizable?: boolean
  transferAccountId?: string | null
  roundUpCents?: number | null
  cashbackCents?: number | null
  foreignAmountCents?: number | null
  foreignCurrency?: string
  cardMethod?: string | null
  cardSuffix?: string | null
  performingCustomer?: string | null
  transactionType?: string | null
  tags?: string[]
}): UpTransaction {
  const status = p.status ?? 'SETTLED'
  return UpTransactionSchema.parse({
    type: 'transactions',
    id: p.id,
    attributes: {
      status,
      rawText: p.rawText ?? null,
      description: p.description ?? 'Merchant',
      message: p.message ?? null,
      isCategorizable: p.isCategorizable ?? true,
      holdInfo: null,
      roundUp: p.roundUpCents ? { amount: money(p.roundUpCents), boostPortion: null } : null,
      cashback: p.cashbackCents ? { description: 'Cashback', amount: money(p.cashbackCents) } : null,
      amount: money(p.amountCents),
      foreignAmount: p.foreignAmountCents ? money(p.foreignAmountCents, p.foreignCurrency ?? 'USD') : null,
      cardPurchaseMethod: p.cardMethod ? { method: p.cardMethod, cardNumberSuffix: p.cardSuffix ?? null } : null,
      settledAt: status === 'SETTLED' ? p.createdAt : null,
      createdAt: p.createdAt,
      performingCustomer: p.performingCustomer ? { displayName: p.performingCustomer } : null,
      transactionType: p.transactionType ?? null,
    },
    relationships: {
      account: { data: { type: 'accounts', id: p.accountId } },
      transferAccount: ref('accounts', p.transferAccountId),
      category: ref('categories', p.categoryId),
      parentCategory: ref('categories', p.parentCategoryId),
      tags: { data: (p.tags ?? []).map((id) => ({ type: 'tags', id })) },
    },
  })
}
