import { apiFetch } from './client'
import type { CartQuoteItem, Customer, DeliveryInput, DeliveryOption, Order } from './types'

export type {
  Customer,
  DeliveryAddress,
  DeliveryInput,
  DeliveryMethod,
  DeliveryOption,
  Order,
  OrderLine,
  OrderStatus,
  StockShortfall,
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
}): Promise<Order> {
  return apiFetch<Order>('/orders', { method: 'POST', body: input })
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
