import type { AccountDto, TransactionDto } from '../../shared/types'

/** "This is my pay" applies to the viewer's own positive, non-transfer deposits on individual accounts. */
export function canMarkAsPay(tx: TransactionDto, accounts: AccountDto[], meId: string | undefined): boolean {
  const account = accounts.find((a) => a.id === tx.accountId)
  return (
    Boolean(meId) &&
    tx.amountCents > 0 &&
    !tx.isTransfer &&
    account?.ownership === 'INDIVIDUAL' &&
    account.ownerUserId === meId
  )
}

/** "This is a repayment…" applies to outflows that aren't internal transfers; the server checks the debt's accounts. */
export function canMarkAsRepayment(tx: TransactionDto): boolean {
  return tx.amountCents < 0 && !tx.transferAccountId
}
