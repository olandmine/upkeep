import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import type { UserDto } from '../../shared/types'
import { Onboarding } from '../components/Onboarding'
import { Button } from '../components/ui/Button'
import { Field, Input } from '../components/ui/Input'
import { client, errorMessage, unwrap } from '../lib/api'
import { meQuery, setupStatusQuery } from '../lib/queries'

export const Route = createFileRoute('/setup')({
  beforeLoad: async ({ context }) => {
    const { needsSetup } = await context.queryClient.fetchQuery(setupStatusQuery)
    if (!needsSetup) throw redirect({ to: '/' })
  },
  component: SetupPage,
})

function SetupPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState({ displayName: '', username: '', password: '' })
  const create = useMutation({
    mutationFn: () => unwrap<UserDto>(client.api.setup.$post({ json: form })),
    onSuccess: (user) => {
      queryClient.setQueryData(meQuery.queryKey, user)
      queryClient.setQueryData(setupStatusQuery.queryKey, { needsSetup: false })
      void navigate({ to: '/' })
    },
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }

  return (
    <Onboarding title="Welcome to Upkeep." subtitle="Create your login to get started.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Your name">
          {(p) => <Input {...p} autoComplete="name" required value={form.displayName} onChange={set('displayName')} />}
        </Field>
        <Field label="Username">
          {(p) => <Input {...p} autoComplete="username" required value={form.username} onChange={set('username')} />}
        </Field>
        <Field label="Password" hint="At least 8 characters" error={create.error ? errorMessage(create.error) : null}>
          {(p) => (
            <Input {...p} type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} />
          )}
        </Field>
        <Button type="submit" variant="primary" className="mt-2 w-full" disabled={create.isPending}>
          Create account
        </Button>
      </form>
    </Onboarding>
  )
}
