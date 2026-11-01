import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order, OrderLine, OrderStatus, Product, Variant } from '../api/types'
import {
  EXPIRING_WITHIN_HOURS,
  LOW_STOCK_AT,
  SUMMARY_DAYS,
  TOP_PRODUCTS,
  dashboardOrders,
  lowStockVariants,
  salesSummary,
  saleTime,
  startOfDay,
  startOfWeek,
} from './adminDashboard'

// "Now" for the whole file: Saturday 31 October 2026, 12:00 local time.
// Dates are built in local time so the expectations do not depend on the machine's time zone.
const NOW = new Date(2026, 9, 31, 12, 0, 0)
const HOUR = 60 * 60 * 1000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/** ISO time for a local date and time. The month is 1-based here. */
function localIso(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): string {
  return new Date(year, month - 1, day, hour, minute, second, ms).toISOString()
}

function line(overrides: Partial<OrderLine> = {}): OrderLine {
  const price = overrides.price ?? 100
  const quantity = overrides.quantity ?? 1
  return {
    productId: 'p-tee',
    name: 'Classic Tee',
    size: 'M',
    color: 'Black',
    ...overrides,
    price,
    quantity,
    subtotal: price * quantity,
  }
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o-1',
    ref: 'REF-1',
    createdAt: localIso(2026, 10, 20, 10),
    status: 'paid',
    lines: [line()],
    total: 100,
    customer: { name: 'Thandi', phone: '0821234567' },
    paidAt: localIso(2026, 10, 20, 10, 5),
    expiresAt: null,
    paymentFlag: null,
    ...overrides,
  }
}

function variant(overrides: Partial<Variant> & Pick<Variant, 'id' | 'stock'>): Variant {
  return { sku: `SKU-${overrides.id}`, size: 'M', color: 'Black', ...overrides }
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-1',
    slug: 'classic-tee',
    name: 'Classic Tee',
    category: 'tshirts',
    price: 250,
    description: '',
    image: '',
    images: [],
    sizes: [],
    colors: [],
    stock: 0,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    variants: [],
    ...overrides,
  }
}

/** ISO time `hours` from the fixed now. */
const inHours = (hours: number): string => new Date(NOW.getTime() + hours * HOUR).toISOString()

describe('constants', () => {
  it('pins the thresholds the owner reads', () => {
    expect(EXPIRING_WITHIN_HOURS).toBe(12)
    expect(LOW_STOCK_AT).toBe(3)
    expect(SUMMARY_DAYS).toBe(30)
    expect(TOP_PRODUCTS).toBe(5)
  })
})

describe('saleTime', () => {
  it('uses the payment time when there is one', () => {
    const o = order({ paidAt: localIso(2026, 10, 30, 9), createdAt: localIso(2026, 10, 28, 9) })
    expect(saleTime(o)).toBe(new Date(2026, 9, 30, 9).getTime())
  })

  it('falls back to the creation time when there is no payment time', () => {
    const o = order({ paidAt: null, createdAt: localIso(2026, 10, 28, 9) })
    expect(saleTime(o)).toBe(new Date(2026, 9, 28, 9).getTime())
    expect(saleTime(order({ paidAt: '', createdAt: localIso(2026, 10, 28, 9) }))).toBe(
      new Date(2026, 9, 28, 9).getTime(),
    )
  })

  it('is NaN when neither time parses', () => {
    expect(Number.isNaN(saleTime(order({ paidAt: null, createdAt: 'soon' })))).toBe(true)
  })
})

describe('startOfDay and startOfWeek', () => {
  it('startOfDay is local midnight of the same day', () => {
    expect(startOfDay(NOW).toISOString()).toBe(localIso(2026, 10, 31))
    expect(startOfDay(new Date(2026, 9, 31, 23, 59, 59, 999)).toISOString()).toBe(localIso(2026, 10, 31))
  })

  it('startOfWeek on a Saturday is the Monday before it', () => {
    expect(startOfWeek(NOW).toISOString()).toBe(localIso(2026, 10, 26))
  })

  it('startOfWeek on a Monday is that same Monday at midnight', () => {
    expect(startOfWeek(new Date(2026, 9, 26, 9, 30)).toISOString()).toBe(localIso(2026, 10, 26))
  })

  it('startOfWeek on a Sunday goes back to the Monday six days earlier', () => {
    // 1 November 2026 is a Sunday; the week it ends started on Monday 26 October.
    expect(startOfWeek(new Date(2026, 10, 1, 20, 0)).toISOString()).toBe(localIso(2026, 10, 26))
  })
})

