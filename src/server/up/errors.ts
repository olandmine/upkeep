export class UpUnauthorizedError extends Error {
  constructor(message = 'Up rejected the token') {
    super(message)
    this.name = 'UpUnauthorizedError'
  }
}

/** Up returned a record our (lenient) schema still can't read, e.g. after an API change. */
export class UpParseError extends Error {
  readonly id: string

  constructor(id: string) {
    super(`Up returned transaction ${id} in a shape Upkeep can't read`)
    this.name = 'UpParseError'
    this.id = id
  }
}

export class UpApiError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(`Up API error ${status}: ${detail}`)
    this.name = 'UpApiError'
    this.status = status
    this.detail = detail
  }
}
