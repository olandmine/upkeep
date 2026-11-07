import { expect, test } from 'vitest'
import { formatRelative } from '../../src/web/lib/relative-time'

const now = new Date('2026-10-29T10:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

test('formatRelative', () => {
  expect(formatRelative(ago(30_000), now)).toBe('just now')
  expect(formatRelative(ago(2 * 60_000), now)).toBe('2 min ago')
  expect(formatRelative(ago(3 * 3_600_000), now)).toBe('3 h ago')
  expect(formatRelative(ago(2 * 86_400_000), now)).toBe('2 d ago')
})
