import { ApiError, apiFetch } from './client'
import type { CartQuote, CartQuoteItem, Product, ProductInput } from './types'

export function listProducts(): Promise<Product[]> {
  return apiFetch<Product[]>('/products')
}

export async function getProduct(id: string): Promise<Product | null> {
  try {
    return await apiFetch<Product>(`/products/${encodeURIComponent(id)}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export function createProduct(input: ProductInput): Promise<Product> {
  return apiFetch<Product>('/products', { method: 'POST', body: input, admin: true })
}

export function updateProduct(
  id: string,
  patch: Partial<ProductInput>,
  expectedStock?: number,
): Promise<Product> {
  const body = expectedStock === undefined ? patch : { ...patch, expectedStock }
  return apiFetch<Product>(`/products/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
    admin: true,
  })
}

export async function deleteProduct(id: string): Promise<void> {
  await apiFetch<void>(`/products/${encodeURIComponent(id)}`, { method: 'DELETE', admin: true })
}

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const { url } = await apiFetch<{ url: string }>('/images', {
    method: 'POST',
    form,
    admin: true,
  })
  return url
}

export function quoteCart(items: CartQuoteItem[]): Promise<CartQuote> {
  return apiFetch<CartQuote>('/cart/quote', { method: 'POST', body: { items } })
}
