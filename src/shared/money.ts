// Money formatting. All amounts are integer cents.

const LOCALE = 'en-AU'
const MINUS = '−' // U+2212

export type NegativeStyle = 'minus' | 'parentheses'

export interface FormatMoneyOptions {
  currency?: string
  negativeStyle?: NegativeStyle
  signDisplay?: 'auto' | 'always'
}

const formatters = new Map<string, Intl.NumberFormat>()

function currencyFormatter(currency: string, extra: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${currency}|${JSON.stringify(extra)}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, ...extra })
    formatters.set(key, f)
  }
  return f
}

function absFormatted(cents: number, currency: string, extra?: Intl.NumberFormatOptions): string {
  return currencyFormatter(currency, extra).format(Math.abs(cents) / 100)
}

export function formatMoney(cents: number, opts: FormatMoneyOptions = {}): string {
  const { currency = 'AUD', negativeStyle = 'minus', signDisplay = 'auto' } = opts
  const body = absFormatted(cents, currency)
  if (cents < 0) return negativeStyle === 'parentheses' ? `(${body})` : `${MINUS}${body}`
  if (cents > 0 && signDisplay === 'always') return `+${body}`
  return body
}

export function splitHero(cents: number): { sign: '' | '−'; whole: string; fraction: string } {
  const body = absFormatted(cents, 'AUD')
  const dot = body.lastIndexOf('.')
  return {
    sign: cents < 0 ? MINUS : '',
    whole: dot === -1 ? body : body.slice(0, dot),
    fraction: dot === -1 ? '' : body.slice(dot),
  }
}

export function formatCompact(cents: number, currency = 'AUD'): string {
  // Whole dollars below $1k: nothing is abbreviated there, and "$842.1" would read as a misprinted amount.
  const maximumFractionDigits = Math.abs(cents) < 100_000 ? 0 : 1
  const body = absFormatted(cents, currency, { notation: 'compact', maximumFractionDigits }).replace(/K$/, 'k')
  return cents < 0 ? `${MINUS}${body}` : body
}

export function moneyAriaLabel(cents: number): string {
  const abs = Math.abs(cents)
  const dollars = new Intl.NumberFormat(LOCALE).format(Math.floor(abs / 100))
  const rest = String(abs % 100).padStart(2, '0')
  return `${cents < 0 ? 'minus ' : ''}${dollars} dollars ${rest}`
}
