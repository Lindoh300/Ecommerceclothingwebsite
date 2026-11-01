import { apiFetch } from './client'
import type { CustomerSummary } from './types'

// Admin calls for customers. Imported only by the admin screens.

/** Every customer, newest last order first, as the server gives them. */
export function listCustomers(): Promise<CustomerSummary[]> {
  return apiFetch<CustomerSummary[]>('/admin/customers', { admin: true })
}
