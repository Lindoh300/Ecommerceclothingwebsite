import type { Context, Hono } from 'npm:hono';
import { clientIp } from './app.ts';
import type { Deps, IssueResult, PublicTicket, Ticket } from './types.ts';
import {
  TICKET_CODE_RE,
  UUID_RE,
  validateEventInput,
  validateTicketRequest,
  validateTicketTypeInput,
} from './validation.ts';

const PREFIX = '/make-server-fbb8f0e1';
/** Most tickets one RSVP may take, and one owner-issued request. */
const MAX_RSVP = 4;
const MAX_ISSUE = 20;

/** The first word of a name, up to 40 characters. */
const firstName = (name: string): string => (name.trim().split(/\s+/)[0] ?? '').slice(0, 40);

/**
 * What the public ticket page may see of a ticket. Built field by field from an allow-list, so a field added to
 * Ticket later stays private until it is listed here. Never copied from the ticket: no holder phone, email or
 * full name, no ids, no code, no group id, no source.
 */
export function toPublicTicket(t: Ticket): PublicTicket {
  return {
    eventTitle: t.eventTitle,
    eventSlug: t.eventSlug,
    startsAt: t.startsAt,
    venue: t.venue,
    city: t.city,
    ticketTypeName: t.ticketTypeName,
    holderFirstName: firstName(t.holderName),
    status: t.voidedAt ? 'void' : t.checkedInAt ? 'used' : 'valid',
    checkedInAt: t.checkedInAt ?? null,
  };
}

type Guard = (c: Context) => Promise<Response | null>;

/**
 * Registers the event and ticket routes on `app`. `guard` returns an error Response when the caller is not an
 * admin, else null; every /admin route calls it before it reads anything.
 *   Public: GET /events, GET /events/:slug, POST /events/:slug/rsvp, GET /tickets/:code
 *   Admin:  GET /admin/events, PUT and DELETE /admin/events/:id, PUT and DELETE /admin/ticket-types/:id,
 *           POST /admin/tickets, GET /admin/events/:id/tickets,
 *           POST /admin/tickets/:code/check-in, POST /admin/tickets/:code/void
 */
