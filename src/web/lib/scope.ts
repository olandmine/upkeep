import { useNavigate, useSearch } from '@tanstack/react-router'
import type { Scope } from '../../shared/types'

const SCOPES: Scope[] = ['everyone', 'me', 'partner', 'joint']
export const isScope = (v: unknown): v is Scope => SCOPES.includes(v as Scope)

/** A link's `search`: the current scope and nothing else from the page being left, such as its range. */
export const keepScope = ((prev: { scope?: unknown }) => ({ scope: prev.scope })) as never

/** The Everyone/Me/Partner/Joint switcher lives in the URL (`?scope=`), so it survives reloads and links. */
export function useScope(): [Scope, (scope: Scope) => void] {
  const search = useSearch({ strict: false }) as { scope?: unknown }
  const navigate = useNavigate()
  const scope = isScope(search.scope) ? search.scope : 'everyone'
  const setScope = (next: Scope) =>
    void navigate({
      to: '.',
      search: ((prev: Record<string, unknown>) => ({ ...prev, scope: next === 'everyone' ? undefined : next })) as never,
      replace: true,
    })
  return [scope, setScope]
}