describe('dashboardOrders', () => {
  describe('toPack', () => {
    it('lists only paid orders, oldest payment first', () => {
      const orders = [
        order({ id: 'late', paidAt: localIso(2026, 10, 30, 9) }),
        order({ id: 'early', paidAt: localIso(2026, 10, 29, 18) }),
        order({ id: 'packed', status: 'packed', paidAt: localIso(2026, 10, 28, 8) }),
        order({ id: 'pending', status: 'pending', paidAt: null, expiresAt: inHours(40) }),
      ]
      expect(dashboardOrders(orders, new Date()).toPack.map((o) => o.id)).toEqual(['early', 'late'])
    })

    it('dates an order with no payment time by its creation time', () => {
      const orders = [
        order({ id: 'paid-29', paidAt: localIso(2026, 10, 29, 9) }),
        order({ id: 'no-pay-time', paidAt: null, createdAt: localIso(2026, 10, 28, 9) }),
      ]
      expect(dashboardOrders(orders, new Date()).toPack.map((o) => o.id)).toEqual(['no-pay-time', 'paid-29'])
    })
  })

  describe('expiringSoon', () => {
    it('includes an unpaid order expiring exactly 12 hours from now', () => {
      const o = order({ id: 'edge', status: 'pending', paidAt: null, expiresAt: inHours(12) })
      expect(dashboardOrders([o], new Date()).expiringSoon.map((x) => x.id)).toEqual(['edge'])
    })

    it('leaves out an unpaid order expiring one millisecond after the 12-hour edge', () => {
      const o = order({
        id: 'just-outside',
        status: 'pending',
        paidAt: null,
        expiresAt: new Date(NOW.getTime() + 12 * HOUR + 1).toISOString(),
      })
      expect(dashboardOrders([o], new Date()).expiringSoon).toEqual([])
    })

    it('includes an order already past its expiry that has not been swept yet', () => {
      const o = order({ id: 'overdue', status: 'awaiting_payment', paidAt: null, expiresAt: inHours(-1) })
      expect(dashboardOrders([o], new Date()).expiringSoon.map((x) => x.id)).toEqual(['overdue'])
    })

    it('counts awaiting_payment orders as well as pending ones', () => {
      const orders = [
        order({ id: 'pending', status: 'pending', paidAt: null, expiresAt: inHours(2) }),
        order({ id: 'awaiting', status: 'awaiting_payment', paidAt: null, expiresAt: inHours(0.5) }),
      ]
      expect(dashboardOrders(orders, new Date()).expiringSoon.map((x) => x.id)).toEqual(['awaiting', 'pending'])
    })

    it('ignores paid, packed, cancelled and expired orders even when they carry an expiry', () => {
      const statuses: OrderStatus[] = ['paid', 'packed', 'cancelled', 'expired']
      const orders = statuses.map((status) => order({ id: status, status, paidAt: null, expiresAt: inHours(1) }))
      expect(dashboardOrders(orders, new Date()).expiringSoon).toEqual([])
    })

    it('leaves out an unpaid order with no expiry', () => {
      const o = order({ status: 'pending', paidAt: null, expiresAt: null })
      expect(dashboardOrders([o], new Date()).expiringSoon).toEqual([])
    })

    it('lists the soonest expiry first', () => {
      const orders = [
        order({ id: 'in-five', status: 'pending', paidAt: null, expiresAt: inHours(5) }),
        order({ id: 'overdue', status: 'pending', paidAt: null, expiresAt: inHours(-1) }),
        order({ id: 'in-two', status: 'pending', paidAt: null, expiresAt: inHours(2) }),
      ]
      expect(dashboardOrders(orders, new Date()).expiringSoon.map((x) => x.id)).toEqual([
        'overdue',
        'in-two',
        'in-five',
      ])
    })
  })

  describe('flagged', () => {
    it('lists flagged orders that are not refunded, newest first', () => {
      const orders = [
        order({ id: 'older', createdAt: localIso(2026, 10, 10), paymentFlag: 'refund_due', status: 'cancelled' }),
        order({ id: 'newer', createdAt: localIso(2026, 10, 25), paymentFlag: 'amount_mismatch' }),
        order({ id: 'clean', createdAt: localIso(2026, 10, 27), paymentFlag: null }),
      ]
      expect(dashboardOrders(orders, new Date()).flagged.map((o) => o.id)).toEqual(['newer', 'older'])
    })

    it('leaves out a refunded order even if it still carries a flag', () => {
      const o = order({ id: 'refunded', status: 'refunded', paymentFlag: 'refund_due' })
      expect(dashboardOrders([o], new Date()).flagged).toEqual([])
    })
  })

  describe('today and week totals', () => {
    it('counts today from local midnight and the week from the Monday before', () => {
      const orders = [
        order({ id: 'a', status: 'paid', paidAt: localIso(2026, 10, 31, 0, 0), total: 300 }),
        order({ id: 'b', status: 'delivered', paidAt: localIso(2026, 10, 31, 11, 0), total: 200 }),
        order({ id: 'c', status: 'paid', paidAt: localIso(2026, 10, 30, 23, 59, 59, 999), total: 900 }),
        order({ id: 'd', status: 'packed', paidAt: localIso(2026, 10, 31, 8, 0), total: 50 }),
      ]
      const result = dashboardOrders(orders, new Date())
      // 'c' is yesterday, so it is in the week but not today.
      expect(result.today).toEqual({ count: 3, total: 550 })
      expect(result.week).toEqual({ count: 4, total: 1450 })
    })

    it('starts the week on Monday at midnight and leaves out Sunday before it', () => {
      const orders = [
        order({ id: 'monday', paidAt: localIso(2026, 10, 26, 0, 0), total: 70 }),
        order({ id: 'sunday', paidAt: localIso(2026, 10, 25, 23, 59, 59, 999), total: 900 }),
        order({ id: 'friday', paidAt: localIso(2026, 10, 23, 12, 0), total: 400 }),
      ]
      expect(dashboardOrders(orders, new Date()).week).toEqual({ count: 1, total: 70 })
    })

    it('counts only sale statuses: paid, packed, shipped and delivered', () => {
      const orders = (['pending', 'awaiting_payment', 'cancelled', 'expired', 'refunded'] as OrderStatus[]).map(
        (status) => order({ id: status, status, paidAt: localIso(2026, 10, 31, 9), total: 500 }),
      )
      const result = dashboardOrders(orders, new Date())
      expect(result.today).toEqual({ count: 0, total: 0 })
      expect(result.week).toEqual({ count: 0, total: 0 })
    })

    it('counts an order by its payment time, not its creation time', () => {
      const o = order({ createdAt: localIso(2026, 10, 30, 9), paidAt: localIso(2026, 10, 31, 9), total: 120 })
      expect(dashboardOrders([o], new Date()).today).toEqual({ count: 1, total: 120 })
    })

    it('includes the delivery fee in the total', () => {
      const o = order({ lines: [line({ price: 200, quantity: 1 })], total: 250, paidAt: localIso(2026, 10, 31, 9) })
      expect(dashboardOrders([o], new Date()).today).toEqual({ count: 1, total: 250 })
    })

    it('leaves out an order whose dates do not parse', () => {
      const o = order({ paidAt: null, createdAt: 'not a date', total: 100 })
      const result = dashboardOrders([o], new Date())
      expect(result.today).toEqual({ count: 0, total: 0 })
      expect(result.week).toEqual({ count: 0, total: 0 })
    })

    it('returns zero totals for an empty list', () => {
      const result = dashboardOrders([], new Date())
      expect(result).toEqual({
        toPack: [],
        expiringSoon: [],
        flagged: [],
        today: { count: 0, total: 0 },
        week: { count: 0, total: 0 },
      })
    })
  })
})

