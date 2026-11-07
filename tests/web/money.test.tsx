import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Money, MoneyPrefsProvider } from '../../src/web/components/Money'

test('Money renders a true minus and accessible label', () => {
  render(<Money cents={-220449} />)
  const el = screen.getByLabelText('minus 2,204 dollars 49')
  expect(el).toHaveTextContent('−$2,204.49')
  expect(el.className).toContain('num')
})

test('Money signed shows sign and colour', () => {
  render(
    <>
      <Money cents={134023} signed />
      <Money cents={-500} signed />
    </>,
  )
  expect(screen.getByLabelText('1,340 dollars 23')).toHaveTextContent('+$1,340.23')
  expect(screen.getByLabelText('1,340 dollars 23').className).toContain('text-positive')
  expect(screen.getByLabelText('minus 5 dollars 00').className).toContain('text-negative')
})

test('Money hero renders superscript cents', () => {
  const { container } = render(<Money cents={29792480} hero />)
  expect(container.querySelector('sup')).toHaveTextContent('.80')
  expect(screen.getByLabelText('297,924 dollars 80')).toHaveTextContent('$297,924.80')
})

test('Money respects parentheses preference', () => {
  render(
    <MoneyPrefsProvider negativeStyle="parentheses">
      <Money cents={-220449} />
    </MoneyPrefsProvider>,
  )
  expect(screen.getByLabelText('minus 2,204 dollars 49')).toHaveTextContent('($2,204.49)')
})
