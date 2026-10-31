import { apiFetch } from './client'
import type { AdminGalleryItem, GalleryInput, Subscriber } from './types'

// Admin calls for the gallery and the mailing list. Imported only by the admin screens.

export function listAdminGallery(): Promise<AdminGalleryItem[]> {
  return apiFetch<AdminGalleryItem[]>('/admin/gallery', { admin: true })
}

/** Create or update under a client id. A new item needs `image`. */
export function saveGalleryItem(id: string, input: GalleryInput): Promise<AdminGalleryItem> {
  return apiFetch<AdminGalleryItem>(`/admin/gallery/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
    admin: true,
  })
}

export async function deleteGalleryItem(id: string): Promise<void> {
  await apiFetch<void>(`/admin/gallery/${encodeURIComponent(id)}`, { method: 'DELETE', admin: true })
}

/** Newest first, opted-out people included. */
export function listSubscribers(): Promise<Subscriber[]> {
  return apiFetch<Subscriber[]>('/admin/subscribers', { admin: true })
}

/** Opts a subscriber out. Doing it twice keeps the first time. */
export function unsubscribeSubscriber(id: string): Promise<Subscriber> {
  return apiFetch<Subscriber>(`/admin/subscribers/${encodeURIComponent(id)}/unsubscribe`, {
    method: 'POST',
    admin: true,
  })
}
