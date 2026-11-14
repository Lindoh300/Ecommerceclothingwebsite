import { describe, expect, it } from 'vitest'
import type { Order } from '../api/types'
import { buildOrderMessage, deliveryLabel } from './orderMessage'

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    ref: 'NG-1001',
    createdAt: '2026-10-01T10:00:00.000Z',
    status: 'pending',
    lines: [
      { productId: 'p1', name: 'Classic Cotton T-Shirt', price: 250, size: 'M', color: 'Black', quantity: 2, subtotal: 500 },
    ],
    total: 540,
    customer: { name: 'Thandi Dlamini', phone: '0821234567' },
    deliveryFee: 40,
    delivery: {
      method: 'door',
      address: {
        line1: '12 Main Road',
        line2: 'Flat 3',
        suburb: 'Sea Point',
        city: 'Cape Town',
        postalCode: '8005',
      },
      fee: 40,
    },
    ...overrides,
  }
}

describe('deliveryLabel', () => {
  it('names the three delivery methods', () => {
    expect(deliveryLabel('door')).toBe('Door delivery')
    expect(deliveryLabel('locker')).toBe('Locker')
    expect(deliveryLabel('collect')).toBe('Collect')
  })

  it('returns an unknown method unchanged', () => {
    expect(deliveryLabel('drone')).toBe('drone')
  })
})

describe('buildOrderMessage', () => {
  it('builds the full message for a door delivery order', () => {
    expect(buildOrderMessage(makeOrder())).toBe(
      [
        "Hi! I've placed order NG-1001.",
        'Name: Thandi Dlamini',
        '',
        '1. Classic Cotton T-Shirt',
        '   - Size: M',
        '   - Color: Black',
        '   - Qty: 2',
        '   - Price: R250',
        '   - Subtotal: R500',
        '',
        'Delivery: Door delivery',
        'Address: 12 Main Road, Flat 3, Sea Point, Cape Town, 8005',
        'Delivery fee: R40.00',
        '',
        'Total: R540.00',
      ].join('\n'),
    )
  })

  it('uses the server total, not the sum of the lines', () => {
    const message = buildOrderMessage(makeOrder({ total: 999.99 }))
    expect(message).toContain('Total: R999.99')
    expect(message).not.toContain('Total: R540.00')
  })

  it('formats the total and fee to two decimals', () => {
    const message = buildOrderMessage(
      makeOrder({ total: 1234.5, delivery: { method: 'collect', fee: 0 } }),
    )
    expect(message).toContain('Total: R1234.50')
  })

  it('numbers each line and lists every line', () => {
    const order = makeOrder({
      lines: [
        { productId: 'p1', name: 'Classic Cotton T-Shirt', price: 250, size: 'M', color: 'Black', quantity: 1, subtotal: 250 },
        { productId: 'p2', name: 'Home Jersey', price: 450, size: 'XL', color: 'Forest Green', quantity: 3, subtotal: 1350 },
      ],
      total: 1350,
      delivery: null,
    })
    const message = buildOrderMessage(order)
    expect(message).toContain(
      '1. Classic Cotton T-Shirt\n   - Size: M\n   - Color: Black\n   - Qty: 1\n   - Price: R250\n   - Subtotal: R250\n',
    )
    expect(message).toContain(
      '2. Home Jersey\n   - Size: XL\n   - Color: Forest Green\n   - Qty: 3\n   - Price: R450\n   - Subtotal: R1350\n',
    )
  })

  it('leaves out the size and colour lines when a line has neither', () => {
    const order = makeOrder({
      lines: [{ productId: 'p3', name: 'Tote Bag', price: 120, quantity: 1, subtotal: 120 }],
      total: 120,
      delivery: null,
    })
    const message = buildOrderMessage(order)
    expect(message).toContain('1. Tote Bag\n   - Qty: 1\n   - Price: R120\n   - Subtotal: R120')
    expect(message).not.toContain('Size:')
    expect(message).not.toContain('Color:')
  })

  it('omits the delivery block when there is no delivery', () => {
    const message = buildOrderMessage(makeOrder({ delivery: null, total: 500 }))
    expect(message).not.toContain('Delivery')
    expect(message).not.toContain('Address')
    expect(message.endsWith('Total: R500.00')).toBe(true)
  })

  it('shows the locker name and fee for a locker order', () => {
    const message = buildOrderMessage(
      makeOrder({
        total: 535,
        delivery: { method: 'locker', locker: 'Pick n Pay Sea Point - ABC123', fee: 35 },
      }),
    )
    expect(message).toContain('Delivery: Locker\nLocker: Pick n Pay Sea Point - ABC123\nDelivery fee: R35.00')
    expect(message).not.toContain('Address:')
  })

  it('leaves out empty address parts', () => {
    const message = buildOrderMessage(
      makeOrder({
        delivery: {
          method: 'door',
          address: { line1: '12 Main Road', suburb: '', city: 'Cape Town', postalCode: '' },
          fee: 40,
        },
      }),
    )
    expect(message).toContain('Address: 12 Main Road, Cape Town\n')
  })

  it('adds the customer note and the tracking link when given', () => {
    const message = buildOrderMessage(
      makeOrder({ customer: { name: 'Thandi Dlamini', phone: '0821234567', note: 'Gate code 4411' } }),
      'https://4nguru.example/order/o1',
    )
    expect(message.endsWith('Total: R540.00\n\nNote: Gate code 4411\n\nTrack your order: https://4nguru.example/order/o1')).toBe(
      true,
    )
  })

  it('adds neither a note nor a tracking link when there are none', () => {
    const message = buildOrderMessage(makeOrder())
    expect(message).not.toContain('Note:')
    expect(message).not.toContain('Track your order')
  })

  it('puts the discount line directly above the delivery line', () => {
    const message = buildOrderMessage(makeOrder({ discountCode: 'SAVE50', discountAmount: 50, total: 490 }))
    expect(message).toContain(
      ['   - Subtotal: R500', '', 'Discount (SAVE50): -R50.00', 'Delivery: Door delivery'].join('\n'),
    )
    expect(message.endsWith('Delivery fee: R40.00\n\nTotal: R490.00')).toBe(true)
  })

  it('puts the discount line above the total when there is no delivery', () => {
    const message = buildOrderMessage(makeOrder({ delivery: null, discountCode: 'SAVE50', discountAmount: 50.5, total: 449.5 }))
    expect(message.endsWith('   - Subtotal: R500\n\nDiscount (SAVE50): -R50.50\n\nTotal: R449.50')).toBe(true)
  })

  it('is identical to the old message when the discount is 0, missing or null', () => {
    const plain = buildOrderMessage(makeOrder())
    expect(buildOrderMessage(makeOrder({ discountAmount: 0, discountCode: null }))).toBe(plain)
    expect(buildOrderMessage(makeOrder({ discountAmount: undefined, discountCode: undefined }))).toBe(plain)
    expect(plain).not.toContain('Discount')
  })
})
