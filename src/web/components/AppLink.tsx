import { Link } from '@tanstack/react-router'
import type { ComponentType, ReactNode } from 'react'

/** Lets presentational components link without a router in tests: they default to <a>, routes pass RouterLink. */
export type LinkLike = ComponentType<{ to: string; className?: string; 'aria-label'?: string; children: ReactNode }>

export const PlainLink: LinkLike = ({ to, ...props }) => <a href={to} {...props} />

export const RouterLink: LinkLike = ({ to, ...props }) => {
  const [path, hash] = to.split('#')
  return (
    <Link
      to={path as never}
      hash={hash}
      search={((prev: { scope?: string }) => ({ scope: prev.scope })) as never}
      {...props}
    />
  )
}

/** For hrefs that carry their own query string (budget lines → filtered transactions). */
export const SearchLink: LinkLike = ({ to, ...props }) => {
  const url = new URL(to, 'http://x')
  return <Link to={url.pathname as never} search={Object.fromEntries(url.searchParams) as never} {...props} />
}
