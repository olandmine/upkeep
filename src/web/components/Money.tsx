import { createContext, useContext, type ReactNode } from 'react'
import { formatMoney, moneyAriaLabel, splitHero } from '../../shared/money'
import type { NegativeStyle } from '../../shared/types'
import { cn } from '../lib/cn'

const MoneyPrefs = createContext<NegativeStyle>('minus')

export function MoneyPrefsProvider({ negativeStyle, children }: { negativeStyle: NegativeStyle; children: ReactNode }) {
  return <MoneyPrefs.Provider value={negativeStyle}>{children}</MoneyPrefs.Provider>
}

interface MoneyProps {
  cents: number
  currency?: string
  /** Explicit sign plus positive/negative colour. */
  signed?: boolean
  /** Headline figure with superscript cents; use for 1–3 figures per screen only. */
  hero?: boolean
  className?: string
}

export function Money({ cents, currency, signed, hero, className }: MoneyProps) {
  const negativeStyle = useContext(MoneyPrefs)
  const label = moneyAriaLabel(cents)

  if (hero) {
    const { sign, whole, fraction } = splitHero(cents)
    return (
      <span className={cn('num', className)} aria-label={label}>
        {sign}
        {whole}
        <sup className="kpi-cents">{fraction}</sup>
      </span>
    )
  }

  const tone = signed && cents > 0 ? 'text-positive' : signed && cents < 0 ? 'text-negative' : undefined
  return (
    <span className={cn('num', tone, className)} aria-label={label}>
      {formatMoney(cents, { currency, negativeStyle, signDisplay: signed ? 'always' : 'auto' })}
    </span>
  )
}