describe('salesSummary', () => {
  it('covers 30 calendar days from 2 October, today included, and pins the edge', () => {
    const orders = [
      // Exactly the start of the window: counted.
      order({ id: 'edge', paidAt: localIso(2026, 10, 2, 0, 0, 0, 0), total: 100 }),
      // One millisecond before: not counted.
      order({ id: 'before', paidAt: localIso(2026, 10, 1, 23, 59, 59, 999), total: 900 }),
      // Today: counted.
      order({ id: 'today', paidAt: localIso(2026, 10, 31, 11, 0), total: 50 }),
    ]
    const summary = salesSummary(orders, new Date())
    expect(summary.count).toBe(2)
    expect(summary.total).toBe(150)
  })

  it('counts only paid, packed, shipped and delivered orders', () => {
    const counted: OrderStatus[] = ['paid', 'packed', 'shipped', 'delivered']
    const left: OrderStatus[] = ['pending', 'awaiting_payment', 'cancelled', 'expired', 'refunded']
    const orders = [
      ...counted.map((status) => order({ id: status, status, total: 10, paidAt: localIso(2026, 10, 30) })),
      ...left.map((status) => order({ id: status, status, total: 1000, paidAt: localIso(2026, 10, 30) })),
    ]
    const summary = salesSummary(orders, new Date())
    expect(summary.count).toBe(4)
    expect(summary.total).toBe(40)
  })

  it('takes the total from the order, delivery included, and averages over sales', () => {
    const orders = [
      order({ id: 'a', lines: [line({ price: 200 })], total: 250, paidAt: localIso(2026, 10, 30) }),
      order({ id: 'b', lines: [line({ price: 150 })], total: 150, paidAt: localIso(2026, 10, 29) }),
    ]
    const summary = salesSummary(orders, new Date())
    expect(summary).toEqual({
      count: 2,
      total: 400,
      average: 200,
      units: 2,
      topProducts: [
        { name: 'Classic Tee', units: 2, revenue: 350 },
      ],
    })
  })

  it('returns zeros and no products when there are no sales', () => {
    expect(salesSummary([], new Date())).toEqual({ count: 0, total: 0, average: 0, units: 0, topProducts: [] })
  })

  it('gives an average of 0 when only unpaid orders exist', () => {
    const summary = salesSummary([order({ status: 'pending', total: 500 })], new Date())
    expect(summary.count).toBe(0)
    expect(summary.average).toBe(0)
    expect(summary.topProducts).toEqual([])
  })

  it('multiplies unit price by quantity for each line', () => {
    const o = order({ lines: [line({ price: 120, quantity: 3 })], total: 360, paidAt: localIso(2026, 10, 30) })
    expect(salesSummary([o], new Date()).topProducts).toEqual([{ name: 'Classic Tee', units: 3, revenue: 360 }])
  })

  it('groups lines of one product together across sizes and colours', () => {
    const orders = [
      order({
        id: 'first',
        lines: [
          line({ size: 'S', color: 'Black', price: 100, quantity: 2 }),
          line({ size: 'M', color: 'Black', price: 100, quantity: 1 }),
        ],
        total: 300,
        paidAt: localIso(2026, 10, 30),
      }),
      order({
        id: 'second',
        lines: [line({ size: 'M', color: 'Red', price: 90, quantity: 4 })],
        total: 360,
        paidAt: localIso(2026, 10, 30),
      }),
    ]
    const summary = salesSummary(orders, new Date())
    expect(summary.topProducts).toEqual([{ name: 'Classic Tee', units: 7, revenue: 660 }])
    expect(summary.units).toBe(7)
  })

  it('ranks by units, then revenue, then name', () => {
    const o = order({
      paidAt: localIso(2026, 10, 30),
      total: 2000,
      lines: [
        line({ productId: 'p-alpha', name: 'Alpha Tee', price: 100, quantity: 5 }),
        line({ productId: 'p-gamma', name: 'Gamma Tee', price: 180, quantity: 5 }),
        line({ productId: 'p-delta', name: 'Delta Tee', price: 10, quantity: 9 }),
        line({ productId: 'p-beta', name: 'Beta Tee', price: 180, quantity: 5 }),
      ],
    })
    const names = salesSummary([o], new Date()).topProducts.map((p) => p.name)
    // Delta sells most units. Beta and Gamma tie on units and revenue, so the name decides. Alpha earns least.
    expect(names).toEqual(['Delta Tee', 'Beta Tee', 'Gamma Tee', 'Alpha Tee'])
  })

  it('lists at most five products, best sellers first', () => {
    const lines = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      line({ productId: `p-${n}`, name: `Product ${n}`, price: 10, quantity: n }),
    )
    const o = order({ lines, total: 280, paidAt: localIso(2026, 10, 30) })
    const names = salesSummary([o], new Date()).topProducts.map((p) => p.name)
    expect(names).toEqual(['Product 7', 'Product 6', 'Product 5', 'Product 4', 'Product 3'])
    expect(names).toHaveLength(TOP_PRODUCTS)
  })

  it('leaves out products from orders outside the window or not counted as sales', () => {
    const orders = [
      order({ id: 'old', lines: [line({ productId: 'p-old', name: 'Old Tee', quantity: 50 })], paidAt: localIso(2026, 9, 1) }),
      order({
        id: 'cancelled',
        status: 'cancelled',
        lines: [line({ productId: 'p-void', name: 'Void Tee', quantity: 50 })],
        paidAt: localIso(2026, 10, 30),
      }),
      order({ id: 'kept', lines: [line({ productId: 'p-kept', name: 'Kept Tee', quantity: 1 })], paidAt: localIso(2026, 10, 30) }),
    ]
    expect(salesSummary(orders, new Date()).topProducts.map((p) => p.name)).toEqual(['Kept Tee'])
  })

  it('skips an order whose dates do not parse', () => {
    const o = order({ paidAt: null, createdAt: 'nope', total: 999 })
    expect(salesSummary([o], new Date())).toEqual({ count: 0, total: 0, average: 0, units: 0, topProducts: [] })
  })
})

