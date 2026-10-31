// HTTP tests for the event and ticket routes (events_routes.ts), against the in-memory stores in dev.ts. The SQL
// functions they mirror are tested in supabase/tests/events.test.ts.
import { assert, assertEquals } from '@std/assert';
import { createApp } from './app.ts';
import { toPublicTicket } from './events_routes.ts';
import { createMemoryDeps } from './dev.ts';
import type { AdminEvent, AdminTicketType, Deps, PublicEvent, Ticket } from './types.ts';

const P = '/make-server-fbb8f0e1';
const JSON_H = { 'Content-Type': 'application/json' };
const ADMIN = { Authorization: 'Bearer admin', ...JSON_H };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const newId = () => crypto.randomUUID();

const isAdmin: Deps['isAdmin'] = (h) =>
  Promise.resolve(h === 'Bearer admin' ? 'ok' : h === 'Bearer user' ? 'forbidden' : 'unauthenticated');

async function setup(now: () => number = Date.now) {
  const deps = await createMemoryDeps(isAdmin, false, null, now);
  return createApp(deps);
}
type App = Awaited<ReturnType<typeof setup>>;

const send = (app: App, method: string, path: string, body?: unknown, headers: Record<string, string> = ADMIN) =>
  app.request(`${P}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function mkEvent(app: App, o: Record<string, unknown> = {}): Promise<AdminEvent> {
  const r = await send(app, 'PUT', `/admin/events/${newId()}`, {
    title: 'Block Party',
    startsAt: at(DAY),
    status: 'published',
    venue: 'The Yard',
    city: 'Joburg',
    ...o,
  });
  assertEquals(r.status, 201);
  return await r.json();
}

async function mkType(app: App, eventId: string, o: Record<string, unknown> = {}): Promise<AdminTicketType> {
  const r = await send(app, 'PUT', `/admin/ticket-types/${newId()}`, { eventId, name: 'Free RSVP', price: 0, capacity: 10, ...o });
  assertEquals(r.status, 201);
  return await r.json();
}

async function freeEvent(app: App, capacity = 10, eventExtra: Record<string, unknown> = {}) {
  const event = await mkEvent(app, eventExtra);
  const type = await mkType(app, event.id, { capacity });
  return { event, type };
}

const HOLDER = { name: 'Thandi Nkosi', phone: '+27 82 123 4567', email: 'thandi@example.com' };

const rsvp = (
  app: App,
  slug: string,
  ticketTypeId: string,
  quantity = 1,
  id: string = newId(),
  headers: Record<string, string> = JSON_H,
) => send(app, 'POST', `/events/${slug}/rsvp`, { id, ticketTypeId, quantity, holder: HOLDER }, headers);

const issue = (app: App, ticketTypeId: string, quantity = 1, id: string = newId()) =>
  send(app, 'POST', '/admin/tickets', { id, ticketTypeId, quantity, holder: { name: 'Walk In', phone: '0711111111' } });

const codesOf = async (r: Response): Promise<string[]> => ((await r.json()).tickets as { code: string }[]).map((t) => t.code);
const publicEvent = async (app: App, slug: string): Promise<PublicEvent> => await (await app.request(`${P}/events/${slug}`)).json();
const availableOf = async (app: App, slug: string, typeId: string) =>
  (await publicEvent(app, slug)).ticketTypes.find((t) => t.id === typeId)!.available;
const checkIn = (app: App, code: string, body?: unknown) => send(app, 'POST', `/admin/tickets/${code}/check-in`, body);
const voidIt = (app: App, code: string) => send(app, 'POST', `/admin/tickets/${code}/void`);

// --- Public events ----------------------------------------------------------------------------------------

Deno.test('events: published only, soonest first, with ticket types showing id, name, price, available and onSale', async () => {
  const app = await setup();
  const later = await mkEvent(app, { title: 'Later', startsAt: at(5 * DAY) });
  const soon = await mkEvent(app, { title: 'Soon', startsAt: at(DAY) });
  await mkEvent(app, { title: 'Draft', status: 'draft' });
  await mkEvent(app, { title: 'Cancelled', status: 'cancelled' });
  await mkType(app, soon.id, { name: 'VIP', price: 250.5, capacity: 3 });
  await mkType(app, soon.id, { name: 'Hidden', active: false });
  await mkType(app, soon.id, { name: 'Soon', saleStartsAt: at(HOUR), sort: 5 });

  const r = await app.request(`${P}/events`);
  assertEquals(r.status, 200);
  const list = (await r.json()) as PublicEvent[];
  assertEquals(list.map((e) => e.title), ['Soon', 'Later']);
  assertEquals(list[1].id, later.id);
  const types = list[0].ticketTypes;
  assertEquals(types.map((t) => t.name), ['VIP', 'Soon']);
  assertEquals(types[0], { id: types[0].id, name: 'VIP', price: 250.5, available: 3, onSale: true });
  assertEquals(types[1].onSale, false);
  assert(!('capacity' in types[0]) && !('sold' in types[0]));
  assert(!('status' in list[0]) && !('createdAt' in list[0]));
});

Deno.test('events: ?past=1 lists published events that have ended, newest first', async () => {
  const app = await setup();
  await mkEvent(app, { title: 'Old', startsAt: at(-10 * DAY), endsAt: at(-10 * DAY + 2 * HOUR) });
  await mkEvent(app, { title: 'Recent', startsAt: at(-2 * DAY), endsAt: at(-2 * DAY + 2 * HOUR) });
  await mkEvent(app, { title: 'Past draft', status: 'draft', startsAt: at(-3 * DAY), endsAt: at(-3 * DAY + HOUR) });
  await mkEvent(app, { title: 'Upcoming' });
  const past = (await (await app.request(`${P}/events?past=1`)).json()) as PublicEvent[];
  assertEquals(past.map((e) => e.title), ['Recent', 'Old']);
  const up = (await (await app.request(`${P}/events`)).json()) as PublicEvent[];
  assertEquals(up.map((e) => e.title), ['Upcoming']);
});

Deno.test('events/:slug: a published event is 200, a draft, a cancelled and an unknown one are 404', async () => {
  const app = await setup();
  const ok = await mkEvent(app, { title: 'Open Mic' });
  const draft = await mkEvent(app, { title: 'Secret', status: 'draft' });
  const gone = await mkEvent(app, { title: 'Called Off', status: 'cancelled' });
  const r = await app.request(`${P}/events/${ok.slug}`);
  assertEquals(r.status, 200);
  assertEquals((await r.json()).title, 'Open Mic');
  for (const slug of [draft.slug, gone.slug, 'nope']) {
    const n = await app.request(`${P}/events/${slug}`);
    assertEquals(n.status, 404, slug);
    assert((await n.json()).error);
  }
});

// --- RSVP -------------------------------------------------------------------------------------------------

Deno.test('rsvp: a free ticket is created and only the code comes back', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app, 10);
  const r = await rsvp(app, event.slug, type.id, 2);
  assertEquals(r.status, 201);
  const body = await r.json();
  assertEquals(Object.keys(body), ['tickets']);
  assertEquals(body.tickets.length, 2);
  for (const t of body.tickets) {
    assertEquals(Object.keys(t), ['code']);
    assert(/^[0-9a-f]{32}$/.test(t.code));
  }
  assertEquals(await availableOf(app, event.slug, type.id), 8);
});

Deno.test('rsvp: a retried id returns the same tickets and takes no capacity twice', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app, 10);
  const id = newId();
  const a = await rsvp(app, event.slug, type.id, 3, id);
  const b = await rsvp(app, event.slug, type.id, 3, id);
  assertEquals(a.status, 201);
  assertEquals(b.status, 200);
  assertEquals(await codesOf(b), await codesOf(a.clone()));
  assertEquals(await availableOf(app, event.slug, type.id), 7);
  // Doubled at once: still one group.
  const id2 = newId();
  const both = await Promise.all([rsvp(app, event.slug, type.id, 2, id2), rsvp(app, event.slug, type.id, 2, id2)]);
  assertEquals(both.map((r) => r.status).sort(), [200, 201]);
  assertEquals(await availableOf(app, event.slug, type.id), 5);
});

Deno.test('rsvp: 409 with the count left when short, and nothing is taken', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app, 3);
  assertEquals((await rsvp(app, event.slug, type.id, 2)).status, 201);
  const r = await rsvp(app, event.slug, type.id, 2);
  assertEquals(r.status, 409);
  const body = await r.json();
  assertEquals(body.available, 1);
  assertEquals(body.code, 'sold_out');
  assertEquals(await availableOf(app, event.slug, type.id), 1);
  assertEquals((await rsvp(app, event.slug, type.id, 1)).status, 201);
  const none = await rsvp(app, event.slug, type.id, 1);
  assertEquals(none.status, 409);
  assertEquals((await none.json()).available, 0);
});

Deno.test('rsvp: two buyers of the last seats at once never oversell', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app, 4);
  const rs = await Promise.all(Array.from({ length: 6 }, () => rsvp(app, event.slug, type.id, 1)));
  assertEquals(rs.filter((r) => r.status === 201).length, 4);
  assertEquals(rs.filter((r) => r.status === 409).length, 2);
  assertEquals(await availableOf(app, event.slug, type.id), 0);
});

Deno.test('rsvp: a paid ticket type is refused with 400', async () => {
  const app = await setup();
  const { event } = await freeEvent(app);
  const paid = await mkType(app, event.id, { name: 'VIP', price: 120, capacity: 5 });
  const r = await rsvp(app, event.slug, paid.id, 1);
  assertEquals(r.status, 400);
  assertEquals((await r.json()).code, 'paid_type');
  assertEquals(await availableOf(app, event.slug, paid.id), 5);
});

Deno.test('rsvp: a type that is not on sale, an ended event and a hidden event are refused', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app);
  const later = await mkType(app, event.id, { name: 'Later', saleStartsAt: at(HOUR) });
  const closed = await mkType(app, event.id, { name: 'Closed', saleEndsAt: at(-HOUR) });
  const off = await mkType(app, event.id, { name: 'Off', active: false });
  for (const t of [later, closed, off]) {
    const r = await rsvp(app, event.slug, t.id, 1);
    assertEquals(r.status, 409, t.name);
    assertEquals((await r.json()).code, 'not_on_sale');
  }

  const ended = await freeEvent(app, 5, { startsAt: at(-3 * DAY), endsAt: at(-2 * DAY) });
  const e = await rsvp(app, ended.event.slug, ended.type.id, 1);
  assertEquals(e.status, 409);
  assertEquals((await e.json()).code, 'event_ended');

  const draft = await freeEvent(app, 5, { status: 'draft' });
  assertEquals((await rsvp(app, draft.event.slug, draft.type.id, 1)).status, 404);
  const gone = await freeEvent(app, 5, { status: 'cancelled' });
  assertEquals((await rsvp(app, gone.event.slug, gone.type.id, 1)).status, 404);
  assertEquals((await rsvp(app, 'nope', type.id, 1)).status, 404);
  // A type of another event under this slug.
  assertEquals((await rsvp(app, event.slug, ended.type.id, 1)).status, 404);
});

Deno.test('rsvp: bad bodies are 400', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app);
  const url = `/events/${event.slug}/rsvp`;
  const ok = { id: newId(), ticketTypeId: type.id, quantity: 1, holder: HOLDER };
  for (
    const bad of [
      { ...ok, id: 'x' },
      { ...ok, ticketTypeId: 'x' },
      { ...ok, quantity: 0 },
      { ...ok, quantity: 5 },
      { ...ok, quantity: 1.5 },
      { ...ok, quantity: '1' },
      { ...ok, holder: { name: '', phone: '0821234567' } },
      { ...ok, holder: { name: 'A', phone: '12' } },
      { ...ok, holder: { name: 'A', phone: '0821234567', email: 'nope' } },
      { ...ok, holder: 'x' },
      [],
    ]
  ) {
    assertEquals((await send(app, 'POST', url, bad, JSON_H)).status, 400, JSON.stringify(bad));
  }
  const malformed = await app.request(`${P}${url}`, { method: 'POST', headers: JSON_H, body: '{nope' });
  assertEquals(malformed.status, 400);
  assertEquals(await availableOf(app, event.slug, type.id), 10);
  // The email is optional.
  const noEmail = await send(app, 'POST', url, { ...ok, holder: { name: 'A B', phone: '0821234567' } }, JSON_H);
  assertEquals(noEmail.status, 201);
});

Deno.test('rsvp: 5 per client IP in a rolling hour, then 429 with nothing kept; no ip, no limit', async () => {
  let t = Date.now();
  const app = await setup(() => t);
  const { event, type } = await freeEvent(app, 100);
  const ip = { ...JSON_H, 'cf-connecting-ip': '203.0.113.7' };
  for (let i = 0; i < 5; i++) assertEquals((await rsvp(app, event.slug, type.id, 2, newId(), ip)).status, 201);
  const retryId = newId();
  const sixth = await rsvp(app, event.slug, type.id, 2, retryId, ip);
  assertEquals(sixth.status, 429);
  assertEquals(sixth.headers.get('Retry-After'), '3600');
  assertEquals((await sixth.json()).code, 'rate_limited');
  assertEquals(await availableOf(app, event.slug, type.id), 90);
  // Another address and a request with no address are not limited. x-forwarded-for is never trusted.
  assertEquals((await rsvp(app, event.slug, type.id, 1, newId(), { ...JSON_H, 'cf-connecting-ip': '198.51.100.9' })).status, 201);
  for (let i = 0; i < 7; i++) assertEquals((await rsvp(app, event.slug, type.id, 1)).status, 201);
  assertEquals((await rsvp(app, event.slug, type.id, 1, newId(), { ...JSON_H, 'x-forwarded-for': '203.0.113.7' })).status, 201);
  // An hour later the same address may RSVP again, and the 429'd id works then.
  t += HOUR + 1000;
  assertEquals((await rsvp(app, event.slug, type.id, 2, retryId, ip)).status, 201);
});

Deno.test('rsvp: a replay at the limit still answers, and refused requests do not use up the limit', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app, 100);
  const paid = await mkType(app, event.id, { name: 'VIP', price: 50 });
  const ip = { ...JSON_H, 'cf-connecting-ip': '203.0.113.8' };
  for (let i = 0; i < 8; i++) assertEquals((await rsvp(app, event.slug, paid.id, 1, newId(), ip)).status, 400);
  const first = newId();
  assertEquals((await rsvp(app, event.slug, type.id, 1, first, ip)).status, 201);
  for (let i = 0; i < 4; i++) assertEquals((await rsvp(app, event.slug, type.id, 1, newId(), ip)).status, 201);
  assertEquals((await rsvp(app, event.slug, type.id, 1, newId(), ip)).status, 429);
  assertEquals((await rsvp(app, event.slug, type.id, 1, first, ip)).status, 200);
});

// --- Public ticket ----------------------------------------------------------------------------------------

Deno.test('tickets/:code: only the allow-listed fields, first name only, no-store', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app, 10);
  const [code] = await codesOf(await rsvp(app, event.slug, type.id, 1));
  const r = await app.request(`${P}/tickets/${code}`);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get('Cache-Control'), 'no-store');
  const body = await r.json();
  assertEquals(Object.keys(body).sort(), [
    'checkedInAt', 'city', 'eventSlug', 'eventTitle', 'holderFirstName', 'startsAt', 'status', 'ticketTypeName', 'venue',
  ]);
  assertEquals(body.holderFirstName, 'Thandi');
  assertEquals(body.status, 'valid');
  assertEquals(body.checkedInAt, null);
  assertEquals(body.eventTitle, 'Block Party');
  assertEquals(body.eventSlug, event.slug);
  assertEquals(body.ticketTypeName, 'Free RSVP');
  assertEquals(body.venue, 'The Yard');
  // None of the private values appear anywhere in the response.
  const text = JSON.stringify(body);
  for (const secret of ['Nkosi', '0821234567', '082 123', 'thandi@example.com', 'holderPhone', 'holderEmail', 'holderName', code]) {
    assert(!text.includes(secret), secret);
  }
  // The code is case-insensitive; unknown and malformed codes are the same no-store 404.
  assertEquals((await app.request(`${P}/tickets/${code.toUpperCase()}`)).status, 200);
  for (const bad of ['f'.repeat(32), 'short', 'x'.repeat(100), '..%2F..']) {
    const n = await app.request(`${P}/tickets/${bad}`);
    assertEquals(n.status, 404, bad);
    assertEquals(n.headers.get('Cache-Control'), 'no-store');
  }
});

Deno.test('toPublicTicket: each private field is absent, and a field added to Ticket later stays private', () => {
  const full: Ticket & { extra: string } = {
    id: 'i', code: 'c'.repeat(32), groupId: 'g', eventId: 'e', eventTitle: 'T', eventSlug: 's', startsAt: 'x', venue: 'v',
    city: 'c', ticketTypeId: 't', ticketTypeName: 'n', holderName: 'Thandi van der Nkosi', holderPhone: '0821234567',
    holderEmail: 'a@b.co', source: 'issued', checkedInAt: null, voidedAt: null, createdAt: 'z', extra: 'secret',
  };
  const out = toPublicTicket(full) as unknown as Record<string, unknown>;
  for (const k of ['holderName', 'holderPhone', 'holderEmail', 'id', 'code', 'groupId', 'eventId', 'ticketTypeId', 'source', 'voidedAt', 'createdAt', 'extra']) {
    assert(!(k in out), k);
  }
  assertEquals(out.holderFirstName, 'Thandi');
  assertEquals(toPublicTicket({ ...full, holderName: '  Zodwa  ' }).holderFirstName, 'Zodwa');
  assertEquals(toPublicTicket({ ...full, checkedInAt: 't' }).status, 'used');
  assertEquals(toPublicTicket({ ...full, voidedAt: 't' }).status, 'void');
  assertEquals(toPublicTicket({ ...full, voidedAt: 't', checkedInAt: 't' }).status, 'void');
});

Deno.test('tickets/:code: used and void tickets say so', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app, 10);
  const [a, b] = await codesOf(await rsvp(app, event.slug, type.id, 2));
  const ci = await (await checkIn(app, a)).json();
  const used = await (await app.request(`${P}/tickets/${a}`)).json();
  assertEquals(used.status, 'used');
  assertEquals(new Date(used.checkedInAt).getTime(), new Date(ci.checkedInAt).getTime());
  await voidIt(app, b);
  assertEquals((await (await app.request(`${P}/tickets/${b}`)).json()).status, 'void');
});

// --- Admin: auth ------------------------------------------------------------------------------------------

Deno.test('admin routes: every one is 401 without a token and 403 for a non-admin, before anything is read', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app);
  const [code] = await codesOf(await issue(app, type.id));
  const id = newId();
  const routes: [string, string, unknown?][] = [
    ['GET', '/admin/events'],
    ['PUT', `/admin/events/${event.id}`, { title: 'X' }],
    ['DELETE', `/admin/events/${event.id}`],
    ['PUT', `/admin/ticket-types/${type.id}`, { name: 'X' }],
    ['DELETE', `/admin/ticket-types/${type.id}`],
    ['POST', '/admin/tickets', { id, ticketTypeId: type.id, quantity: 1, holder: HOLDER }],
    ['GET', `/admin/events/${event.id}/tickets`],
    ['POST', `/admin/tickets/${code}/check-in`],
    ['POST', `/admin/tickets/${code}/void`],
  ];
  for (const [method, path, body] of routes) {
    for (const [headers, status] of [[JSON_H, 401], [{ Authorization: 'Bearer user', ...JSON_H }, 403]] as const) {
      const r = await send(app, method, path, body, headers);
      assertEquals(r.status, status, `${method} ${path}`);
    }
    // A malformed body is still 401, not 400.
    if (method !== 'GET') {
      const m = await app.request(`${P}${path}`, { method, headers: JSON_H, body: '{nope' });
      assertEquals(m.status, 401, `${method} ${path} (bad body)`);
    }
  }
  // None of that changed anything.
  assertEquals((await app.request(`${P}/events/${event.slug}`)).status, 200);
  assertEquals((await (await send(app, 'GET', `/admin/events/${event.id}/tickets`)).json()).length, 1);
  assertEquals(await availableOf(app, event.slug, type.id), 9);
});

// --- Admin: events and ticket types -----------------------------------------------------------------------

Deno.test('admin events: all statuses with sold and capacity; create, update and delete', async () => {
  const app = await setup();
  const draft = await mkEvent(app, { title: 'Draft One', status: 'draft' });
  assertEquals(draft.slug, 'draft-one');
  assertEquals(draft.status, 'draft');
  const type = await mkType(app, draft.id, { capacity: 7 });
  await mkEvent(app, { title: 'Cancelled', status: 'cancelled' });
  const list = (await (await send(app, 'GET', '/admin/events')).json()) as AdminEvent[];
  assertEquals(list.length, 2);
  assertEquals(list.map((e) => e.status).sort(), ['cancelled', 'draft']);
  const row = list.find((e) => e.id === draft.id)!;
  assertEquals(row.ticketTypes[0].capacity, 7);
  assertEquals(row.ticketTypes[0].sold, 0);

  const upd = await send(app, 'PUT', `/admin/events/${draft.id}`, { status: 'published', title: 'Draft Two' });
  assertEquals(upd.status, 200);
  const updated = (await upd.json()) as AdminEvent;
  assertEquals(updated.slug, 'draft-one');
  assertEquals(updated.title, 'Draft Two');
  assertEquals((await app.request(`${P}/events/draft-one`)).status, 200);
  const cleared = await send(app, 'PUT', `/admin/events/${draft.id}`, { endsAt: null });
  assertEquals((await cleared.json()).endsAt, null);

  assertEquals((await send(app, 'DELETE', `/admin/ticket-types/${type.id}`)).status, 204);
  assertEquals((await send(app, 'DELETE', `/admin/events/${draft.id}`)).status, 204);
  assertEquals((await send(app, 'DELETE', `/admin/events/${draft.id}`)).status, 404);
  assertEquals((await send(app, 'GET', `/admin/events/${draft.id}/tickets`)).status, 404);
});

Deno.test('admin events: validation, a new event needs title and start, bad dates and taken slugs', async () => {
  const app = await setup();
  const a = await mkEvent(app, { title: 'Alpha' });
  const put = (id: string, body: unknown) => send(app, 'PUT', `/admin/events/${id}`, body);
  assertEquals((await put('not-a-uuid', { title: 'X' })).status, 400);
  assertEquals((await put(newId(), { title: 'No start' })).status, 400);
  assertEquals((await put(newId(), { startsAt: at(DAY) })).status, 400);
  assertEquals((await put(newId(), { title: 'X', startsAt: 'tomorrow' })).status, 400);
  assertEquals((await put(newId(), { title: 'X', startsAt: at(DAY), endsAt: at(-DAY) })).status, 400);
  assertEquals((await put(newId(), { title: 'X', startsAt: at(DAY), status: 'live' })).status, 400);
  assertEquals((await put(newId(), { title: 'X', startsAt: at(DAY), image: 'data:image/png;base64,AAAA' })).status, 400);
  assertEquals((await put(newId(), { title: 'X', startsAt: at(DAY), slug: 'Bad Slug' })).status, 400);
  assertEquals((await put(a.id, { endsAt: at(-5 * DAY) })).status, 400);
  const taken = await put(newId(), { title: 'Beta', startsAt: at(DAY), slug: 'alpha' });
  assertEquals(taken.status, 409);
  const same = await mkEvent(app, { title: 'Alpha' });
  assertEquals(same.slug, 'alpha-2');
  const malformed = await app.request(`${P}/admin/events/${newId()}`, { method: 'PUT', headers: ADMIN, body: '{nope' });
  assertEquals(malformed.status, 400);
  // The image may be a real URL or empty.
  assertEquals((await put(a.id, { image: 'https://example.com/a.jpg' })).status, 200);
  assertEquals((await put(a.id, { image: '' })).status, 200);
});

Deno.test('admin ticket types: capacity cannot go below sold; delete is 409 once tickets exist, even void ones', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app, 5);
  const [code] = await codesOf(await rsvp(app, event.slug, type.id, 3));
  const put = (body: unknown) => send(app, 'PUT', `/admin/ticket-types/${type.id}`, body);
  const low = await put({ capacity: 2 });
  assertEquals(low.status, 409);
  assertEquals((await low.json()).sold, 3);
  const ok = await put({ capacity: 3 });
  assertEquals(ok.status, 200);
  const view = (await ok.json()) as AdminTicketType;
  assertEquals([view.capacity, view.sold, view.available], [3, 3, 0]);
  assertEquals((await put({ price: -1 })).status, 400);
  assertEquals((await put({ price: 1.234 })).status, 400);
  assertEquals((await put({ capacity: 1.5 })).status, 400);
  assertEquals((await put({ active: 'yes' })).status, 400);
  assertEquals((await put({ saleStartsAt: at(2 * HOUR), saleEndsAt: at(HOUR) })).status, 400);

  assertEquals((await send(app, 'DELETE', `/admin/ticket-types/${type.id}`)).status, 409);
  assertEquals((await send(app, 'DELETE', `/admin/events/${event.id}`)).status, 409);
  await voidIt(app, code);
  assertEquals((await send(app, 'DELETE', `/admin/ticket-types/${type.id}`)).status, 409);
  assertEquals((await send(app, 'DELETE', `/admin/ticket-types/${newId()}`)).status, 404);
  assertEquals((await send(app, 'PUT', `/admin/ticket-types/${newId()}`, { name: 'No event' })).status, 400);
  assertEquals((await send(app, 'PUT', `/admin/ticket-types/${newId()}`, { eventId: event.id })).status, 400);
});

// --- Admin: issuing, check-in, void -----------------------------------------------------------------------

Deno.test('admin tickets: issue paid and free tickets, 1 to 20, idempotent, full details in the list', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app, 30);
  const paid = await mkType(app, event.id, { name: 'VIP', price: 300, capacity: 25 });
  const id = newId();
  const a = await issue(app, paid.id, 2, id);
  assertEquals(a.status, 201);
  const issued = (await a.json()).tickets as Ticket[];
  assertEquals(issued.length, 2);
  for (const t of issued) {
    assertEquals(t.source, 'issued');
    assertEquals(t.holderName, 'Walk In');
    assertEquals(t.holderPhone, '0711111111');
  }
  const b = await issue(app, paid.id, 2, id);
  assertEquals(b.status, 200);
  assertEquals((await b.json()).tickets.map((t: Ticket) => t.code), issued.map((t) => t.code));
  assertEquals((await issue(app, paid.id, 20)).status, 201);
  assertEquals((await issue(app, paid.id, 21)).status, 400);
  assertEquals((await issue(app, paid.id, 0)).status, 400);
  assertEquals((await issue(app, newId(), 1)).status, 404);
  const short = await issue(app, paid.id, 5);
  assertEquals(short.status, 409);
  assertEquals((await short.json()).available, 3);
  // The RSVP pool is the same pool.
  assertEquals((await rsvp(app, event.slug, type.id, 4)).status, 201);

  const list = (await (await send(app, 'GET', `/admin/events/${event.id}/tickets`)).json()) as Ticket[];
  assertEquals(list.length, 2 + 20 + 4);
  assertEquals(list.filter((t) => t.source === 'rsvp').length, 4);
  for (const t of list) assert(t.holderName && t.holderPhone && t.code && t.ticketTypeName);
  assertEquals(list.find((t) => t.source === 'rsvp')!.holderEmail, 'thandi@example.com');

  // A cancelled event takes no new tickets.
  await send(app, 'PUT', `/admin/events/${event.id}`, { status: 'cancelled' });
  assertEquals((await issue(app, paid.id, 1)).status, 409);
});

Deno.test('check-in: the first call wins and the second is already with the first time, not an error status', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app);
  const [code] = await codesOf(await rsvp(app, event.slug, type.id, 1));
  const a = await checkIn(app, code);
  assertEquals(a.status, 200);
  const first = await a.json();
  assertEquals(first.result, 'ok');
  assert(first.checkedInAt);
  assertEquals(first.ticket.code, code);
  assertEquals(first.ticket.holderName, 'Thandi Nkosi');
  const b = await checkIn(app, code.toUpperCase());
  assertEquals(b.status, 200);
  const second = await b.json();
  assertEquals(second.result, 'already');
  assertEquals(second.checkedInAt, first.checkedInAt);
  // Both at once: exactly one ok.
  const [c2] = await codesOf(await rsvp(app, event.slug, type.id, 1));
  const both = await Promise.all([checkIn(app, c2), checkIn(app, c2), checkIn(app, c2)]);
  const results = await Promise.all(both.map(async (r) => (await r.json()).result));
  assertEquals(results.filter((r) => r === 'ok').length, 1);
  assertEquals(results.filter((r) => r === 'already').length, 2);
});

Deno.test('check-in: not_found, void, a bad code, the offline scan time and a ticket of another event', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app, 10);
  const other = await freeEvent(app, 10);
  const [voidCode, a, b, c, d] = [
    ...(await codesOf(await rsvp(app, event.slug, type.id, 4))),
    ...(await codesOf(await rsvp(app, event.slug, type.id, 1))),
  ];
  assertEquals(await (await checkIn(app, 'f'.repeat(32))).json(), { result: 'not_found' });
  assertEquals(await (await checkIn(app, 'bad')).json(), { result: 'not_found' });
  await voidIt(app, voidCode);
  const v = await (await checkIn(app, voidCode)).json();
  assertEquals(v.result, 'void');

  const twoHours = new Date(Date.now() - 2 * HOUR).toISOString();
  const kept = await (await checkIn(app, a, { at: twoHours })).json();
  assertEquals(kept.result, 'ok');
  assertEquals(kept.checkedInAt, twoHours);
  for (const [code, when] of [[b, at(HOUR)], [c, at(-25 * HOUR)]] as const) {
    const r = await (await checkIn(app, code, { at: when })).json();
    assertEquals(r.result, 'ok');
    assert(Math.abs(new Date(r.checkedInAt).getTime() - Date.now()) < 60_000, `${when} was not replaced by now`);
  }
  assertEquals((await checkIn(app, d, { at: 'yesterday' })).status, 400);
  assertEquals((await checkIn(app, d, { eventId: 'x' })).status, 400);
  // A body that is not JSON is treated as no body.
  const plain = await app.request(`${P}/admin/tickets/${d}/check-in`, { method: 'POST', headers: ADMIN, body: 'ok' });
  assertEquals((await plain.json()).result, 'ok');

  const [e] = await codesOf(await rsvp(app, event.slug, type.id, 1));
  const wrong = await (await checkIn(app, e, { eventId: other.event.id })).json();
  assertEquals(wrong.result, 'wrong_event');
  assertEquals(wrong.checkedInAt, null);
  assertEquals((await (await checkIn(app, e, { eventId: event.id })).json()).result, 'ok');
});

Deno.test('void: gives the seat back once, a second void changes nothing, a used ticket is 409', async () => {
  const app = await setup();
  const { event, type } = await freeEvent(app, 3);
  const [a, b, c] = await codesOf(await rsvp(app, event.slug, type.id, 3));
  assertEquals(await availableOf(app, event.slug, type.id), 0);
  const v = await voidIt(app, a);
  assertEquals(v.status, 200);
  const body = await v.json();
  assertEquals(body.changed, true);
  assert(body.ticket.voidedAt);
  assertEquals(await availableOf(app, event.slug, type.id), 1);
  const again = await voidIt(app, a);
  assertEquals(again.status, 200);
  assertEquals((await again.json()).changed, false);
  assertEquals(await availableOf(app, event.slug, type.id), 1);

  assertEquals((await checkIn(app, b)).status, 200);
  const used = await voidIt(app, b);
  assertEquals(used.status, 409);
  assertEquals(await availableOf(app, event.slug, type.id), 1);
  assertEquals((await (await app.request(`${P}/tickets/${b}`)).json()).status, 'used');

  assertEquals((await voidIt(app, 'f'.repeat(32))).status, 404);
  assertEquals((await voidIt(app, 'bad')).status, 404);
  assertEquals((await voidIt(app, c.toUpperCase())).status, 200);
  assertEquals(await availableOf(app, event.slug, type.id), 2);
});
