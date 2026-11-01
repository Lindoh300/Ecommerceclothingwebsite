import { describe, expect, it } from 'vitest'
import type { Product } from '../api/types'
import { matchesQuery } from './productSearch'

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    slug: 'classic-cotton-t-shirt',
    name: 'Classic Cotton T-Shirt',
    category: 'tshirts',
    price: 250,
    description: 'A soft everyday tee in heavyweight cotton.',
    image: '',
    images: [],
    sizes: ['S', 'M', 'L'],
    colors: ['Black', 'Forest Green'],
    stock: 10,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    variants: [],
    ...overrides,
  }
}

describe('matchesQuery', () => {
  it('matches a word in the product name', () => {
    expect(matchesQuery(makeProduct(), 'cotton')).toBe(true)
  })

  it('matches a word in the product description', () => {
    expect(matchesQuery(makeProduct(), 'heavyweight')).toBe(true)
  })

  it('matches a word in the category name passed in', () => {
    expect(matchesQuery(makeProduct(), 'jersey', 'Jerseys')).toBe(true)
  })

  it('does not match the category name when none is passed in', () => {
    expect(matchesQuery(makeProduct(), 'jersey')).toBe(false)
  })

  it('matches a word in the colours', () => {
    expect(matchesQuery(makeProduct(), 'green')).toBe(true)
  })

  it('is case-insensitive in both directions', () => {
    const product = makeProduct()
    expect(matchesQuery(product, 'CLASSIC')).toBe(true)
    expect(matchesQuery(product, 'FoReSt GrEeN')).toBe(true)
  })

  it('matches everything for an empty query', () => {
    expect(matchesQuery(makeProduct(), '')).toBe(true)
  })

  it('treats a whitespace-only query as empty', () => {
    expect(matchesQuery(makeProduct(), '   ')).toBe(true)
  })

  it('requires every word of the query to match', () => {
    const product = makeProduct()
    expect(matchesQuery(product, 'cotton black')).toBe(true)
    expect(matchesQuery(product, 'cotton jersey')).toBe(false)
  })

  it('returns false when no field contains the query', () => {
    expect(matchesQuery(makeProduct(), 'hoodie')).toBe(false)
  })
})
