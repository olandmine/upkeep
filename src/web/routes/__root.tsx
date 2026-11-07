import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { Onboarding } from '../components/Onboarding'
import { Button } from '../components/ui/Button'

export interface RouterContext {
  queryClient: QueryClient
}

function RootError({ reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <Onboarding title="Can't reach Upkeep." subtitle="The server isn't responding. If you just started it, give it a moment.">
      <Button
        variant="primary"
        onClick={() => {
          reset()
          void router.invalidate()
        }}
      >
        Try again
      </Button>
    </Onboarding>
  )
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: RootError,
})
