import { apiFetch } from './client'
import type {
  CartQuote,
  CartQuoteDiscount,
  CartQuoteItem,
  Customer,
  DeliveryInput,
  DeliveryOption,
  Order,
  PaymentMethod,
  PublicOrder,
  ShopConfig,
  TrackingInput,
} from './types'

export type {
  CartQuoteDiscount,
  Customer,
  DeliveryAddress,
  DeliveryInput,
  DeliveryMethod,
  DeliveryOption,
  Order,
  OrderLine,
  OrderStatus,
  OrderTracking,
  PaymentMethod,
  PublicOrder,
  ShopConfig,
  StockShortfall,
  TrackingInput,
} from './types'

/** Active delivery options with their prices, in display order. Public. */
export function listDeliveryOptions(): Promise<DeliveryOption[]> {
  return apiFetch<DeliveryOption[]>('/delivery-options')
}

export function placeOrder(input: {
  id: string
  items: CartQuoteItem[]
  customer: Customer
  /** Left out: the order goes ahead without delivery details. */
  delivery?: DeliveryInput
  paymentMethod?: PaymentMethod
  /** Left out when there is no code. A refused code is a 409 with `code` `discount_invalid` or `discount_minimum`; nothing is kept. */
  discountCode?: string
}): Promise<Order> {
  return apiFetch<Order>('/orders', { method: 'POST', body: input })
}

/**
 * Public: asks the server whether a discount code works for these items, through the cart quote. Returns the quote's
 * `discount` part: `{ code, amount }` or `{ error, code }` (`discount_invalid`, `discount_minimum`, `rate_limited`).
 */
export async function checkDiscountCode(items: CartQuoteItem[], code: string): Promise<CartQuoteDiscount> {
  const quote = await apiFetch<CartQuote>('/cart/quote', { method: 'POST', body: { items, discountCode: code } })
  return quote.discount ?? { error: 'That code could not be checked. Please try again.', code: 'discount_invalid' }
}

/**
 * Admin: an order the owner enters for a customer. Same body as `placeOrder`, but no 10-unit cap and no per-address
 * limit. `paymentMethod: 'online'` makes a payment link: it needs the customer's email and keeps its stock 48 hours.
 * 409 (body `{ short }`) when stock is short; 503 when online payment is off.
 */
export function createAdminOrder(input: {
  id: string
  items: CartQuoteItem[]
  customer: Customer
  delivery?: DeliveryInput
  paymentMethod?: PaymentMethod
}): Promise<Order> {
  return apiFetch<Order>('/admin/orders', { method: 'POST', body: input, admin: true })
}

export function listOrders(): Promise<Order[]> {
  return apiFetch<Order[]>('/orders', { admin: true })
}

export function cancelOrder(id: string): Promise<Order> {
  return apiFetch<Order>(`/orders/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    admin: true,
  })
}

export function markOrderPaid(id: string): Promise<Order> {
  return apiFetch<Order>(`/orders/${encodeURIComponent(id)}/mark-paid`, {
    method: 'POST',
    admin: true,
  })
}

/** The statuses an admin can set with `setOrderStatus`. Cancelling uses `cancelOrder`. */
export type AdminOrderStatus = 'packed' | 'shipped' | 'delivered' | 'refunded'

/** paid -> packed -> shipped -> delivered, or refunded. A 409 means the order is no longer where the screen thought. */
export function setOrderStatus(id: string, status: AdminOrderStatus): Promise<Order> {
  return apiFetch<Order>(`/orders/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: { status },
    admin: true,
  })
}

/** Courier, number and https link, for a packed or shipped order. */
export function setOrderTracking(id: string, tracking: TrackingInput): Promise<Order> {
  return apiFetch<Order>(`/orders/${encodeURIComponent(id)}/tracking`, {
    method: 'POST',
    body: tracking,
    admin: true,
  })
}

/** 48 more hours for a pending order. */
export function extendOrder(id: string): Promise<Order> {
  return apiFetch<Order>(`/orders/${encodeURIComponent(id)}/extend`, {
    method: 'POST',
    admin: true,
  })
}

/** Public: an order by its id, with the customer's details left out. 404 when unknown. */
export function getPublicOrder(id: string): Promise<PublicOrder> {
  return apiFetch<PublicOrder>(`/orders/${encodeURIComponent(id)}/public`)
}

/** Public: the id of the order with this reference and phone. 404 for any miss, 429 after 10 tries an hour. */
export function lookupOrder(input: { ref: string; phone: string }): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/orders/lookup', { method: 'POST', body: input })
}

/** Public shop settings. Any failure (including a server without the route) means online payment is off. */
export async function getShopConfig(): Promise<ShopConfig> {
  try {
    const config = await apiFetch<Partial<ShopConfig>>('/config')
    return { onlinePayments: config?.onlinePayments === true }
  } catch {
    return { onlinePayments: false }
  }
}

/** Public: start payment for an order. 503 when online payment is off, 409 when the order can't be paid. */
export function payOrder(id: string): Promise<{ redirectUrl: string }> {
  return apiFetch<{ redirectUrl: string }>(`/orders/${encodeURIComponent(id)}/pay`, { method: 'POST' })
}
