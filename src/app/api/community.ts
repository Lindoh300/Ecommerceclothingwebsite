import { apiFetch } from './client'
import type { PublicFitPhoto, PublicGalleryItem, SubscriberSource } from './types'

export type { PublicFitPhoto, PublicGalleryItem, SubscriberSource } from './types'

/** Public: the active gallery photos, in the order the owner chose. */
export function getGallery(): Promise<PublicGalleryItem[]> {
  return apiFetch<PublicGalleryItem[]>('/gallery')
}

/** Public: the tagged Instagram photos for "Your fit, here", newest first. */
export function getFits(): Promise<PublicFitPhoto[]> {
  return apiFetch<PublicFitPhoto[]>('/fits')
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

/**
 * Public: asks to be told when a sold-out variant is back. Send exactly one of `phone` or `email`. 404 for an unknown
 * product or variant, 409 (`code: in_stock`) when it is already in stock, 429 (`code: rate_limited`) after too many
 * requests from one connection, 400 for a bad request.
 */
export async function requestRestockAlert(
  productId: string,
  input: { variantId: string; phone?: string; email?: string },
): Promise<void> {
  await apiFetch<{ ok: true }>(`/products/${encodeURIComponent(productId)}/restock-alert`, { method: 'POST', body: input })
}
