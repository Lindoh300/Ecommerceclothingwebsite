// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Product } from '../api/types'
import { setCachedProducts } from '../hooks/useProducts'
import { toast } from '../lib/toast'
import {
  addToCart,
  clearCart,
  findVariant,
  getCart,
  getCartCount,
  getCartQuantityForVariant,
  getVariantStock,
  removeFromCart,
  updateCartItem,
} from './storage'

const CART_KEY = 'clothing_store_cart_v2'
const OLD_CART_KEY = 'clothing_store_cart'

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    slug: 'classic-cotton-t-shirt',
    name: 'Classic Cotton T-Shirt',
    category: 'tshirts',
    price: 250,
    description: 'A soft everyday tee.',
    image: 'https://example.test/tee.jpg',
    images: ['https://example.test/tee.jpg'],
    sizes: ['S', 'M'],
    colors: ['Black', 'Forest Green'],
    stock: 12,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    variants: [
      { id: 'v1', sku: 'TEE-S-BLK', size: 'S', color: 'Black', stock: 5 },
      { id: 'v2', sku: 'TEE-M-BLK', size: 'M', color: 'Black', stock: 3 },
      { id: 'v3', sku: 'TEE-M-GRN', size: 'M', color: 'Forest Green', stock: 4 },
    ],
    ...overrides,
  }
}

function seedCart(lines: unknown[]): void {
  localStorage.setItem(CART_KEY, JSON.stringify(lines))
}

function storedCart(): unknown[] {
  return JSON.parse(localStorage.getItem(CART_KEY) ?? 'null') as unknown[]
}

function quotaError(): DOMException {
  return new DOMException('Storage full', 'QuotaExceededError')
}

