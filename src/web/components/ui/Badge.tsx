import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Tone = 'positive' | 'negative' | 'warning' | 'info' | 'neutral'

const TONES: Record<Tone, string> = {
  positive: 'bg-positive-muted text-positive',
  negative: 'bg-negative-muted text-negative',
  warning: 'bg-warning-muted text-warning',
  info: 'bg-info-muted text-info',
  neutral: 'bg-elevated text-fg-2',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('type-caption inline-flex h-5 items-center gap-1 rounded-xs px-1.5', TONES[tone], className)}>
      {children}
    </span>
  )
}

/** Category/account colour dot: 8px, never the only signal. */
export function Dot({ token, className }: { token: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: `var(--${token})` }} />
}