export function registerEventRoutes(app: Hono, deps: Deps, guard: Guard): void {
  const events = deps.events;

  const readJson = async (c: Context): Promise<{ ok: true; body: unknown } | { ok: false }> => {
    try {
      return { ok: true, body: await c.req.json() };
    } catch {
      return { ok: false };
    }
  };

  /** The error response for a failed issue or RSVP. */
  const issueFailure = (c: Context, r: Extract<IssueResult, { ok: false }>) => {
    switch (r.reason) {
      case 'sold_out':
        return c.json({ error: 'Not enough tickets left', code: 'sold_out', available: r.available }, 409);
      case 'rate_limited':
        c.header('Retry-After', '3600');
        return c.json({
          error: 'Too many RSVPs from this connection. Please try again in an hour or message us on WhatsApp.',
          code: 'rate_limited',
        }, 429);
      case 'not_found':
        return c.json({ error: 'Event or ticket type not found' }, 404);
      case 'paid_type':
        return c.json({ error: 'This ticket is not free. Get it on WhatsApp.', code: 'paid_type' }, 400);
      case 'bad_quantity':
        return c.json({ error: 'quantity is out of range' }, 400);
      case 'event_ended':
        return c.json({ error: 'This event has ended', code: 'event_ended' }, 409);
      case 'not_on_sale':
        return c.json({ error: 'These tickets are not on sale', code: 'not_on_sale' }, 409);
      case 'event_cancelled':
        return c.json({ error: 'This event is cancelled', code: 'event_cancelled' }, 409);
      default:
        return c.json({ error: 'That id was already used for something else', code: 'id_taken' }, 409);
    }
  };

  // --- Public -----------------------------------------------------------------------------------------------

  // Published events that have not ended, soonest first. ?past=1: the ones that have ended, newest first.
  app.get(`${PREFIX}/events`, async (c) => c.json(await events.listPublic(c.req.query('past') === '1')));

  app.get(`${PREFIX}/events/:slug`, async (c) => {
    const event = await events.getPublic(c.req.param('slug'));
    if (!event) return c.json({ error: 'Event not found' }, 404);
    return c.json(event);
  });

  // Free tickets. The body id is the group id: a retry returns the same tickets and takes no capacity again. Only
  // the codes are returned; the customer opens /ticket/:code for the rest. 5 RSVPs per address per hour.
  app.post(`${PREFIX}/events/:slug/rsvp`, async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateTicketRequest(parsed.body, MAX_RSVP);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const ip = clientIp(c.req.raw.headers);
    const r = await events.rsvp(
      v.value.id,
      c.req.param('slug'),
      v.value.ticketTypeId,
      v.value.quantity,
      v.value.holder,
      ip ?? undefined,
    );
    if (!r.ok) return issueFailure(c, r);
    return c.json({ tickets: r.tickets.map((t) => ({ code: t.code })) }, r.created ? 201 : 200);
  });

  // The ticket code is the capability. Allow-listed fields only (toPublicTicket); an unknown or malformed code is the
  // same 404. Never cached: a ticket's status changes at the door.
  app.get(`${PREFIX}/tickets/:code`, async (c) => {
    c.header('Cache-Control', 'no-store');
    const code = c.req.param('code');
    if (!TICKET_CODE_RE.test(code)) return c.json({ error: 'Ticket not found' }, 404);
    const ticket = await events.getTicket(code);
    if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
    return c.json(toPublicTicket(ticket));
  });

  // --- Admin ------------------------------------------------------------------------------------------------

  app.get(`${PREFIX}/admin/events`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    return c.json(await events.listAdmin());
  });

  // Create or update under a client id. A new event needs title and startsAt.
  app.put(`${PREFIX}/admin/events/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'id must be a UUID' }, 400);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateEventInput(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const r = await events.upsertEvent(id.toLowerCase(), v.value);
    if (!r.ok) {
      if (r.reason === 'slug_taken') return c.json({ error: 'That link is already used by another event' }, 409);
      if (r.reason === 'bad_dates') return c.json({ error: 'The event cannot end before it starts' }, 400);
      return c.json({ error: 'A new event needs a title and a start time' }, 400);
    }
    return c.json(r.event, r.created ? 201 : 200);
  });

  app.delete(`${PREFIX}/admin/events/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Event not found' }, 404);
    const r = await events.deleteEvent(id.toLowerCase());
    if (!r.ok) {
      if (r.reason === 'not_found') return c.json({ error: 'Event not found' }, 404);
      return c.json({ error: 'Tickets have been issued for this event. Cancel it instead.' }, 409);
    }
    return c.body(null, 204);
  });

  // Create or update under a client id. A new type needs eventId and name. Capacity cannot go below sold.
  app.put(`${PREFIX}/admin/ticket-types/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'id must be a UUID' }, 400);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateTicketTypeInput(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const r = await events.upsertTicketType(id.toLowerCase(), v.value);
    if (!r.ok) {
      if (r.reason === 'capacity_below_sold') {
        return c.json({ error: 'Capacity cannot be lower than the tickets already sold', sold: r.sold }, 409);
      }
      if (r.reason === 'event_not_found') return c.json({ error: 'A new ticket type needs the id of an existing event' }, 400);
      if (r.reason === 'bad_dates') return c.json({ error: 'The sale cannot end before it starts' }, 400);
      return c.json({ error: 'A new ticket type needs an event and a name' }, 400);
    }
    return c.json(r.ticketType, r.created ? 201 : 200);
  });

  app.delete(`${PREFIX}/admin/ticket-types/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Ticket type not found' }, 404);
    const r = await events.deleteTicketType(id.toLowerCase());
    if (!r.ok) {
      if (r.reason === 'not_found') return c.json({ error: 'Ticket type not found' }, 404);
      return c.json({ error: 'Tickets have been issued for this type. Set it inactive instead.' }, 409);
    }
    return c.body(null, 204);
  });

  // Tickets the owner issues (someone paid on WhatsApp or at the door): paid or free, 1 to 20. Full ticket details.
  app.post(`${PREFIX}/admin/tickets`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateTicketRequest(parsed.body, MAX_ISSUE);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const r = await events.issue(v.value.id, v.value.ticketTypeId, v.value.quantity, v.value.holder);
    if (!r.ok) return issueFailure(c, r);
    return c.json({ tickets: r.tickets }, r.created ? 201 : 200);
  });

  // The ticket list for the door and the owner, holder details included.
  app.get(`${PREFIX}/admin/events/:id/tickets`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Event not found' }, 404);
    const list = await events.listTickets(id.toLowerCase());
    if (!list) return c.json({ error: 'Event not found' }, 404);
    return c.json(list);
  });

  // First call wins. A second scan is 'already' with the time, not an error status. The body is optional:
  // {at?} is an offline scan time (kept if within the past 24 hours), {eventId?} refuses a ticket of another event.
  app.post(`${PREFIX}/admin/tickets/:code/check-in`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const code = c.req.param('code');
    let at: string | undefined;
    let eventId: string | undefined;
    const parsed = await readJson(c);
    if (parsed.ok && parsed.body !== null && typeof parsed.body === 'object' && !Array.isArray(parsed.body)) {
      const body = parsed.body as Record<string, unknown>;
      if (body.at !== undefined && body.at !== null) {
        const t = typeof body.at === 'string' && body.at.length <= 40 ? Date.parse(body.at) : NaN;
        if (Number.isNaN(t)) return c.json({ error: 'at must be an ISO date and time' }, 400);
        at = new Date(t).toISOString();
      }
      if (body.eventId !== undefined && body.eventId !== null) {
        if (typeof body.eventId !== 'string' || !UUID_RE.test(body.eventId)) {
          return c.json({ error: 'eventId must be a UUID' }, 400);
        }
        eventId = body.eventId.toLowerCase();
      }
    }
    if (!TICKET_CODE_RE.test(code)) return c.json({ result: 'not_found' });
    return c.json(await events.checkIn(code, at, eventId));
  });

  // Gives the seat back, once. A ticket that was used at the door cannot be voided.
  app.post(`${PREFIX}/admin/tickets/:code/void`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const code = c.req.param('code');
    if (!TICKET_CODE_RE.test(code)) return c.json({ error: 'Ticket not found' }, 404);
    const r = await events.voidTicket(code);
    if (!r.ok) {
      if (r.reason === 'not_found') return c.json({ error: 'Ticket not found' }, 404);
      return c.json({ error: 'A ticket that was used at the door cannot be voided', ticket: r.ticket }, 409);
    }
    return c.json({ ticket: r.ticket, changed: r.changed });
  });
}
