import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import type { SyncStatusDto, UserDto } from '../../shared/types'
import { Onboarding } from '../components/Onboarding'
import { Button } from '../components/ui/Button'
import { Field, Input } from '../components/ui/Input'
import { client, errorMessage, UnauthorizedError, unwrap } from '../lib/api'
import { meQuery, syncStatusQuery } from '../lib/queries'

export const Route = createFileRoute('/connect')({
  beforeLoad: async ({ context }) => {
    let me: UserDto
    try {
      me = await context.queryClient.ensureQueryData(meQuery)
    } catch (err) {
      if (err instanceof UnauthorizedError) throw redirect({ to: '/login' })
      throw err
    }
    if (me.sharingLevel === null) throw redirect({ to: '/sharing' })
    if (me.connectUpAnswered) throw redirect({ to: '/' })
  },
  component: ConnectUpPage,
})

function ConnectUpPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: me } = useQuery(meQuery)
  const [token, setToken] = useState('')
  const [handle, setHandle] = useState(me?.upDisplayName ?? '')
  const typedHandle = handle.trim()

  const connect = useMutation({
    mutationFn: () =>
      unwrap<SyncStatusDto>(
        client.api.settings['up-token'].$put({
          json: { token: token.trim(), ...(typedHandle && { upDisplayName: typedHandle }) },
        }),
      ),
    onSuccess: (status) => {
      queryClient.setQueryData(syncStatusQuery.queryKey, status)
      // Set directly rather than refetched, so a failed refetch can't send them back here.
      queryClient.setQueryData(meQuery.queryKey, (m: UserDto | undefined) =>
        m && { ...m, connectUpAnswered: true, upDisplayName: typedHandle || m.upDisplayName },
      )
      void queryClient.invalidateQueries()
      void navigate({ to: '/' })
    },
  })
  const skip = useMutation({
    mutationFn: () =>
      unwrap<UserDto>(
        client.api.me.$patch({ json: { connectUpSkipped: true, ...(typedHandle && { upDisplayName: typedHandle }) } }),
      ),
    onSuccess: async (user) => {
      // A /me fetch still in flight would land after this and put the old answer back.
      await queryClient.cancelQueries({ queryKey: meQuery.queryKey })
      queryClient.setQueryData(meQuery.queryKey, user)
      void navigate({ to: '/' })
    },
  })
  const busy = connect.isPending || skip.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!busy && token.trim()) connect.mutate()
  }

  return (
    <Onboarding
      title="Connect your Up account."
      subtitle="Upkeep reads your accounts and transactions from Up to show where your money goes. It can't move your money."
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Up personal access token"
          error={connect.error ? errorMessage(connect.error) : null}
          hint="Create one in the Up app or at api.up.com.au. It is stored encrypted and never shown again."
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              data-1p-ignore
              spellCheck={false}
              placeholder="up:yeah:…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          )}
        </Field>
        <Field label="Your Up $handle (optional)" hint="So joint spending on 2Up is matched to you as it imports.">
          {(p) => (
            <Input
              {...p}
              autoComplete="off"
              maxLength={80}
              placeholder="$yourname"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          )}
        </Field>
        {skip.error && (
          <p role="alert" className="type-caption text-negative">
            {errorMessage(skip.error)}
          </p>
        )}
        <div className="mt-2 flex flex-col gap-2">
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !token.trim()}>
            Connect
          </Button>
          <Button variant="ghost" className="w-full" disabled={busy} onClick={() => skip.mutate()}>
            Skip for now
          </Button>
        </div>
      </form>
    </Onboarding>
  )
}
