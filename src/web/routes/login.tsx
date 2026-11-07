import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import type { UserDto } from '../../shared/types'
import { Onboarding } from '../components/Onboarding'
import { Button } from '../components/ui/Button'
import { Field, Input } from '../components/ui/Input'
import { client, errorMessage, unwrap } from '../lib/api'
import { meQuery, setupStatusQuery } from '../lib/queries'

export const Route = createFileRoute('/login')({
  beforeLoad: async ({ context }) => {
    const { needsSetup } = await context.queryClient.fetchQuery(setupStatusQuery)
    if (needsSetup) throw redirect({ to: '/setup' })
  },
  component: LoginPage,
})

function LoginPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '' })
  const login = useMutation({
    mutationFn: () => unwrap<UserDto>(client.api.auth.login.$post({ json: form })),
    onSuccess: (user) => {
      queryClient.clear()
      queryClient.setQueryData(meQuery.queryKey, user)
      void navigate({ to: '/' })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate()
  }

  return (
    <Onboarding title="Welcome back.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Username">
          {(p) => (
            <Input
              {...p}
              autoComplete="username"
              autoFocus
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          )}
        </Field>
        <Field label="Password" error={login.error ? errorMessage(login.error) : null}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" className="mt-2 w-full" disabled={login.isPending}>
          Log in
        </Button>
      </form>
    </Onboarding>
  )
}
