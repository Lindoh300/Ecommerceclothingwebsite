import { describe, expect, it } from 'vitest'
import type { Order, OrderStatus } from '../api/types'
import {
  addressLine,
  buildOrderLinkMessage,
  buildOrderUpdateMessage,
  toWhatsAppNumber,
  whatsappUrlFor,
} from './adminOrder'

const ORDER_URL = 'https://4nguru.example/order/o1'

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

describe('addressLine', () => {
  it('joins a full address with commas', () => {
    expect(addressLine(makeOrder().delivery)).toBe('12 Main Road, Flat 3, Sea Point, Cape Town, 8005')
  })

  it('joins only the parts that are there for a partial address', () => {
    const delivery = {
      method: 'door',
      address: { line1: '12 Main Road', suburb: '', city: 'Cape Town', postalCode: '' },
      fee: 40,
    }
    expect(addressLine(delivery)).toBe('12 Main Road, Cape Town')
  })

  it('returns an empty string for null or undefined', () => {
    expect(addressLine(null)).toBe('')
    expect(addressLine(undefined)).toBe('')
  })

  it('returns an empty string for a delivery with no address, such as a locker', () => {
    expect(addressLine({ method: 'locker', locker: 'ABC123', fee: 35 })).toBe('')
  })
})

describe('toWhatsAppNumber', () => {
  it('turns a local number with a leading 0 into 27 and digits only', () => {
    expect(toWhatsAppNumber('0821234567')).toBe('27821234567')
  })

  it('strips spaces from a spaced local number', () => {
    expect(toWhatsAppNumber('082 123 4567')).toBe('27821234567')
  })

  it('drops the plus sign from an international number', () => {
    expect(toWhatsAppNumber('+27 82 123 4567')).toBe('27821234567')
  })

  it('keeps an international number that has no plus sign', () => {
    expect(toWhatsAppNumber('27821234567')).toBe('27821234567')
  })

  it('drops the stray (0) after +27', () => {
    expect(toWhatsAppNumber('+27 (0) 82 123 4567')).toBe('27821234567')
  })

  it('drops a leading 00 international prefix', () => {
    expect(toWhatsAppNumber('0027 82 123 4567')).toBe('27821234567')
  })

  it('gives the shop number from shop.ts in wa.me form', () => {
    expect(toWhatsAppNumber('+27 67 868 4428')).toBe('27678684428')
  })

  it('adds 27 to a 9-digit mobile written without its leading 0', () => {
    expect(toWhatsAppNumber('821234567')).toBe('27821234567')
  })

  it('keeps a 9-digit foreign number with a plus sign as it is', () => {
    expect(toWhatsAppNumber('+821234567')).toBe('821234567')
  })

  it('returns an empty string for an unusable number', () => {
    expect(toWhatsAppNumber('')).toBe('')
    expect(toWhatsAppNumber('12345')).toBe('')
    expect(toWhatsAppNumber('123456')).toBe('')
    expect(toWhatsAppNumber('call me')).toBe('')
  })
})

describe('whatsappUrlFor', () => {
  it('builds a wa.me link with the encoded text', () => {
    expect(whatsappUrlFor('082 123 4567', 'Hi Thandi')).toBe('https://wa.me/27821234567?text=Hi%20Thandi')
  })

  it('encodes &, #, ? and newlines so they reach the chat intact', () => {
    expect(whatsappUrlFor('0821234567', 'a & b # c ? d\ne')).toBe(
      'https://wa.me/27821234567?text=a%20%26%20b%20%23%20c%20%3F%20d%0Ae',
    )
  })

  it('returns null for an unusable number', () => {
    expect(whatsappUrlFor('12345', 'Hi')).toBeNull()
    expect(whatsappUrlFor('', 'Hi')).toBeNull()
  })
})

