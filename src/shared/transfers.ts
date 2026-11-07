// Up records a move between our own accounts as two transactions and doesn't link them to each other.

/** Both sides arrive within seconds; this leaves room without catching an unrelated transfer of the same amount. */
export const TRANSFER_PAIR_WINDOW_MS = 60_000

export interface TransferLeg {
  id: string
  accountId: string
  transferAccountId: string | null
  amountCents: number
  createdAt: string
  isTransfer: boolean
}

const route = (from: string, to: string, cents: number) => `${from}|${to}|${cents}`

/** The two sides of each transfer in `items`, as [outgoing, incoming]. The closest in time wins, and a side is used once. */
export function pairTransfers<T extends TransferLeg>(items: readonly T[]): [T, T][] {
  const incoming = new Map<string, T[]>()
  for (const tx of items) {
    if (!tx.isTransfer || !tx.transferAccountId || tx.amountCents <= 0) continue
    const key = route(tx.transferAccountId, tx.accountId, tx.amountCents)
    incoming.set(key, [...(incoming.get(key) ?? []), tx])
  }
  const used = new Set<string>()
  const pairs: [T, T][] = []
  for (const out of items) {
    if (!out.isTransfer || !out.transferAccountId || out.amountCents >= 0) continue
    const time = Date.parse(out.createdAt)
    let best: T | null = null
    let bestGap = Infinity
    for (const candidate of incoming.get(route(out.accountId, out.transferAccountId, -out.amountCents)) ?? []) {
      const gap = Math.abs(Date.parse(candidate.createdAt) - time)
      if (!used.has(candidate.id) && gap <= TRANSFER_PAIR_WINDOW_MS && gap < bestGap) {
        best = candidate
        bestGap = gap
      }
    }
    if (best) {
      used.add(best.id)
      pairs.push([out, best])
    }
  }
  return pairs
}
