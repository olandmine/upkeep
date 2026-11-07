import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
  // Form drafts live in session storage; each test starts without them.
  sessionStorage.clear()
})
