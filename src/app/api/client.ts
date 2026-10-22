import { supabase } from '../lib/supabase'

export class ApiError extends Error {
  status: number
  body?: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export function apiBase(): string {
  const explicit = import.meta.env.VITE_API_BASE
  if (explicit) return explicit.replace(/\/+$/, '')
  const url = import.meta.env.VITE_SUPABASE_URL
  if (url) return `${url.replace(/\/+$/, '')}/functions/v1/make-server-fbb8f0e1`
  throw new Error(
    'API not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or VITE_API_BASE) in .env',
  )
}

interface ApiOptions {
  method?: string
  body?: unknown
  form?: FormData
  admin?: boolean
}

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const base = apiBase()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const headers: Record<string, string> = {}
  if (anonKey) headers.apikey = anonKey

  if (opts.admin) {
    if (supabase) {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new ApiError(401, 'Not signed in')
      headers.Authorization = `Bearer ${token}`
    } else if (!anonKey) {
      headers.Authorization = 'Bearer dev-admin'
    } else {
      headers.Authorization = `Bearer ${anonKey}`
    }
  } else if (anonKey) {
    headers.Authorization = `Bearer ${anonKey}`
  }

  let body: BodyInit | undefined
  if (opts.form) {
    body = opts.form
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
    })
  } catch {
    throw new ApiError(0, 'Network error')
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    let errBody: unknown
    try {
      const data = await res.json()
      errBody = data
      if (data && typeof data.error === 'string') message = data.error
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message, errBody)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
