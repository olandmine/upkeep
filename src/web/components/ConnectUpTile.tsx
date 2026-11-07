import { Landmark } from 'lucide-react'
import { PlainLink, type LinkLike } from './AppLink'

/** Bento tile for the getting-started state: the one thing to do next. */
export function ConnectUpTile({ LinkComponent = PlainLink }: { LinkComponent?: LinkLike }) {
  return (
    <LinkComponent
      to="/settings"
      className="group relative flex max-w-md flex-col gap-6 overflow-hidden rounded-xl border border-line bg-raised p-6 transition-colors duration-150 hover:border-line-3"
    >
      <span
        aria-hidden
        className="absolute inset-0 opacity-70"
        style={{ background: 'radial-gradient(360px 220px at 80% 0%, var(--accent-muted), transparent 70%)' }}
      />
      <span className="relative flex size-10 items-center justify-center rounded-md bg-elevated text-accent">
        <Landmark aria-hidden size={20} strokeWidth={1.5} />
      </span>
      <span className="relative flex flex-col gap-1">
        <span className="font-serif text-[28px] leading-8 text-fg">Connect Up</span>
        <span className="type-body text-fg-2">Link your Up account to start tracking.</span>
      </span>
      <span className="type-caption relative text-accent">Bank connection →</span>
    </LinkComponent>
  )
}
