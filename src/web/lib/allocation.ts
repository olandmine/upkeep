export interface AllocationItem {
  key: string
  label: string
  cents: number
  colorToken: string
}

export interface AllocationSegment extends AllocationItem {
  percent: number
}

const MAX_SEGMENTS = 8

/** Share-of-total segments; positive values only, tail beyond 8 folded into slate "Other". */
export function allocationSegments(items: AllocationItem[]): AllocationSegment[] {
  const positive = items.filter((i) => i.cents > 0)
  const kept =
    positive.length > MAX_SEGMENTS
      ? [
          ...positive.slice(0, MAX_SEGMENTS - 1),
          {
            key: 'other',
            label: 'Other',
            colorToken: 'cat-slate',
            cents: positive.slice(MAX_SEGMENTS - 1).reduce((sum, i) => sum + i.cents, 0),
          },
        ]
      : positive
  const total = kept.reduce((sum, i) => sum + i.cents, 0)
  return kept.map((i) => ({ ...i, percent: total ? (i.cents / total) * 100 : 0 }))
}
