/** As a Transactions category filter: spending with no category that Up lets you categorise. */
export const UNCATEGORISED = 'uncategorised'

// Category colours: a category keeps its parent's colour everywhere.

const FIXED: Record<string, string> = {
  home: 'cat-blue',
  'good-life': 'cat-orange',
  personal: 'cat-violet',
  transport: 'cat-yellow',
}
const SPARE = ['cat-teal', 'cat-green', 'cat-rose']
const FALLBACK = 'cat-slate'

/** Palette token for a parent category; `null` (uncategorised) is slate. */
export function categoryColorToken(parentId: string | null, parentIds: string[]): string {
  if (parentId === null) return FALLBACK
  if (FIXED[parentId]) return FIXED[parentId]
  const others = [...new Set(parentIds.filter((id) => !FIXED[id]))].sort()
  return SPARE[others.indexOf(parentId)] ?? FALLBACK
}

/**
 * Account colours by `colorIndex`. Teal next to green fails the normal-vision separation check
 * on the dark surface (ΔE 9.6 < 15), so neighbours are spaced apart.
 */
export const PALETTE = ['cat-blue', 'cat-orange', 'cat-teal', 'cat-violet', 'cat-yellow', 'cat-rose', 'cat-green', 'cat-slate']