describe('buildOrderLinkMessage', () => {
  it('asks an awaiting-payment customer to pay, with the first name and total', () => {
    expect(buildOrderLinkMessage(makeOrder({ status: 'awaiting_payment' }), ORDER_URL)).toBe(
      `Hi Thandi, your 4Nguru order NG-1001 is ready (total R540.00).\nPay securely and see your order here: ${ORDER_URL}`,
    )
  })

  it('gives only the link for any other status', () => {
    expect(buildOrderLinkMessage(makeOrder({ status: 'pending' }), ORDER_URL)).toBe(
      `Hi Thandi, your 4Nguru order NG-1001 is ready (total R540.00).\nSee your order here: ${ORDER_URL}`,
    )
  })

  it('uses "there" when the name is blank', () => {
    const message = buildOrderLinkMessage(makeOrder({ customer: { name: '   ', phone: '0821234567' } }), ORDER_URL)
    expect(message.startsWith('Hi there, your 4Nguru order')).toBe(true)
  })
})

describe('buildOrderUpdateMessage', () => {
  const cases: [OrderStatus, string][] = [
    ['pending', 'Hi Thandi, your 4Nguru order NG-1001 is waiting for payment (total R540.00).'],
    ['awaiting_payment', 'Hi Thandi, your 4Nguru order NG-1001 is waiting for payment (total R540.00).'],
    ['paid', 'Hi Thandi, we have received your payment for 4Nguru order NG-1001. Thank you.'],
    ['packed', 'Hi Thandi, your 4Nguru order NG-1001 is packed.'],
    ['shipped', 'Hi Thandi, your 4Nguru order NG-1001 has shipped.'],
    ['delivered', 'Hi Thandi, your 4Nguru order NG-1001 has been delivered. Thank you for shopping with us.'],
    ['cancelled', 'Hi Thandi, your 4Nguru order NG-1001 has been cancelled.'],
    ['expired', 'Hi Thandi, your 4Nguru order NG-1001 expired before it was paid.'],
    ['refunded', 'Hi Thandi, your 4Nguru order NG-1001 has been refunded.'],
  ]

  it.each(cases)('gives the right sentence for status %s', (status, sentence) => {
    expect(buildOrderUpdateMessage(makeOrder({ status }), ORDER_URL)).toBe(
      `${sentence}\nSee your order here: ${ORDER_URL}`,
    )
  })

  it('adds courier, tracking number and tracking link once shipped', () => {
    const message = buildOrderUpdateMessage(
      makeOrder({
        status: 'shipped',
        tracking: { courier: 'The Courier Guy', number: 'TCG998877', url: 'https://tracking.example/TCG998877' },
      }),
      ORDER_URL,
    )
    expect(message).toBe(
      [
        'Hi Thandi, your 4Nguru order NG-1001 has shipped.',
        'Courier: The Courier Guy',
        'Tracking number: TCG998877',
        'Track your parcel: https://tracking.example/TCG998877',
        `See your order here: ${ORDER_URL}`,
      ].join('\n'),
    )
  })

  it('leaves out only the tracking lines that are not set', () => {
    const message = buildOrderUpdateMessage(
      makeOrder({ status: 'shipped', tracking: { courier: 'Postnet', number: null, url: null } }),
      ORDER_URL,
    )
    expect(message).toBe(
      `Hi Thandi, your 4Nguru order NG-1001 has shipped.\nCourier: Postnet\nSee your order here: ${ORDER_URL}`,
    )
  })

  it('leaves tracking out of a shipped order that has none', () => {
    const message = buildOrderUpdateMessage(makeOrder({ status: 'shipped', tracking: null }), ORDER_URL)
    expect(message).not.toContain('Courier')
    expect(message).not.toContain('Tracking number')
  })

  it('never includes the address or the customer note', () => {
    const message = buildOrderUpdateMessage(
      makeOrder({
        status: 'shipped',
        customer: { name: 'Thandi Dlamini', phone: '0821234567', note: 'Gate code 4411' },
      }),
      ORDER_URL,
    )
    expect(message).not.toContain('Main Road')
    expect(message).not.toContain('Gate code')
  })

  it('uses "there" when the name is blank', () => {
    const message = buildOrderUpdateMessage(makeOrder({ customer: { name: '', phone: '0821234567' } }), ORDER_URL)
    expect(message.startsWith('Hi there, your 4Nguru order NG-1001')).toBe(true)
  })
})