describe('lowStockVariants', () => {
  it('includes a variant at exactly LOW_STOCK_AT and below, but not one above it', () => {
    const products = [
      product({
        id: 'p-1',
        name: 'Classic Tee',
        variants: [
          variant({ id: 'zero', stock: 0 }),
          variant({ id: 'at-edge', stock: 3 }),
          variant({ id: 'above', stock: 4 }),
        ],
      }),
    ]
    expect(lowStockVariants(products).map((v) => v.variantId)).toEqual(['zero', 'at-edge'])
  })

  it('leaves out inactive products, even when their stock is low', () => {
    const products = [
      product({ id: 'p-off', name: 'Retired Tee', active: false, variants: [variant({ id: 'v-off', stock: 0 })] }),
      product({ id: 'p-on', name: 'Live Tee', active: true, variants: [variant({ id: 'v-on', stock: 1 })] }),
    ]
    expect(lowStockVariants(products).map((v) => v.productId)).toEqual(['p-on'])
  })

  it('returns the variant details in the documented shape', () => {
    const products = [
      product({
        id: 'p-1',
        name: 'Classic Tee',
        variants: [variant({ id: 'v-1', sku: 'CT-M-BLK', size: 'M', color: 'Black', stock: 2 })],
      }),
    ]
    expect(lowStockVariants(products)).toEqual([
      {
        productId: 'p-1',
        productName: 'Classic Tee',
        variantId: 'v-1',
        sku: 'CT-M-BLK',
        size: 'M',
        color: 'Black',
        stock: 2,
      },
    ])
  })

  it('sorts by stock, then product name, size and colour', () => {
    const products = [
      product({
        id: 'p-cap',
        name: 'Cap',
        variants: [
          variant({ id: 'cap-os-red-0', stock: 0, size: 'OS', color: 'Red' }),
          variant({ id: 'cap-m-red-1', stock: 1, size: 'M', color: 'Red' }),
          variant({ id: 'cap-m-black-1', stock: 1, size: 'M', color: 'Black' }),
          variant({ id: 'cap-l-red-1', stock: 1, size: 'L', color: 'Red' }),
          variant({ id: 'cap-s-red-3', stock: 3, size: 'S', color: 'Red' }),
        ],
      }),
      product({ id: 'p-hoodie', name: 'Hoodie', variants: [variant({ id: 'hoodie-m-grey-1', stock: 1, size: 'M', color: 'Grey' })] }),
      product({ id: 'p-zed', name: 'Zed Tee', variants: [variant({ id: 'zed-xl-blue-2', stock: 2, size: 'XL', color: 'Blue' })] }),
    ]
    expect(lowStockVariants(products).map((v) => v.variantId)).toEqual([
      'cap-os-red-0',
      'cap-l-red-1',
      'cap-m-black-1',
      'cap-m-red-1',
      'hoodie-m-grey-1',
      'zed-xl-blue-2',
      'cap-s-red-3',
    ])
  })

  it('returns nothing when no active product has low stock', () => {
    const products = [product({ variants: [variant({ id: 'v', stock: 4 })] })]
    expect(lowStockVariants(products)).toEqual([])
  })
})
