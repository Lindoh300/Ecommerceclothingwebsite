import { apiFetch } from './client'
import type { Category, CategoryInput } from './types'

/** Active categories for the shop. With `all`, an admin call that includes inactive ones. */
export function listCategories(all = false): Promise<Category[]> {
  return all
    ? apiFetch<Category[]>('/categories?all=1', { admin: true })
    : apiFetch<Category[]>('/categories')
}

export function saveCategory(id: string, input: CategoryInput): Promise<Category> {
  return apiFetch<Category>(`/categories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
    admin: true,
  })
}

/** Rejects with an ApiError (409, body.count) when products still use the category. */
export async function deleteCategory(id: string): Promise<void> {
  await apiFetch<void>(`/categories/${encodeURIComponent(id)}`, { method: 'DELETE', admin: true })
}
