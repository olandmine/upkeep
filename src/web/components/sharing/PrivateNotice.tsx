import type { SharedData } from '../../../shared/sharing'
import type { Scope } from '../../../shared/types'
import { sharingMessage, usePartnerHides, usePartnerSharing } from '../../lib/sharing'
import { Card } from '../ui/Card'

/**
 * Says why the other person's data is missing, so it isn't read as an empty page or a lower total.
 * Nothing shows in Me or Joint scope, where their personal data was never part of the page.
 */
export function PrivateNotice({ needs, scope }: { needs: SharedData; scope?: Scope }) {
  const partner = usePartnerSharing()
  const hides = usePartnerHides(needs, scope)
  if (!partner || !hides) return null
  const message = sharingMessage(partner.level, partner.name)
  if (!message) return null
  return (
    <Card role="status" className="p-4">
      <p className="type-caption text-fg-2">{message}</p>
    </Card>
  )
}
