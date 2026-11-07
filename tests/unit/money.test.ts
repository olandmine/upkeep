import { expect, test } from 'vitest'
import { formatCompact, formatMoney, moneyAriaLabel, splitHero } from '../../src/shared/money'

test('formatMoney uses a true minus sign', () => {
  expect(formatMoney(-220449)).toBe('−$2,204.49')
})

test('formatMoney can always show the sign', () => {
  expect(formatMoney(134023, { signDisplay: 'always' })).toBe('+$1,340.23')
  expect(formatMoney(-134023, { signDisplay: 'always' })).toBe('−$1,340.23')
})

test('formatMoney supports accounting parentheses', () => {
  expect(formatMoney(-220449, { negativeStyle: 'parentheses' })).toBe('($2,204.49)')
  expect(formatMoney(220449, { negativeStyle: 'parentheses' })).toBe('$2,204.49')
})

test('formatMoney formats zero without a sign', () => {
  expect(formatMoney(0)).toBe('$0.00')
  expect(formatMoney(-0)).toBe('$0.00')
})

test('formatMoney formats other currencies', () => {
  // Intl separates the currency code with a non-breaking space
  expect(formatMoney(-500, { currency: 'USD' })).toBe('−USD 5.00')
})

test('splitHero separates whole dollars and cents', () => {
  expect(splitHero(29792480)).toEqual({ sign: '', whole: '$297,924', fraction: '.80' })
  expect(splitHero(-1005)).toEqual({ sign: '−', whole: '$10', fraction: '.05' })
})

test('formatCompact abbreviates for axes and tiles', () => {
  expect(formatCompact(7460000)).toBe('$74.6k')
  expect(formatCompact(-120000000)).toBe('−$1.2M')
  expect(formatCompact(50000)).toBe('$500')
  // Under $1k nothing is abbreviated, so a lone decimal would read as cents ("$842.1").
  expect(formatCompact(84210)).toBe('$842')
  expect(formatCompact(-99960)).toBe('−$1k')
})

test('moneyAriaLabel reads amounts for screen readers', () => {
  expect(moneyAriaLabel(-220449)).toBe('minus 2,204 dollars 49')
  expect(moneyAriaLabel(134023)).toBe('1,340 dollars 23')
})
