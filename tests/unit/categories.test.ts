import { expect, test } from 'vitest'
import { categoryColorToken } from '../../src/shared/categories'

const parents = ['good-life', 'home', 'personal', 'transport']

test('fixed colours for Up parent categories', () => {
  expect(categoryColorToken('home', parents)).toBe('cat-blue')
  expect(categoryColorToken('good-life', parents)).toBe('cat-orange')
  expect(categoryColorToken('personal', parents)).toBe('cat-violet')
  expect(categoryColorToken('transport', parents)).toBe('cat-yellow')
})

test('uncategorised is slate', () => {
  expect(categoryColorToken(null, parents)).toBe('cat-slate')
})

test('other parents take teal, green, rose in sorted order, then slate', () => {
  const all = [...parents, 'zzz', 'aaa', 'mmm', 'qqq']
  expect(categoryColorToken('aaa', all)).toBe('cat-teal')
  expect(categoryColorToken('mmm', all)).toBe('cat-green')
  expect(categoryColorToken('qqq', all)).toBe('cat-rose')
  expect(categoryColorToken('zzz', all)).toBe('cat-slate')
})
