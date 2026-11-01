import { apiFetch } from './client'
import type { DeliveryOptionAdmin, DeliveryOptionInput } from './types'

// Admin calls for delivery options. Imported only by the admin screens.

/** Every delivery option, active or not. */
export function listDeliveryOptionsAdmin(): Promise<DeliveryOptionAdmin[]> {
  return apiFetch<DeliveryOptionAdmin[]>('/admin/delivery-options', { admin: true })
}

/** 409 with `code: 'last_active'` when the change would leave no option on. */
export function updateDeliveryOption(id: string, patch: DeliveryOptionInput): Promise<DeliveryOptionAdmin> {
  return apiFetch<DeliveryOptionAdmin>(`/admin/delivery-options/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: patch,
    admin: true,
  })
}
