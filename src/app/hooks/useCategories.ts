import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { listCategories } from '../api/categories'
import type { Category } from '../api/types'

interface CategoriesState {
  categories: Category[]
  loaded: boolean
  loading: boolean
  error: string | null
}

let state: CategoriesState = { categories: [], loaded: false, loading: false, error: null }
const listeners = new Set<() => void>()
let inFlight: Promise<Category[]> | null = null

function setState(next: Partial<CategoriesState>) {
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

// Same empty state on the server and in the first client render, so hydration matches. The cache
// is per browser tab, never filled on the server.
const serverState: CategoriesState = { categories: [], loaded: false, loading: false, error: null }

function getServerSnapshot() {
  return serverState
}

export function loadCategories(force = false): Promise<Category[]> {
  if (inFlight) return inFlight
  if (state.loaded && !force) return Promise.resolve(state.categories)

  setState({ loading: true, error: null })
  inFlight = listCategories()
    .then((categories) => {
      setState({ categories, loaded: true, loading: false, error: null })
      return categories
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to load categories'
      setState({ loading: false, error: message })
      throw err
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export function useCategories(): {
  categories: Category[]
  loading: boolean
  error: string | null
  reload: () => Promise<Category[]>
} {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  // Kick off the initial load once, in the browser after mount. Skip after a failure so a failing API does not cause a request loop.
  useEffect(() => {
    if (!state.loaded && !state.loading && !state.error) loadCategories().catch(() => {})
  }, [snap.loaded, snap.loading, snap.error])
  const reload = useCallback(() => loadCategories(true), [])
  return {
    categories: snap.categories,
    loading: snap.loading || (!snap.loaded && !snap.error),
    error: snap.error,
    reload,
  }
}
