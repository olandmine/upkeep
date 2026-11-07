export function formatRelative(iso: string, now: Date): string {
  const seconds = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

export function formatClock(iso: string, tz?: string): string {
  return new Intl.DateTimeFormat('en-AU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(
    new Date(iso),
  )
}
