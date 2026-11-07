import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import type { SharingLevel } from '../../shared/sharing'
import type { UserDto } from '../../shared/types'
import { Onboarding } from '../components/Onboarding'
import { SharingCaveats, SharingLevelOptions } from '../components/sharing/SharingLevelOptions'
import { Button } from '../components/ui/Button'
import { client, errorMessage, UnauthorizedError, unwrap } from '../lib/api'
import { meQuery } from '../lib/queries'

export const Route = createFileRoute('/sharing')({
  beforeLoad: async ({ context }) => {
    let me: UserDto
    try {
      me = await context.queryClient.ensureQueryData(meQuery)
    } catch (err) {
      if (err instanceof UnauthorizedError) throw redirect({ to: '/login' })
      throw err
    }
    if (me.sharingLevel !== null) throw redirect({ to: '/' })
  },
  component: SharingPage,
})

function SharingPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [level, setLevel] = useState<SharingLevel | null>(null)
  const save = useMutation({
    mutationFn: (sharingLevel: SharingLevel) => unwrap<UserDto>(client.api.me.$patch({ json: { sharingLevel } })),
    onSuccess: (user) => {
      queryClient.setQueryData(meQuery.queryKey, user)
      void navigate({ to: '/' })
    },
  })

  return (
    <Onboarding title="What can your partner see?">
      <div className="flex flex-col gap-4">
        <SharingLevelOptions value={level} onChange={setLevel} disabled={save.isPending} />
        <p className="type-caption text-fg-3">Joint accounts are always shared. You can change this any time in Settings.</p>
        <SharingCaveats />
        {save.error && (
          <p role="alert" className="type-caption text-negative">
            {errorMessage(save.error)}
          </p>
        )}
        <Button
          variant="primary"
          className="mt-2 w-full"
          disabled={level === null || save.isPending}
          onClick={() => level && save.mutate(level)}
        >
          Continue
        </Button>
      </div>
    </Onboarding>
  )
}
