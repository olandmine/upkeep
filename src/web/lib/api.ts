import { hc } from 'hono/client'
import type { AppType } from '../../server/app'

export class ApiError extends Error {
  readonly status: number
  readonly detail?: string

  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Not logged in') {
    super(401, message)
    this.name = 'UnauthorizedError'
  }
}

// Every request is JSON (the server's CSRF guard requires it) and same-origin.
const jsonFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(input, { ...init, headers, credentials: 'same-origin' })
}

const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
export const client = hc<AppType>(base, { fetch: jsonFetch })

interface ResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

/** Resolves to the JSON body, or throws ApiError with the server's `error` (and Up's `detail`). */
export async function unwrap<T>(pending: Promise<ResponseLike> | ResponseLike): Promise<T> {
  const res = await pending
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T
  let body: { error?: string; detail?: string } = {}
  try {
    body = (await res.json()) as typeof body
  } catch {
    // non-JSON error body
  }
  const message = body.error ?? `Request failed (${res.status})`
  if (res.status === 401) throw new UnauthorizedError(message)
  throw new ApiError(res.status, message, body.detail)
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail ? `${err.message}: ${err.detail}` : err.message
  return 'Something went wrong'
}
