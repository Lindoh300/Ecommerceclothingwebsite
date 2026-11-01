import { apiFetch } from './client'
import type { Discount, DiscountInput } from './types'

// Admin calls for discount codes. Imported only by the admin screens.

/** Every discount code, newest first, with its use count. */
export function listDiscounts(): Promise<Discount[]> {
  return apiFetch<Discount[]>('/admin/discounts', { admin: true })
}

/**
 * Creates a code, or updates the one with this id. 409 with `code: 'code_taken'` when another code already has the
 * same text. There is no delete: a code is turned off with `active: false`.
 */
export function saveDiscount(id: string, input: DiscountInput): Promise<Discount> {
  return apiFetch<Discount>(`/admin/discounts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
    admin: true,
  })
}
