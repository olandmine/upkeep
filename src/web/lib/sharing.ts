import { useQuery } from '@tanstack/react-query'
import { levelAllows, type SharedData, type SharingLevel } from '../../shared/sharing'
import type { Scope } from '../../shared/types'
import { meQuery, usersQuery } from './queries'

/** Why some of the other person's data isn't shown; `null` when they share everything. */
export function sharingMessage(level: SharingLevel | null, name: string): string | null {
  switch (level) {
    case 'full':
      return null
    case 'hide-transactions':
      return `${name} keeps their transactions private.`
    case 'balances':
      return `${name} shares account balances only.`
    case 'none':
      return `${name} doesn't share their personal accounts.`
    case null:
      return `${name} hasn't chosen what to share yet.`
  }
}

/** The other person's name and sharing level, or `null` while unknown or when there is no one else. */
export function usePartnerSharing(): { name: string; level: SharingLevel | null } | null {
  const { data: me } = useQuery(meQuery)
  const { data: users = [] } = useQuery(usersQuery)
  const partner = me ? users.find((u) => u.id !== me.id) : undefined
  if (!partner) return null
  // A user from an older server comes back without a level, which shares nothing.
  return { name: partner.displayName, level: partner.sharingLevel ?? null }
}

/**
 * Whether the other person's sharing level leaves `needs` out of a page. Always false in Me and Joint
 * scope, where their personal data was never part of the page, and with no partner.
 */
export function usePartnerHides(needs: SharedData, scope?: Scope): boolean {
  const partner = usePartnerSharing()
  return Boolean(partner && scope !== 'me' && scope !== 'joint' && !levelAllows(partner.level, needs))
}
