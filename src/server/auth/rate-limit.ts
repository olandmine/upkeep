const WINDOW_MS = 15 * 60_000
const MAX_FAILURES = 5

/** In-memory login throttle: 5 failures per username per 15 minutes. */
export class LoginLimiter {
  private failures = new Map<string, number[]>()

  private recent(username: string, now: Date): number[] {
    const key = username.toLowerCase()
    const kept = (this.failures.get(key) ?? []).filter((t) => now.getTime() - t < WINDOW_MS)
    this.failures.set(key, kept)
    return kept
  }

  isBlocked(username: string, now: Date): boolean {
    return this.recent(username, now).length >= MAX_FAILURES
  }

  fail(username: string, now: Date): void {
    this.recent(username, now).push(now.getTime())
  }

  reset(username: string): void {
    this.failures.delete(username.toLowerCase())
  }
}
