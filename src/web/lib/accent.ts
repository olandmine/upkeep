import { useLayoutEffect } from 'react'
import type { Accent } from '../../shared/accent'

/** Applies a person's highlight colour for as long as the caller is mounted. Amber is the stylesheet's default. */
export function useAccent(accent: Accent) {
  useLayoutEffect(() => {
    const root = document.documentElement
    if (accent === 'amber') delete root.dataset.accent
    else root.dataset.accent = accent
    return () => {
      delete root.dataset.accent
    }
  }, [accent])
}
