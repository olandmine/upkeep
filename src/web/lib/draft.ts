import { useEffect, useState } from 'react'

const PREFIX = 'upkeep:draft:'

// Storage can be missing or refuse writes (private windows, blocked site data): a draft is then just state.
function read<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    return raw === null ? undefined : (JSON.parse(raw) as T)
  } catch {
    return undefined
  }
}

/**
 * useState that survives this tab reloading, as a phone browser does when it comes back from the background.
 * A null key is plain state. Drafts last until `clearDrafts` or the tab closes.
 */
export function useDraft<T>(key: string | null, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    const saved = key === null ? undefined : read<T>(key)
    if (saved !== undefined) return saved
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })
  useEffect(() => {
    if (key === null) return
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      // Not saved; the form still works.
    }
  }, [key, value])
  return [value, setValue] as const
}

/** Forgets every draft whose key starts with `prefix`. */
export function clearDrafts(prefix: string) {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(PREFIX + prefix)) sessionStorage.removeItem(key)
    }
  } catch {
    // Nothing was saved.
  }
}
