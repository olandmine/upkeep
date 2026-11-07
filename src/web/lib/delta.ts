/** Month-over-month change, e.g. '▲ 4.2% vs last month'. Null when there's no previous value to compare. */
export function formatDelta(current: number, previous: number): { text: string; direction: 'up' | 'down' | 'flat' } | null {
  if (previous === 0) return null
  const change = ((current - previous) / Math.abs(previous)) * 100
  const pct = `${Math.abs(change).toFixed(1)}%`
  if (Math.abs(change) < 0.05) return { text: `${(0).toFixed(1)}% vs last month`, direction: 'flat' }
  return change > 0 ? { text: `▲ ${pct} vs last month`, direction: 'up' } : { text: `▼ ${pct} vs last month`, direction: 'down' }
}
