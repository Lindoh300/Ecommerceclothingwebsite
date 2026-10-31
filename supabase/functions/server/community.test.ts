// HTTP tests for the community routes (community_routes.ts), against the in-memory stores in dev.ts. The SQL
// functions they mirror are tested in supabase/tests/community.test.ts.
import { assert, assertEquals } from '@std/assert';
import { createApp } from './app.ts';
import { CONSENT_TEXT, CONSENT_VERSION, STORED_CONSENT_TEXT } from './community_routes.ts';
import { CONSENT_TEXT as CLIENT_CONSENT_TEXT } from '../../../src/app/api/communityConsent.ts';
import { createMemoryDeps } from './dev.ts';
import type { AdminGalleryItem, CommunityStore, Deps, PublicGalleryItem, Subscriber } from './types.ts';

const P = '/make-server-fbb8f0e1';
const JSON_H = { 'Content-Type': 'application/json' };
const ADMIN = { Authorization: 'Bearer admin', ...JSON_H };
const HOUR = 3_600_000;
const newId = () => crypto.randomUUID();

const isAdmin: Deps['isAdmin'] = (h) =>
  Promise.resolve(h === 'Bearer admin' ? 'ok' : h === 'Bearer user' ? 'forbidden' : 'unauthenticated');

async function setup(now: () => number = Date.now) {
  const deps = await createMemoryDeps(isAdmin, false, null, now);
  return { app: createApp(deps), deps };
}
type App = Awaited<ReturnType<typeof setup>>['app'];

