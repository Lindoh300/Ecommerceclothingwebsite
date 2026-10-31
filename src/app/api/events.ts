import { ApiError, apiFetch } from './client'
import type { PublicEvent, PublicTicket, TicketHolder } from './types'

export type { PublicEvent, PublicTicket, PublicTicketType, TicketHolder } from './types'

/** Public: published events that have not ended, soonest first. With `past`, the ones that have ended, newest first. */
export function listEvents(past = false): Promise<PublicEvent[]> {
  return apiFetch<PublicEvent[]>(past ? '/events?past=1' : '/events')
}

/** Public: a published event by slug, or null (draft, cancelled and unknown events are all 404). */
export async function getEvent(slug: string): Promise<PublicEvent | null> {
  try {
    return await apiFetch<PublicEvent>(`/events/${encodeURIComponent(slug)}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/**
 * Public: free tickets. `id` is kept by the caller for the attempt, so a retry or a double click returns the same
 * tickets. 409 (body `{ code, available? }`) when short, closed or ended; 429 after 5 RSVPs an hour; 400 for a paid type.
 */
export function rsvp(
  slug: string,
  input: { id: string; ticketTypeId: string; quantity: number; holder: TicketHolder },
): Promise<{ tickets: { code: string }[] }> {
  return apiFetch<{ tickets: { code: string }[] }>(`/events/${encodeURIComponent(slug)}/rsvp`, {
    method: 'POST',
    body: input,
  })
}

/** Public: the ticket page's data. The code is the capability. 404 when unknown. */
export function getPublicTicket(code: string): Promise<PublicTicket> {
  return apiFetch<PublicTicket>(`/tickets/${encodeURIComponent(code)}`)
}
