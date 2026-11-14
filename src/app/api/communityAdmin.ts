import { apiFetch } from './client'
import type {
  AdminFitWall,
  AdminGalleryItem,
  AdminFitPhoto,
  GalleryInput,
  ListSendSummary,
  RestockRequest,
  Subscriber,
} from './types'

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

/** The fit wall, with hidden photos and the last sync. */
export function getFitWall(): Promise<AdminFitWall> {
  return apiFetch<AdminFitWall>('/admin/fits', { admin: true })
}

/** Pulls the latest tagged photos from Instagram now. */
export function syncFitWall(): Promise<AdminFitWall> {
  return apiFetch<AdminFitWall>('/admin/fits/sync', { method: 'POST', admin: true })
}

/** Keeps a photo off the public wall. */
export function hideFit(id: string): Promise<AdminFitPhoto> {
  return apiFetch<AdminFitPhoto>(`/admin/fits/${encodeURIComponent(id)}/hide`, { method: 'POST', admin: true })
}

/** Puts a hidden photo back on the public wall. */
export function showFit(id: string): Promise<AdminFitPhoto> {
  return apiFetch<AdminFitPhoto>(`/admin/fits/${encodeURIComponent(id)}/show`, { method: 'POST', admin: true })
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

/** Restock requests, oldest first. `stock` above 0 means the variant is back. */
export function listRestockRequests(): Promise<RestockRequest[]> {
  return apiFetch<RestockRequest[]>('/admin/restock-requests', { admin: true })
}

export async function removeRestockRequest(id: string): Promise<void> {
  await apiFetch<void>(`/admin/restock-requests/${encodeURIComponent(id)}`, { method: 'DELETE', admin: true })
}

/** Past emails to the list, newest first, and whether email is switched on. */
export function getListSends(): Promise<{ emailOn: boolean; sends: ListSendSummary[] }> {
  return apiFetch<{ emailOn: boolean; sends: ListSendSummary[] }>('/admin/list-sends', { admin: true })
}

/** Sends one test copy to `to`. */
export async function sendListTest(input: { subject: string; body: string; to: string }): Promise<void> {
  await apiFetch<{ ok: true }>('/admin/list-sends/test', { method: 'POST', body: input, admin: true })
}

/** Saves a send under a client id (a repeat of the same id returns the same send). Sends nothing yet. */
export function createListSend(id: string, input: { subject: string; body: string }): Promise<ListSendSummary> {
  return apiFetch<ListSendSummary>(`/admin/list-sends/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
    admin: true,
  })
}

/** Sends the next batch of up to 100. Call until `send.pending` is 0. */
export function continueListSend(id: string): Promise<{ send: ListSendSummary; batchFailed: boolean }> {
  return apiFetch<{ send: ListSendSummary; batchFailed: boolean }>(
    `/admin/list-sends/${encodeURIComponent(id)}/continue`,
    { method: 'POST', admin: true },
  )
}
