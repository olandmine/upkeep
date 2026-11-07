// Transfers between our own accounts are excluded from income and spending.

const DAY_MS = 86_400_000

export function isTransfer(
  t: { transferAccountId: string | null; description: string },
  knownAccountIds: Set<string>,
): boolean {
  return t.transferAccountId !== null && knownAccountIds.has(t.transferAccountId)
}

export interface PairCandidate {
  id: string
  accountId: string
  ownerUserId: string | null
  amountCents: number
  createdAt: string
  transferAccountId: string | null
}

/**
 * Pairs money moved between the two partners' personal accounts, which Up does not link with
 * transferAccount. Returns [outgoingId, incomingId] pairs. Not wired into sync until verified
 * against real data from both tokens.
 */
export function findCrossPartnerTransferPairs(rows: PairCandidate[]): [string, string][] {
  const eligible = rows.filter((r) => r.ownerUserId !== null && r.transferAccountId === null)
  const incoming = eligible.filter((r) => r.amountCents > 0)
  const used = new Set<string>()
  const pairs: [string, string][] = []

  for (const out of eligible.filter((r) => r.amountCents < 0)) {
    const outTime = Date.parse(out.createdAt)
    let best: PairCandidate | null = null
    let bestGap = Infinity
    for (const inc of incoming) {
      if (used.has(inc.id) || inc.ownerUserId === out.ownerUserId || inc.amountCents !== -out.amountCents) continue
      const gap = Math.abs(Date.parse(inc.createdAt) - outTime)
      if (gap <= DAY_MS && gap < bestGap) {
        best = inc
        bestGap = gap
      }
    }
    if (best) {
      used.add(best.id)
      pairs.push([out.id, best.id])
    }
  }
  return pairs
}