beforeEach(() => {
  localStorage.clear()
  setCachedProducts([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getCart', () => {
  it('returns an empty cart when nothing is stored', () => {
    expect(getCart()).toEqual([])
  })

  it('returns the stored lines', () => {
    seedCart([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])
    expect(getCart()).toEqual([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])
  })

  it('returns an empty cart without throwing when the stored JSON is corrupt', () => {
    localStorage.setItem(CART_KEY, '{"productId": "p1", ')
    expect(() => getCart()).not.toThrow()
    expect(getCart()).toEqual([])
  })

  it('returns an empty cart when the stored value is valid JSON but not a list', () => {
    localStorage.setItem(CART_KEY, '{"productId":"p1","quantity":2}')
    expect(getCart()).toEqual([])
  })

  it('migrates the old clothing_store_cart key into clothing_store_cart_v2', () => {
    localStorage.setItem(
      OLD_CART_KEY,
      JSON.stringify([{ id: 'p1', quantity: 2, selectedSize: 'M', selectedColor: 'Black' }])
    )

    expect(getCart()).toEqual([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])
    expect(storedCart()).toEqual([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])
  })

  it('removes the old key after a successful migration', () => {
    localStorage.setItem(OLD_CART_KEY, JSON.stringify([{ id: 'p1', quantity: 1 }]))
    getCart()
    expect(localStorage.getItem(OLD_CART_KEY)).toBeNull()
  })

  it('maps an empty old size or colour to undefined and a bad quantity to 1', () => {
    localStorage.setItem(
      OLD_CART_KEY,
      JSON.stringify([
        { id: 'p1', quantity: 3, selectedSize: '', selectedColor: '' },
        { id: 'p2', quantity: 0 },
        { id: 'p3', quantity: 'many' },
      ])
    )

    const lines = getCart()
    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({ productId: 'p1', quantity: 3 })
    expect(lines[0].size).toBeUndefined()
    expect(lines[0].color).toBeUndefined()
    expect(lines[1]).toEqual({ productId: 'p2', quantity: 1 })
    expect(lines[2]).toEqual({ productId: 'p3', quantity: 1 })
  })

  it('skips old entries that have no id', () => {
    localStorage.setItem(OLD_CART_KEY, JSON.stringify([{ quantity: 2 }, { id: 'p1', quantity: 1 }]))
    expect(getCart()).toEqual([{ productId: 'p1', quantity: 1 }])
  })

  it('does not carry price or image data over from the old cart', () => {
    localStorage.setItem(
      OLD_CART_KEY,
      JSON.stringify([{ id: 'p1', quantity: 1, price: 250, image: 'tee.jpg', name: 'Tee', selectedSize: 'M' }])
    )

    const [line] = getCart()
    const extraKeys = Object.keys(line).filter((k) => !['productId', 'size', 'color', 'quantity'].includes(k))
    expect(extraKeys).toEqual([])
    expect(line.productId).toBe('p1')
  })

  it('treats a corrupt old cart as empty and removes it', () => {
    localStorage.setItem(OLD_CART_KEY, 'not json at all')

    expect(() => getCart()).not.toThrow()
    expect(getCart()).toEqual([])
    expect(localStorage.getItem(OLD_CART_KEY)).toBeNull()
  })

  it('does not migrate the old key when the new key already exists', () => {
    localStorage.setItem(OLD_CART_KEY, JSON.stringify([{ id: 'p1', quantity: 1 }]))
    seedCart([])

    expect(getCart()).toEqual([])
    expect(localStorage.getItem(OLD_CART_KEY)).not.toBeNull()
  })
})

describe('findVariant', () => {
  const product = makeProduct()

  it('finds the variant for a size and colour', () => {
    expect(findVariant(product, 'M', 'Forest Green')).toEqual(product.variants[2])
  })

  it('returns undefined when no variant has that size and colour', () => {
    expect(findVariant(product, 'L', 'Black')).toBeUndefined()
    expect(findVariant(product, 'M', 'Navy')).toBeUndefined()
  })

  it('matches a missing size and colour to a variant whose size and colour are empty', () => {
    const oneSize = makeProduct({
      variants: [{ id: 'v9', sku: 'CAP', size: '', color: '', stock: 2 }],
    })
    expect(findVariant(oneSize)).toEqual(oneSize.variants[0])
    expect(findVariant(oneSize, '', '')).toEqual(oneSize.variants[0])
    expect(findVariant(oneSize, 'M')).toBeUndefined()
  })
})

describe('getCartQuantityForVariant', () => {
  it('returns 0 for an empty cart', () => {
    expect(getCartQuantityForVariant('p1', 'M', 'Black')).toBe(0)
  })

  it('adds up every line for the same variant', () => {
    seedCart([
      { productId: 'p1', size: 'M', color: 'Black', quantity: 2 },
      { productId: 'p1', size: 'M', color: 'Black', quantity: 1 },
    ])
    expect(getCartQuantityForVariant('p1', 'M', 'Black')).toBe(3)
  })

  it('does not count other sizes, other colours or other products', () => {
    seedCart([
      { productId: 'p1', size: 'M', color: 'Black', quantity: 2 },
      { productId: 'p1', size: 'S', color: 'Black', quantity: 4 },
      { productId: 'p1', size: 'M', color: 'Forest Green', quantity: 6 },
      { productId: 'p2', size: 'M', color: 'Black', quantity: 8 },
    ])
    expect(getCartQuantityForVariant('p1', 'M', 'Black')).toBe(2)
  })

  it('treats a missing size or colour as empty', () => {
    seedCart([{ productId: 'p1', quantity: 2 }])
    expect(getCartQuantityForVariant('p1')).toBe(2)
    expect(getCartQuantityForVariant('p1', '', '')).toBe(2)
    expect(getCartQuantityForVariant('p1', 'M')).toBe(0)
  })

  it('leaves out the line at excludeIndex', () => {
    seedCart([
      { productId: 'p1', size: 'M', color: 'Black', quantity: 2 },
      { productId: 'p1', size: 'M', color: 'Black', quantity: 1 },
    ])
    expect(getCartQuantityForVariant('p1', 'M', 'Black', 0)).toBe(1)
    expect(getCartQuantityForVariant('p1', 'M', 'Black', 1)).toBe(2)
  })

  it('leaves nothing out when excludeIndex does not point at a line', () => {
    seedCart([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])
    expect(getCartQuantityForVariant('p1', 'M', 'Black', 5)).toBe(2)
  })

  it('only leaves out the line at excludeIndex, so a line of another variant there changes nothing', () => {
    seedCart([
      { productId: 'p1', size: 'S', color: 'Black', quantity: 4 },
      { productId: 'p1', size: 'M', color: 'Black', quantity: 1 },
    ])
    expect(getCartQuantityForVariant('p1', 'M', 'Black', 0)).toBe(1)
  })
})

describe('getVariantStock', () => {
  it('returns the stock of the variant from the loaded products', () => {
    setCachedProducts([makeProduct()])
    expect(getVariantStock('p1', 'M', 'Black')).toBe(3)
    expect(getVariantStock('p1', 'M', 'Forest Green')).toBe(4)
  })

  it('returns 0 when the product is not loaded', () => {
    expect(getVariantStock('p1', 'M', 'Black')).toBe(0)
  })

  it('returns 0 when the variant no longer exists', () => {
    setCachedProducts([makeProduct()])
    expect(getVariantStock('p1', 'XL', 'Black')).toBe(0)
  })
})

describe('addToCart', () => {
  it('adds a new line with the product id, size, colour and quantity', () => {
    setCachedProducts([makeProduct()])

    expect(addToCart(makeProduct(), 2, 'M', 'Black')).toBe(true)
    expect(getCart()).toEqual([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])
  })

  it('uses a quantity of 1 when none is given', () => {
    const oneSize = makeProduct({
      variants: [{ id: 'v9', sku: 'CAP', size: '', color: '', stock: 2 }],
    })

    expect(addToCart(oneSize)).toBe(true)
    expect(getCart()).toEqual([{ productId: 'p1', size: undefined, color: undefined, quantity: 1 }])
  })

  it('adds to the existing line for the same variant', () => {
    setCachedProducts([makeProduct()])
    addToCart(makeProduct(), 1, 'S', 'Black')
    addToCart(makeProduct(), 2, 'S', 'Black')

    expect(getCart()).toEqual([{ productId: 'p1', size: 'S', color: 'Black', quantity: 3 }])
  })

  it('refuses to go over stock and leaves the cart unchanged', () => {
    setCachedProducts([makeProduct()])
    addToCart(makeProduct(), 2, 'M', 'Black')

    expect(addToCart(makeProduct(), 2, 'M', 'Black')).toBe(false)
    expect(getCart()).toEqual([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])
  })

  it('accepts a quantity that lands exactly on stock, and refuses the next unit', () => {
    setCachedProducts([makeProduct()])
    addToCart(makeProduct(), 2, 'M', 'Black')

    expect(addToCart(makeProduct(), 1, 'M', 'Black')).toBe(true)
    expect(getCart()[0].quantity).toBe(3)
    expect(addToCart(makeProduct(), 1, 'M', 'Black')).toBe(false)
    expect(getCart()[0].quantity).toBe(3)
  })

  it('accepts a quantity equal to the full stock on an empty cart', () => {
    setCachedProducts([makeProduct()])
    expect(addToCart(makeProduct(), 3, 'M', 'Black')).toBe(true)
    expect(getCart()[0].quantity).toBe(3)
  })

  it('does not count units of other sizes or colours against the variant stock', () => {
    setCachedProducts([makeProduct()])
    seedCart([
      { productId: 'p1', size: 'S', color: 'Black', quantity: 5 },
      { productId: 'p1', size: 'M', color: 'Forest Green', quantity: 4 },
    ])

    expect(addToCart(makeProduct(), 3, 'M', 'Black')).toBe(true)
    expect(getCartQuantityForVariant('p1', 'M', 'Black')).toBe(3)
  })

  it('refuses a variant that does not exist', () => {
    setCachedProducts([makeProduct()])

    expect(addToCart(makeProduct(), 1, 'XL', 'Black')).toBe(false)
    expect(getCart()).toEqual([])
  })

  it('checks stock against the loaded product rather than the one passed in', () => {
    setCachedProducts([
      makeProduct({ variants: [{ id: 'v2', sku: 'TEE-M-BLK', size: 'M', color: 'Black', stock: 1 }] }),
    ])

    expect(addToCart(makeProduct(), 2, 'M', 'Black')).toBe(false)
    expect(getCart()).toEqual([])
  })

  it('uses the passed-in product for stock when the product is not loaded', () => {
    expect(addToCart(makeProduct(), 3, 'M', 'Black')).toBe(true)
    expect(addToCart(makeProduct(), 1, 'M', 'Black')).toBe(false)
  })

  it('dispatches one cartUpdated event after a successful add', () => {
    setCachedProducts([makeProduct()])
    const onUpdate = vi.fn()
    window.addEventListener('cartUpdated', onUpdate)

    addToCart(makeProduct(), 1, 'M', 'Black')

    window.removeEventListener('cartUpdated', onUpdate)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch cartUpdated when the add is refused for stock', () => {
    setCachedProducts([makeProduct()])
    const onUpdate = vi.fn()
    window.addEventListener('cartUpdated', onUpdate)

    addToCart(makeProduct(), 4, 'M', 'Black')

    window.removeEventListener('cartUpdated', onUpdate)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('returns false, shows a toast and keeps the cart when storage is full', () => {
    setCachedProducts([makeProduct()])
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => {})
    const onUpdate = vi.fn()
    window.addEventListener('cartUpdated', onUpdate)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quotaError()
    })

    const added = addToCart(makeProduct(), 1, 'M', 'Black')

    window.removeEventListener('cartUpdated', onUpdate)
    expect(added).toBe(false)
    expect(toastError).toHaveBeenCalledWith('Could not save your cart', expect.any(Object))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(getCart()).toEqual([])
  })

  it('returns false without a toast for a storage error that is not a full quota', () => {
    setCachedProducts([makeProduct()])
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(addToCart(makeProduct(), 1, 'M', 'Black')).toBe(false)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('stores only product id, size, colour and quantity, with no price or image', () => {
    setCachedProducts([makeProduct()])
    addToCart(makeProduct(), 1, 'M', 'Black')

    const [line] = storedCart() as Record<string, unknown>[]
    expect(Object.keys(line).sort()).toEqual(['color', 'productId', 'quantity', 'size'])
    expect(line).not.toHaveProperty('price')
    expect(line).not.toHaveProperty('image')
  })

  it('refuses a negative quantity instead of lowering the line', () => {
    setCachedProducts([makeProduct()])
    addToCart(makeProduct(), 2, 'M', 'Black')

    expect(addToCart(makeProduct(), -1, 'M', 'Black')).toBe(false)
    expect(getCart()[0].quantity).toBe(2)
  })
})

describe('updateCartItem', () => {
  it('returns false when there is no line at that index', () => {
    setCachedProducts([makeProduct()])
    expect(updateCartItem(0, 1)).toBe(false)
    expect(getCart()).toEqual([])
  })

  it('sets the quantity of the line within stock', () => {
    setCachedProducts([makeProduct()])
    seedCart([{ productId: 'p1', size: 'M', color: 'Black', quantity: 1 }])

    expect(updateCartItem(0, 3)).toBe(true)
    expect(getCart()[0].quantity).toBe(3)
  })

  it('refuses to raise the quantity over stock and keeps the old quantity', () => {
    setCachedProducts([makeProduct()])
    seedCart([{ productId: 'p1', size: 'M', color: 'Black', quantity: 1 }])

    expect(updateCartItem(0, 4)).toBe(false)
    expect(getCart()[0].quantity).toBe(1)
  })

  it('counts the other lines of the same variant but not the line being changed', () => {
    setCachedProducts([makeProduct()])
    seedCart([
      { productId: 'p1', size: 'M', color: 'Black', quantity: 1 },
      { productId: 'p1', size: 'M', color: 'Black', quantity: 1 },
    ])

    expect(updateCartItem(0, 3)).toBe(false)
    expect(updateCartItem(0, 2)).toBe(true)
    expect(getCart().map((l) => l.quantity)).toEqual([2, 1])
  })

  it('does not count another variant against the stock of the line being changed', () => {
    setCachedProducts([makeProduct()])
    seedCart([
      { productId: 'p1', size: 'M', color: 'Black', quantity: 1 },
      { productId: 'p1', size: 'S', color: 'Black', quantity: 5 },
    ])

    expect(updateCartItem(0, 3)).toBe(true)
    expect(getCart()[0].quantity).toBe(3)
  })

  it('always allows lowering the quantity, even after stock has dropped', () => {
    setCachedProducts([
      makeProduct({ variants: [{ id: 'v2', sku: 'TEE-M-BLK', size: 'M', color: 'Black', stock: 1 }] }),
    ])
    seedCart([{ productId: 'p1', size: 'M', color: 'Black', quantity: 3 }])

    expect(updateCartItem(0, 1)).toBe(true)
    expect(getCart()[0].quantity).toBe(1)
  })

  it('refuses to raise the quantity when the product is not loaded', () => {
    seedCart([{ productId: 'p1', size: 'M', color: 'Black', quantity: 1 }])

    expect(updateCartItem(0, 2)).toBe(false)
    expect(getCart()[0].quantity).toBe(1)
  })

  it('allows lowering the quantity when the product is not loaded', () => {
    seedCart([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])

    expect(updateCartItem(0, 1)).toBe(true)
    expect(getCart()[0].quantity).toBe(1)
  })

  it('returns false and leaves storage unchanged when the cart cannot be saved', () => {
    setCachedProducts([makeProduct()])
    seedCart([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quotaError()
    })

    expect(updateCartItem(0, 1)).toBe(false)
    expect(storedCart()).toEqual([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])
  })
})

describe('removeFromCart', () => {
  it('removes the line at the given index and keeps the others in order', () => {
    seedCart([
      { productId: 'p1', size: 'S', color: 'Black', quantity: 1 },
      { productId: 'p1', size: 'M', color: 'Black', quantity: 2 },
      { productId: 'p2', quantity: 3 },
    ])

    removeFromCart(1)

    expect(getCart()).toEqual([
      { productId: 'p1', size: 'S', color: 'Black', quantity: 1 },
      { productId: 'p2', quantity: 3 },
    ])
  })

  it('leaves the cart unchanged for an index past the end', () => {
    seedCart([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])

    removeFromCart(4)

    expect(getCart()).toEqual([{ productId: 'p1', size: 'M', color: 'Black', quantity: 2 }])
  })
})

describe('clearCart', () => {
  it('empties the cart', () => {
    setCachedProducts([makeProduct()])
    addToCart(makeProduct(), 2, 'M', 'Black')

    clearCart()

    expect(getCart()).toEqual([])
    expect(storedCart()).toEqual([])
  })

  it('does not bring back lines from the old cart key', () => {
    localStorage.setItem(OLD_CART_KEY, JSON.stringify([{ id: 'p1', quantity: 1 }]))

    clearCart()

    expect(getCart()).toEqual([])
  })
})

describe('getCartCount', () => {
  it('returns 0 for an empty cart', () => {
    expect(getCartCount()).toBe(0)
  })

  it('adds up the quantity of every line across sizes, colours and products', () => {
    seedCart([
      { productId: 'p1', size: 'M', color: 'Black', quantity: 2 },
      { productId: 'p1', size: 'S', color: 'Black', quantity: 1 },
      { productId: 'p2', quantity: 4 },
    ])

    expect(getCartCount()).toBe(7)
  })

  it('returns 0 for a corrupt cart instead of throwing', () => {
    localStorage.setItem(CART_KEY, '[{"productId":')
    expect(() => getCartCount()).not.toThrow()
    expect(getCartCount()).toBe(0)
  })

  it('does not throw when a stored cart line is not an object', () => {
    seedCart([null])
    expect(() => getCartCount()).not.toThrow()
  })
})
