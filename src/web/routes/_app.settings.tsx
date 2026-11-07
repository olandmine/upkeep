import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { PayScheduleDto, SyncStatusDto, TransactionDto, UserDto } from '../../shared/types'
import { AppearanceCard } from '../components/settings/AppearanceCard'
import { BankConnectionCard } from '../components/settings/BankConnectionCard'
import { PayCard } from '../components/settings/PayCard'
import { ProfileCard, type ProfilePatch } from '../components/settings/ProfileCard'
import { SharingCard } from '../components/settings/SharingCard'
import { UsersCard } from '../components/settings/UsersCard'
import { Page } from '../components/shell/PageHeader'
import { useToast } from '../components/ui/Toast'
import { client, errorMessage, unwrap } from '../lib/api'
import { meQuery, payEventsQuery, payScheduleQuery, syncStatusQuery, usersQuery } from '../lib/queries'

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: me } = useQuery(meQuery)
  const { data: status } = useQuery(syncStatusQuery)
  const { data: users = [] } = useQuery(usersQuery)
  const { data: schedule } = useQuery(payScheduleQuery)
  const { data: events = [] } = useQuery({ ...payEventsQuery(me?.id ?? ''), enabled: Boolean(me) })
  const { data: exclusions = [] } = useQuery({
    queryKey: ['pay-exclusions'],
    queryFn: () => unwrap<TransactionDto[]>(client.api['pay-exclusions'].$get()),
  })
  const payChanged = () =>
    Promise.all(
      [['pay-schedule'], ['pay-events'], ['pay-exclusions'], ['budgets'], ['budget-period'], ['pay-plan'], ['standard-pay']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    )
  const payAction = async (run: () => Promise<unknown>) => {
    try {
      await run()
      await payChanged()
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const mine = status?.connections.find((c) => c.userId === me?.id)
  const others = status?.connections.filter((c) => c.userId !== me?.id) ?? []
  const setStatus = (s: SyncStatusDto) => {
    queryClient.setQueryData(syncStatusQuery.queryKey, s)
    void queryClient.invalidateQueries()
  }

  if (!me) return null
  return (
    <Page title="Settings" showScope={false}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <BankConnectionCard
            connection={mine}
            now={now}
            onConnect={async (token) => {
              setStatus(await unwrap<SyncStatusDto>(client.api.settings['up-token'].$put({ json: { token } })))
              toast('Connected to Up. Importing your history…', 'success')
            }}
            onDisconnect={async () => {
              try {
                setStatus(await unwrap<SyncStatusDto>(client.api.settings['up-token'].$delete()))
              } catch (err) {
                toast(errorMessage(err), 'error')
              }
            }}
            onSyncNow={async () => {
              try {
                setStatus(await unwrap<SyncStatusDto>(client.api.sync.run.$post()))
              } catch (err) {
                toast(errorMessage(err), 'error')
              }
            }}
          />
          {others.map((c) => (
            <p key={c.userId} className="type-caption px-1 text-fg-3">
              {c.displayName}&rsquo;s Up connection: {c.status === 'ok' ? 'connected' : 'needs attention'}
            </p>
          ))}
          <UsersCard
            users={users}
            onAddPartner={async (input) => {
              await unwrap<UserDto>(client.api.users.$post({ json: input }))
              await queryClient.invalidateQueries({ queryKey: usersQuery.queryKey })
              toast(`Login created for ${input.displayName}.`, 'success')
            }}
          />
        </div>
        <div className="flex flex-col gap-4">
          <ProfileCard
            key={me.id}
            me={me}
            onSave={async (patch: ProfilePatch) => {
              const updated = await unwrap<UserDto>(client.api.me.$patch({ json: patch }))
              queryClient.setQueryData(meQuery.queryKey, updated)
              toast(patch.newPassword ? 'Password changed.' : 'Profile saved.', 'success')
            }}
          />
          <AppearanceCard value={me.accent} />
          <SharingCard
            value={me.sharingLevel}
            onSave={async (sharingLevel) => {
              const updated = await unwrap<UserDto>(client.api.me.$patch({ json: { sharingLevel } }))
              queryClient.setQueryData(meQuery.queryKey, updated)
              await queryClient.invalidateQueries({ queryKey: usersQuery.queryKey })
            }}
          />
          {schedule !== undefined && (
            <PayCard
              key={schedule ? `${schedule.descriptionMatch}-${schedule.minAmountCents}` : 'none'}
              schedule={schedule}
              events={events}
              exclusions={exclusions}
              onSave={(patch) =>
                payAction(async () => {
                  await unwrap<PayScheduleDto>(client.api['pay-schedule'].$put({ json: patch }))
                  toast('Pay settings saved.', 'success')
                })
              }
              onUndo={(transactionId) =>
                void payAction(() => unwrap(client.api['pay-exclusions'][':transactionId'].$delete({ param: { transactionId } })))
              }
              onNotMyPay={(payDate) =>
                void payAction(() => unwrap(client.api['pay-events'][':payDate'].$delete({ param: { payDate } })))
              }
              onDelete={() => void payAction(() => unwrap(client.api['pay-schedule'].$delete()))}
            />
          )}
        </div>
      </div>
    </Page>
  )
}
