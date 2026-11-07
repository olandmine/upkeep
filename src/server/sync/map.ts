import type { NewTransactionRow, UserRow } from '../db/schema'
import type { UpTransaction } from '../up/schemas'
import { isTransfer } from './transfers'

export interface MapContext {
  users: Pick<UserRow, 'id' | 'upDisplayName'>[]
  knownAccountIds: Set<string>
  syncedAt: string
}

const toUtc = (iso: string) => new Date(iso).toISOString()
// Up reports the customer's $handle; accept it typed with or without the "$".
const handleKey = (name: string) => name.trim().replace(/^\$/, '').toLowerCase()

export function mapTransaction(tx: UpTransaction, ctx: MapContext): { row: NewTransactionRow; tags: string[] } {
  const a = tx.attributes
  const r = tx.relationships
  const transferAccountId = r.transferAccount.data?.id ?? null
  const performer = a.performingCustomer?.displayName ?? null
  const performedBy = performer
    ? (ctx.users.find((u) => u.upDisplayName && handleKey(u.upDisplayName) === handleKey(performer))?.id ?? null)
    : null

  return {
    row: {
      id: tx.id,
      accountId: r.account.data.id,
      status: a.status,
      amountCents: a.amount.valueInBaseUnits,
      currency: a.amount.currencyCode,
      foreignAmountCents: a.foreignAmount?.valueInBaseUnits ?? null,
      foreignCurrency: a.foreignAmount?.currencyCode ?? null,
      description: a.description,
      message: a.message ?? null,
      rawText: a.rawText ?? null,
      categoryId: r.category.data?.id ?? null,
      parentCategoryId: r.parentCategory.data?.id ?? null,
      isCategorizable: a.isCategorizable,
      roundUpCents: a.roundUp?.amount.valueInBaseUnits ?? null,
      cashbackCents: a.cashback?.amount.valueInBaseUnits ?? null,
      cardMethod: a.cardPurchaseMethod?.method ?? null,
      cardSuffix: a.cardPurchaseMethod?.cardNumberSuffix ?? null,
      transferAccountId,
      isTransfer: isTransfer({ transferAccountId, description: a.description }, ctx.knownAccountIds),
      performingCustomer: performer,
      performedByUserId: performedBy,
      transactionType: a.transactionType ?? null,
      createdAt: toUtc(a.createdAt),
      settledAt: a.settledAt ? toUtc(a.settledAt) : null,
      deletedAt: null,
      rawJson: JSON.stringify(tx),
      syncedAt: ctx.syncedAt,
    },
    tags: r.tags.data.map((t) => t.id),
  }
}
