import { apiFetch } from './client'
import type { PublicGalleryItem, SubscriberSource } from './types'

export type { PublicGalleryItem, SubscriberSource } from './types'

/** Public: the active gallery photos, in the order the owner chose. */
export function getGallery(): Promise<PublicGalleryItem[]> {
  return apiFetch<PublicGalleryItem[]>('/gallery')
}

/**
 * Public: joins the mailing list. `consent` must be exactly true; the server stores its own consent wording (see
 * communityConsent.ts). The answer is `{ ok: true }` for a new and a repeat sign-up alike. 400 for a bad request,
 * 429 after 5 sign-ups an hour from one connection.
 */
export function subscribe(input: {
  name?: string
  phone?: string
  email?: string
  consent: true
  source: SubscriberSource
}): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/subscribers', { method: 'POST', body: input })
}

/**
 * Public: removes a phone number or email address from the mailing list. The answer is `{ ok: true }` for any valid
 * contact, whether or not it was on the list, so the page never reveals who signed up. 400 for a bad request, 429
 * after 5 requests an hour from one connection.
 */
export function unsubscribe(input: { phone?: string; email?: string }): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/subscribers/unsubscribe', { method: 'POST', body: input })
}
