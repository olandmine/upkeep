import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Sparkline } from '../../src/web/components/goals/Sparkline'

const paths = (c: HTMLElement) =>
  ['var(--accent)', 'var(--text-tertiary)'].map(
    (s) => c.querySelector(`path[stroke="${s}"]`)?.getAttribute('d') ?? '',
  )
const ys = (d: string) => Array.from(d.matchAll(/[ML]\s*([\d.-]+)[ ,]([\d.-]+)/g)).map((m) => Number(m[2]))
const xs = (d: string) => Array.from(d.matchAll(/[ML]\s*([\d.-]+)[ ,]([\d.-]+)/g)).map((m) => Number(m[1]))

test('has the role and label', () => {
  render(<Sparkline balance={[0, 50, 100]} target={null} label="Holiday balance over the last 6 months" />)
  expect(screen.getByRole('img', { name: 'Holiday balance over the last 6 months' })).toBeInTheDocument()
})

test('balance starts at the bottom and ends at the top', () => {
  const { container } = render(<Sparkline balance={[0, 50, 100]} target={null} label="x" />)
  const y = ys(paths(container)[0])
  expect(y[0]).toBeGreaterThan(y[y.length - 1])
  expect(y[0]).toBeGreaterThan(20)
  expect(y[y.length - 1]).toBeLessThan(12)
})

test('equal values do not produce NaN', () => {
  const { container } = render(<Sparkline balance={[5, 5, 5]} target={[5, 5, 5]} label="x" />)
  for (const d of paths(container)) expect(d).not.toContain('NaN')
})

test('a null target entry leaves a gap', () => {
  const { container } = render(<Sparkline balance={[0, 50, 100]} target={[null, 50, 100]} label="x" />)
  const [bal, tgt] = paths(container)
  expect(xs(tgt)[0]).toBe(xs(bal)[1])
  expect(xs(tgt)[0]).toBeGreaterThan(xs(bal)[0])
})

test('balance and target share one vertical scale', () => {
  const { container } = render(<Sparkline balance={[0, 0, 0]} target={[100, 100, 100]} label="x" />)
  const [bal, tgt] = paths(container)
  expect(ys(tgt)[0]).toBeLessThan(ys(bal)[0])
})

test('a target with one value is drawn as a dot, not left out', () => {
  const { container } = render(<Sparkline balance={[0, 50, 100]} target={[null, null, 80]} label="x" />)
  const [, tgt] = paths(container)
  expect(tgt).not.toBe('')
  expect(xs(tgt)).toEqual([100, 100])
  expect(ys(tgt)[0]).toBe(ys(tgt)[1])
  expect(container.querySelector('path[stroke="var(--text-tertiary)"]')).toHaveAttribute(
    'stroke-linecap',
    'round',
  )
})
