/** A budget rule the caller broke; routes turn it into `{ error: message }` with `status`. */
export class BudgetError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = 'BudgetError'
  }
}
