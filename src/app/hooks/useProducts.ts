import { useCallback, useSyncExternalStore } from 'react'
import { listProducts } from '../api/products'
import type { Product } from '../api/types'

interface ProductsState {
  products: Product[]
  loaded: boolean
  loading: boolean
  error: string | null
}

let state: ProductsState = { products: [], loaded: false, loading: false, error: null }
const listeners = new Set<() => void>()
let inFlight: Promise<Product[]> | null = null

function setState(next: Partial<ProductsState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return state
}

export function loadProducts(force = false): Promise<Product[]> {
  if (inFlight) return inFlight
  if (state.loaded && !force) return Promise.resolve(state.products)

  setState({ loading: true, error: null })
  inFlight = listProducts()
    .then((products) => {
      setState({ products, loaded: true, loading: false, error: null })
      return products
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to load products'
      setState({ loading: false, error: message })
      throw err
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export function getCachedProducts(): Product[] {
  return state.products
}

/** By id or slug. */
export function getCachedProduct(idOrSlug: string): Product | undefined {
  return state.products.find((p) => p.id === idOrSlug) ?? state.products.find((p) => p.slug === idOrSlug)
}

export function setCachedProducts(products: Product[]): void {
  setState({ products, loaded: true, error: null })
}

function useProductsState(): ProductsState {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  // Kick off the initial load once, after subscribing. Skip if a previous
  // attempt failed so a failing API does not cause a request loop.
  if (!snap.loaded && !snap.loading && !snap.error) {
    queueMicrotask(() => {
      if (!state.loaded && !state.loading && !state.error) loadProducts().catch(() => {})
    })
  }
  return snap
}

export function useProducts(): {
  products: Product[]
  loading: boolean
  error: string | null
  reload: () => Promise<Product[]>
} {
  const snap = useProductsState()
  const reload = useCallback(() => loadProducts(true), [])
  return { products: snap.products, loading: snap.loading || (!snap.loaded && !snap.error), error: snap.error, reload }
}

export function useProduct(id: string | undefined): {
  product: Product | undefined
  loading: boolean
  error: string | null
} {
  const snap = useProductsState()
  const product = id ? (snap.products.find((p) => p.id === id) ?? snap.products.find((p) => p.slug === id)) : undefined
  return { product, loading: snap.loading || (!snap.loaded && !snap.error), error: snap.error }
}