const send = (app: App, method: string, path: string, body?: unknown, headers: Record<string, string> = ADMIN) =>
  app.request(`${P}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const signUp = (app: App, body: unknown, headers: Record<string, string> = JSON_H) =>
  send(app, 'POST', '/subscribers', body, headers);

const GOOD = { phone: '082 123 4567', consent: true, source: 'community' };
const listSubs = async (app: App): Promise<Subscriber[]> => await (await send(app, 'GET', '/admin/subscribers')).json();

Deno.test('consent text: the sign-up form and the server use the same wording', () => {
  assertEquals(CLIENT_CONSENT_TEXT, CONSENT_TEXT);
  assert(STORED_CONSENT_TEXT.includes(CONSENT_VERSION) && STORED_CONSENT_TEXT.endsWith(CONSENT_TEXT));
});

Deno.test('subscribe: consent false, missing, or not exactly true is 400 and nothing is stored', async () => {
  const { app } = await setup();
  for (const consent of [false, undefined, 'true', 1, null, 'yes', [true]]) {
    const r = await signUp(app, { ...GOOD, consent });
    assertEquals(r.status, 400, String(consent));
  }
  assertEquals((await listSubs(app)).length, 0);
});

Deno.test('subscribe: no contact is 400, and so is a bad phone, a bad email or a bad body', async () => {
  const { app } = await setup();
  for (const body of [
    { consent: true, source: 'footer' },
    { consent: true, source: 'footer', phone: '', email: '  ' },
    { consent: true, source: 'footer', name: 'Thandi' },
    { consent: true, source: 'footer', phone: '12' },
    { consent: true, source: 'footer', phone: 'call me maybe' },
    { consent: true, source: 'footer', email: 'not-an-email' },
    { consent: true, source: 'footer', email: 42 },
    { consent: true, source: 'footer', phone: '0821234567', name: 'x'.repeat(101) },
    [],
    'x',
  ]) {
    assertEquals((await signUp(app, body)).status, 400, JSON.stringify(body));
  }
  assertEquals((await send(app, 'POST', '/subscribers', undefined)).status, 400);
  assertEquals((await listSubs(app)).length, 0);
});

Deno.test('subscribe: an invalid or missing source is 400; community, footer and event are fine', async () => {
  const { app } = await setup();
  for (const source of [undefined, 'admin', 'COMMUNITY', '', 5]) {
    assertEquals((await signUp(app, { ...GOOD, source })).status, 400, String(source));
  }
  for (const [i, source] of (['community', 'footer', 'event'] as const).entries()) {
    assertEquals((await signUp(app, { email: `p${i}@example.com`, consent: true, source })).status, 200);
  }
  assertEquals((await listSubs(app)).map((s) => s.source).sort(), ['community', 'event', 'footer']);
});

Deno.test('subscribe: a new and a repeat sign-up give the identical 200 {ok:true}', async () => {
  const { app } = await setup();
  const first = await signUp(app, GOOD);
  const second = await signUp(app, { ...GOOD, phone: '+27 82 123 4567' });
  const emailFirst = await signUp(app, { email: 'Thandi@Example.com', consent: true, source: 'footer' });
  const emailAgain = await signUp(app, { email: 'thandi@example.com', consent: true, source: 'footer' });
  for (const r of [first, second, emailFirst, emailAgain]) {
    assertEquals(r.status, 200);
    assertEquals(await r.text(), JSON.stringify({ ok: true }));
  }
  // The same phone in another spelling, and the same email in another case, are one person.
  assertEquals((await listSubs(app)).length, 2);
});

Deno.test('subscribe: the consent text comes from the server, whatever the request says', async () => {
  const { app } = await setup();
  const r = await signUp(app, { ...GOOD, consentText: 'I agree to anything', consent_text: 'x', text: 'y' });
  assertEquals(r.status, 200);
  const subs = await listSubs(app);
  assertEquals(subs.length, 1);
  assertEquals(JSON.stringify(subs).includes('agree to anything'), false);
});

Deno.test('subscribe: the memory store keeps the server constant as the consent text', async () => {
  const seen: string[] = [];
  const { app, deps } = await setup();
  const inner: CommunityStore = deps.community;
  const spy: Deps = {
    ...deps,
    community: { ...inner, subscribe: (input, text, ip) => (seen.push(text), inner.subscribe(input, text, ip)) },
  };
  const spied = createApp(spy);
  assertEquals((await signUp(spied, { ...GOOD, consentText: 'nope' })).status, 200);
  assertEquals(seen, [STORED_CONSENT_TEXT]);
});

Deno.test('subscribe: 5 per client IP in a rolling hour, then 429 with nothing kept; no ip, no limit', async () => {
  let t = Date.now();
  const { app } = await setup(() => t);
  const ip = { ...JSON_H, 'cf-connecting-ip': '203.0.113.7' };
  const phone = (n: number) => `082 000 ${String(1000 + n)}`;
  for (let i = 0; i < 5; i++) assertEquals((await signUp(app, { ...GOOD, phone: phone(i) }, ip)).status, 200);
  const sixth = await signUp(app, { ...GOOD, phone: phone(5) }, ip);
  assertEquals(sixth.status, 429);
  assertEquals(sixth.headers.get('Retry-After'), '3600');
  assertEquals((await listSubs(app)).length, 5);
  // Another address is not affected; no address is never limited.
  assertEquals((await signUp(app, { ...GOOD, phone: phone(6) }, { ...JSON_H, 'cf-connecting-ip': '198.51.100.9' })).status, 200);
  for (let i = 10; i < 18; i++) assertEquals((await signUp(app, { ...GOOD, phone: phone(i) })).status, 200);
  // An hour later the same address may sign up again.
  t += HOUR + 1000;
  assertEquals((await signUp(app, { ...GOOD, phone: phone(5) }, ip)).status, 200);
});

Deno.test('subscribe: an invalid request does not use up the limit', async () => {
  const { app } = await setup();
  const ip = { ...JSON_H, 'cf-connecting-ip': '203.0.113.8' };
  for (let i = 0; i < 8; i++) assertEquals((await signUp(app, { ...GOOD, consent: false }, ip)).status, 400);
  for (let i = 0; i < 5; i++) assertEquals((await signUp(app, { ...GOOD, phone: `082 111 ${2000 + i}` }, ip)).status, 200);
  assertEquals((await signUp(app, GOOD, ip)).status, 429);
});

Deno.test('subscribe: a person who opted out and signs up again is reactivated, with a newer consent time', async () => {
  let t = Date.now();
  const { app } = await setup(() => t);
  await signUp(app, { ...GOOD, name: 'Thandi' });
  const [before] = await listSubs(app);
  assertEquals(before.unsubscribedAt, null);
  t += 5000;
  const un = await send(app, 'POST', `/admin/subscribers/${before.id}/unsubscribe`);
  assertEquals(un.status, 200);
  const optedOut = await un.json();
  assert(optedOut.unsubscribedAt);
  // A second unsubscribe keeps the first time.
  t += 5000;
  assertEquals((await (await send(app, 'POST', `/admin/subscribers/${before.id}/unsubscribe`)).json()).unsubscribedAt, optedOut.unsubscribedAt);
  t += 5000;
  assertEquals((await signUp(app, { ...GOOD, name: '' })).status, 200);
  const subs = await listSubs(app);
  assertEquals(subs.length, 1);
  assertEquals(subs[0].id, before.id);
  assertEquals(subs[0].unsubscribedAt, null);
  assertEquals(subs[0].name, 'Thandi');
  assert(subs[0].consentAt > before.consentAt);
  assertEquals(subs[0].createdAt, before.createdAt);
  assertEquals((await send(app, 'POST', `/admin/subscribers/${newId()}/unsubscribe`)).status, 404);
  assertEquals((await send(app, 'POST', '/admin/subscribers/nope/unsubscribe')).status, 404);
});

Deno.test('subscribe: the admin list has no consent wording and lists newest first', async () => {
  const { app } = await setup();
  await signUp(app, { ...GOOD, name: 'First' });
  await signUp(app, { email: 'second@example.com', consent: true, source: 'footer', name: 'Second' });
  const subs = await listSubs(app);
  assertEquals(subs.map((s) => s.name), ['Second', 'First']);
  assertEquals(Object.keys(subs[0]).sort(), ['consentAt', 'createdAt', 'email', 'id', 'name', 'phone', 'source', 'unsubscribedAt']);
});

Deno.test('gallery: public lists active items only, by sort then newest, with four fields', async () => {
  const { app } = await setup();
  const put = async (body: unknown) => {
    const r = await send(app, 'PUT', `/admin/gallery/${newId()}`, body);
    assertEquals(r.status, 201);
    return (await r.json()) as AdminGalleryItem;
  };
  const a = await put({ image: 'https://example.com/a.jpg', caption: 'A', sort: 2 });
  const b = await put({ image: 'https://example.com/b.jpg', caption: 'B', sort: 1 });
  const c = await put({ image: 'https://example.com/c.jpg', caption: 'C', sort: 2 });
  const hidden = await put({ image: 'https://example.com/h.jpg', caption: 'H', sort: 0, active: false });
  const pub = (await (await app.request(`${P}/gallery`)).json()) as PublicGalleryItem[];
  assertEquals(pub.map((g) => g.id), [b.id, c.id, a.id]);
  assertEquals(Object.keys(pub[0]).sort(), ['caption', 'eventId', 'id', 'image']);
  assertEquals(pub.some((g) => g.id === hidden.id), false);
  const admin = (await (await send(app, 'GET', '/admin/gallery')).json()) as AdminGalleryItem[];
  assertEquals(admin.map((g) => g.id), [hidden.id, b.id, c.id, a.id]);
  // Hiding hides, showing shows, delete removes.
  assertEquals((await send(app, 'PUT', `/admin/gallery/${b.id}`, { active: false })).status, 200);
  assertEquals(((await (await app.request(`${P}/gallery`)).json()) as PublicGalleryItem[]).length, 2);
  assertEquals((await send(app, 'DELETE', `/admin/gallery/${a.id}`)).status, 204);
  assertEquals((await send(app, 'DELETE', `/admin/gallery/${a.id}`)).status, 404);
  assertEquals(((await (await app.request(`${P}/gallery`)).json()) as PublicGalleryItem[]).map((g) => g.id), [c.id]);
});

Deno.test('admin gallery: validation, a new item needs an image, an event link must exist', async () => {
  const { app } = await setup();
  const id = newId();
  assertEquals((await send(app, 'PUT', `/admin/gallery/${id}`, { caption: 'No image' })).status, 400);
  assertEquals((await send(app, 'PUT', `/admin/gallery/${id}`, { image: 'javascript:alert(1)' })).status, 400);
  assertEquals((await send(app, 'PUT', `/admin/gallery/${id}`, { image: 'https://example.com/a.jpg', sort: 1.5 })).status, 400);
  assertEquals((await send(app, 'PUT', `/admin/gallery/${id}`, { image: 'https://example.com/a.jpg', eventId: 'x' })).status, 400);
  assertEquals((await send(app, 'PUT', `/admin/gallery/${id}`, { image: 'https://example.com/a.jpg', eventId: newId() })).status, 400);
  assertEquals((await send(app, 'PUT', '/admin/gallery/not-a-uuid', { image: 'https://example.com/a.jpg' })).status, 400);
  const ev = await (await send(app, 'PUT', `/admin/events/${newId()}`, { title: 'Night', startsAt: new Date().toISOString(), status: 'published' })).json();
  const ok = await send(app, 'PUT', `/admin/gallery/${id}`, { image: 'https://example.com/a.jpg', caption: ' Hi ', eventId: ev.id });
  assertEquals(ok.status, 201);
  const item = await ok.json();
  assertEquals([item.caption, item.eventId], ['Hi', ev.id]);
  // Caption and order change in place; eventId null clears the link.
  const upd = await (await send(app, 'PUT', `/admin/gallery/${id}`, { caption: 'New', sort: 5, eventId: null })).json();
  assertEquals([upd.caption, upd.sort, upd.eventId, upd.image], ['New', 5, null, 'https://example.com/a.jpg']);
});

Deno.test('admin community routes: every one is 401 without a token and 403 for a non-admin, before anything is read', async () => {
  const { app } = await setup();
  const id = newId();
  const routes: [string, string, unknown][] = [
    ['GET', '/admin/subscribers', undefined],
    ['POST', `/admin/subscribers/${id}/unsubscribe`, undefined],
    ['GET', '/admin/gallery', undefined],
    ['PUT', `/admin/gallery/${id}`, { image: 'https://example.com/a.jpg' }],
    ['DELETE', `/admin/gallery/${id}`, undefined],
  ];
  for (const [method, path, body] of routes) {
    for (const [headers, status] of [[JSON_H, 401], [{ Authorization: 'Bearer user', ...JSON_H }, 403]] as const) {
      const r = await send(app, method, path, body, headers);
      assertEquals(r.status, status, `${method} ${path}`);
      // A malformed body is still 401 or 403, not 400.
      if (method === 'GET') continue;
      const m = await app.request(`${P}${path}`, { method, headers, body: '{bad' });
      assertEquals(m.status, status, `${method} ${path} (bad body)`);
    }
  }
  // Nothing was written by the refused PUT.
  assertEquals((await (await send(app, 'GET', '/admin/gallery')).json()).length, 0);
});
