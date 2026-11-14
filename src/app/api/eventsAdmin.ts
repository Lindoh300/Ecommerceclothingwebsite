import { apiFetch } from './client'
import type {
  AdminEvent,
  AdminTicket,
  AdminTicketType,
  CheckInResponse,
  EventInput,
  TicketHolder,
  TicketTypeInput,
} from './types'

// Admin calls for events and tickets. Imported only by the admin screens.

export function listAdminEvents(): Promise<AdminEvent[]> {
  return apiFetch<AdminEvent[]>('/admin/events', { admin: true })
}

/** Create or update under a client id. A new event needs `title` and `startsAt`. */
export function saveEvent(id: string, input: EventInput): Promise<AdminEvent> {
  return apiFetch<AdminEvent>(`/admin/events/${encodeURIComponent(id)}`, { method: 'PUT', body: input, admin: true })
}

/** 409 when the event has tickets. */
export async function deleteEvent(id: string): Promise<void> {
  await apiFetch<void>(`/admin/events/${encodeURIComponent(id)}`, { method: 'DELETE', admin: true })
}

/** Create (needs `eventId` and `name`) or update. 409 when capacity would go below the tickets sold. */
export function saveTicketType(id: string, input: TicketTypeInput): Promise<AdminTicketType> {
  return apiFetch<AdminTicketType>(`/admin/ticket-types/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
    admin: true,
  })
}

/** 409 once any ticket has been issued for the type. */
export async function deleteTicketType(id: string): Promise<void> {
  await apiFetch<void>(`/admin/ticket-types/${encodeURIComponent(id)}`, { method: 'DELETE', admin: true })
}

/** Tickets the owner issues for a paid or free type, 1 to 20. `id` makes a retry return the same tickets. */
export function issueTickets(input: {
  id: string
  ticketTypeId: string
  quantity: number
  holder: TicketHolder
}): Promise<{ tickets: AdminTicket[] }> {
  return apiFetch<{ tickets: AdminTicket[] }>('/admin/tickets', { method: 'POST', body: input, admin: true })
}

/** Every ticket of an event, holder details included. */
export function listEventTickets(eventId: string): Promise<AdminTicket[]> {
  return apiFetch<AdminTicket[]>(`/admin/events/${encodeURIComponent(eventId)}/tickets`, { admin: true })
}

/**
 * First call wins. A second scan is `result: 'already'` with the time, not an error. `at` is an offline scan time
 * (kept by the server only if within the past 24 hours); `eventId` refuses a ticket of another event.
 */
export function checkInTicket(code: string, opts: { at?: string; eventId?: string } = {}): Promise<CheckInResponse> {
  return apiFetch<CheckInResponse>(`/admin/tickets/${encodeURIComponent(code)}/check-in`, {
    method: 'POST',
    body: opts,
    admin: true,
  })
}

/** Gives the seat back, once. 409 for a ticket that was used at the door. */
export function voidTicket(code: string): Promise<{ ticket: AdminTicket; changed: boolean }> {
  return apiFetch<{ ticket: AdminTicket; changed: boolean }>(`/admin/tickets/${encodeURIComponent(code)}/void`, {
    method: 'POST',
    admin: true,
  })
}
