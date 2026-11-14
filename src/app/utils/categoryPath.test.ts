import { describe, expect, it } from 'vitest'
import { LEGACY_CATEGORY_IDS, categoryPath } from './categoryPath'

describe('LEGACY_CATEGORY_IDS', () => {
  it('lists the five categories that keep their own route', () => {
    expect([...LEGACY_CATEGORY_IDS]).toEqual(['tshirts', 'jerseys', 'shorts', 'pants', 'accessories'])
  })
})

describe('categoryPath', () => {
  it.each(['tshirts', 'jerseys', 'shorts', 'pants', 'accessories'])(
    'links the legacy category %s to its own path',
    (id) => {
      expect(categoryPath(id)).toBe(`/${id}`)
    }
  )

  it('links any other category to category/:id', () => {
    expect(categoryPath('hoodies')).toBe('/category/hoodies')
  })

  it('matches legacy ids exactly, so a different case goes to category/:id', () => {
    expect(categoryPath('Tshirts')).toBe('/category/Tshirts')
  })

  it('encodes ids that contain spaces or slashes', () => {
    expect(categoryPath('summer sale')).toBe('/category/summer%20sale')
    expect(categoryPath('a/b')).toBe('/category/a%2Fb')
  })

  it('does not treat a legacy id with extra text as legacy', () => {
    expect(categoryPath('tshirts-2')).toBe('/category/tshirts-2')
  })
})
