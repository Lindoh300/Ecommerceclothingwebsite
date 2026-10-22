import { apiFetch } from './client'
import type { CartQuoteItem, Customer, Order } from './types'

export type { Customer, Order, OrderLine, OrderStatus, StockShortfall } from './types'

export function placeOrder(input: {
  id: string
  items: CartQuoteItem[]
  customer: Customer
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
