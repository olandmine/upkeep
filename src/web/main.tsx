import './styles/fonts'
import './styles/tokens.css'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from './components/ui/Toast'
import { ApiError, UnauthorizedError } from './lib/api'
import { routeTree } from './routeTree.gen'

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof UnauthorizedError) void router.navigate({ to: '/login' })
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
})

const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent', scrollRestoration: true })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
