// HTTP tests for the restock alert routes (restock_routes.ts), against the in-memory stores in dev.ts. The SQL
// functions they mirror are tested in supabase/tests/restock.test.ts.
import { assert, assertEquals } from '@std/assert';
import { createApp } from './app.ts';
import { createMemoryDeps } from './dev.ts';
import type { Deps, Product, RestockRequest, RestockStore, Subscriber } from './types.ts';

const P = '/make-server-fbb8f0e1';
const JSON_H = { 'Content-Type': 'application/json' };
const ADMIN = { Authorization: 'Bearer admin', ...JSON_H };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const newId = () => crypto.randomUUID();

const isAdmin: Deps['isAdmin'] = (h) =>
  Promise.resolve(h === 'Bearer admin' ? 'ok' : h === 'Bearer user' ? 'forbidden' : 'unauthenticated');

/** An app over empty memory stores with one category, and a clock the test can move. */
async function setup(now: () => number = Date.now) {
  const deps = await createMemoryDeps(isAdmin, false, null, now);
  await deps.categories.upsert({ id: 'tees', name: 'T-shirts' });
  return { app: createApp(deps), deps };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
type App = Ctx['app'];

const send = (app: App, method: string, path: string, body?: unknown, headers: Record<string, string> = ADMIN) =>
  app.request(`${P}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function mkProduct(deps: Deps, name: string, stocks: [string, string, number][], active = true): Promise<Product> {
  const id = newId();
  const r = await deps.products.create({
    id,
    name,
    category: 'tees',
    price: 100,
    description: '',
    images: [],
    sizes: [...new Set(stocks.map((s) => s[0]))],
    colors: [...new Set(stocks.map((s) => s[1]))],
    variants: stocks.map(([size, color, stock]) => ({ size, color, stock })),
  });
  assert(r.ok, JSON.stringify(r));
  if (!active) {
    const u = await deps.products.update(id, { active: false });
    assert(u.ok, JSON.stringify(u));
  }
  return (await deps.products.get(id))!;
}
const variantOf = (p: Product, size: string, color: string) => p.variants.find((v) => v.size === size && v.color === color)!;

const ask = (app: App, productId: string, body: unknown, headers: Record<string, string> = JSON_H) =>
  send(app, 'POST', `/products/${productId}/restock-alert`, body, headers);
const list = async (app: App): Promise<RestockRequest[]> => await (await send(app, 'GET', '/admin/restock-requests')).json();
const asIp = (ip: string) => ({ ...JSON_H, 'cf-connecting-ip': ip });

/** A product with M / Black sold out, L / Black in stock and S / Red sold out. */
async function shop(ctx: Ctx) {
  const p = await mkProduct(ctx.deps, 'Classic Tee', [['M', 'Black', 0], ['L', 'Black', 4], ['S', 'Red', 0]]);
  return { p, m: variantOf(p, 'M', 'Black'), l: variantOf(p, 'L', 'Black'), s: variantOf(p, 'S', 'Red') };
}

Deno.test('restock: a phone or an email on a sold-out option is 200 {ok:true} and shows in the admin list', async () => {
  const ctx = await setup();
  const { p, m } = await shop(ctx);
  const a = await ask(ctx.app, p.id, { variantId: m.id, phone: '082 123 4567' });
  const b = await ask(ctx.app, p.id, { variantId: m.id, email: 'Thandi@Example.com' });
  for (const r of [a, b]) {
    assertEquals(r.status, 200);
    assertEquals(await r.text(), JSON.stringify({ ok: true }));
  }
  const rows = await list(ctx.app);
  assertEquals(rows.length, 2);
  assertEquals(
    rows.map(({ id: _id, createdAt: _at, ...rest }) => rest),
    [
      { productId: p.id, productName: 'Classic Tee', productSlug: p.slug, variantId: m.id, size: 'M', color: 'Black', stock: 0, phone: '082 123 4567', email: null },
      { productId: p.id, productName: 'Classic Tee', productSlug: p.slug, variantId: m.id, size: 'M', color: 'Black', stock: 0, phone: null, email: 'Thandi@Example.com' },
    ],
  );
  assert(rows.every((r) => !Number.isNaN(Date.parse(r.createdAt))));
});

Deno.test('restock: a bad body is 400 and nothing is stored', async () => {
  const { app, deps } = await setup();
  const { p, m } = await shop({ app, deps });
  const bad: [string, unknown][] = [
    ['array', []],
    ['string', 'x'],
    ['no variant', { phone: '082 123 4567' }],
    ['variant not a string', { variantId: 7, phone: '082 123 4567' }],
    ['variant not a uuid', { variantId: 'M-Black', phone: '082 123 4567' }],
    ['no contact', { variantId: m.id }],
    ['blank contacts', { variantId: m.id, phone: '', email: '  ' }],
    ['both contacts', { variantId: m.id, phone: '082 123 4567', email: 'a@example.com' }],
    ['short phone', { variantId: m.id, phone: '12' }],
    ['phone with letters', { variantId: m.id, phone: 'call me maybe' }],
    ['phone not text', { variantId: m.id, phone: 821234567 }],
    ['bad email', { variantId: m.id, email: 'not-an-email' }],
    ['email not text', { variantId: m.id, email: 42 }],
  ];
  for (const [name, body] of bad) assertEquals((await ask(app, p.id, body)).status, 400, name);
  assertEquals((await ask(app, p.id, undefined)).status, 400);
  const raw = await app.request(`${P}/products/${p.id}/restock-alert`, { method: 'POST', headers: JSON_H, body: '{bad' });
  assertEquals(raw.status, 400);
  assertEquals(await raw.json(), { error: 'Malformed JSON' });
  assertEquals(await (await ask(app, p.id, { variantId: m.id })).json(), { error: 'Give a phone number or an email address' });
  assertEquals(
    await (await ask(app, p.id, { variantId: m.id, phone: '082 123 4567', email: 'a@example.com' })).json(),
    { error: 'Give one contact' },
  );
  assertEquals((await list(app)).length, 0);
});

Deno.test('restock: an invalid request does not use up the address limit', async () => {
  const { app, deps } = await setup();
  const { p, m } = await shop({ app, deps });
  const h = asIp('203.0.113.8');
  for (let i = 0; i < 8; i++) assertEquals((await ask(app, p.id, { variantId: m.id }, h)).status, 400);
  for (let i = 0; i < 5; i++) assertEquals((await ask(app, p.id, { variantId: m.id, phone: `082 111 ${2000 + i}` }, h)).status, 200);
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: '082 111 3000' }, h)).status, 429);
});

Deno.test('restock: a repeat from the same contact gives the same 200 and stays one row', async () => {
  const { app, deps } = await setup();
  const { p, m, s } = await shop({ app, deps });
  const answers: [number, string][] = [];
  for (const body of [
    { variantId: m.id, phone: '082 123 4567' },
    { variantId: m.id, phone: '+27 82 123 4567' },
    { variantId: m.id, phone: '0027821234567' },
    { variantId: m.id, email: 'Thandi@Example.com' },
    { variantId: m.id, email: 'thandi@example.com' },
    { variantId: m.id.toUpperCase(), email: 'THANDI@EXAMPLE.COM' },
  ]) {
    const r = await ask(app, p.id, body);
    answers.push([r.status, await r.text()]);
  }
  for (const a of answers) assertEquals(a, [200, JSON.stringify({ ok: true })]);
  assertEquals((await list(app)).length, 2);
  // The same contact on another option is a separate request; another person on the same option too.
  assertEquals((await ask(app, p.id, { variantId: s.id, phone: '082 123 4567' })).status, 200);
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: '083 000 1111' })).status, 200);
  assertEquals((await list(app)).length, 4);
});

Deno.test('restock: an unknown product, an inactive one and another product\'s variant are all 404', async () => {
  const { app, deps } = await setup();
  const { p, m } = await shop({ app, deps });
  const other = await mkProduct(deps, 'Other Tee', [['M', 'Black', 0]]);
  const hidden = await mkProduct(deps, 'Hidden Tee', [['M', 'Black', 0]], false);
  const phone = '082 123 4567';
  const cases: [string, string, string][] = [
    ['unknown product', newId(), m.id],
    ['a slug is not an id', p.slug, m.id],
    ['unknown variant', p.id, newId()],
    ['variant of another product', p.id, variantOf(other, 'M', 'Black').id],
    ['inactive product', hidden.id, variantOf(hidden, 'M', 'Black').id],
  ];
  for (const [name, productId, variantId] of cases) {
    const r = await ask(app, productId, { variantId, phone });
    assertEquals(r.status, 404, name);
    assertEquals(await r.json(), { error: 'Product not found' }, name);
  }
  assertEquals((await list(app)).length, 0);
});

Deno.test('restock: a variant with stock is 409 in_stock and nothing is stored', async () => {
  const { app, deps } = await setup();
  const { p, l } = await shop({ app, deps });
  const r = await ask(app, p.id, { variantId: l.id, email: 'a@example.com' });
  assertEquals(r.status, 409);
  assertEquals(await r.json(), { error: 'That option is in stock', code: 'in_stock' });
  assertEquals((await list(app)).length, 0);
});

Deno.test('restock: 5 per client IP in a rolling hour, then 429 with nothing kept; no ip, no limit', async () => {
  let t = Date.now();
  const { app, deps } = await setup(() => t);
  const { p, m } = await shop({ app, deps });
  const h = asIp('203.0.113.7');
  const phone = (n: number) => `082 000 ${1000 + n}`;
  for (let i = 0; i < 5; i++) assertEquals((await ask(app, p.id, { variantId: m.id, phone: phone(i) }, h)).status, 200);
  const sixth = await ask(app, p.id, { variantId: m.id, phone: phone(5) }, h);
  assertEquals(sixth.status, 429);
  assertEquals(sixth.headers.get('Retry-After'), '3600');
  assertEquals(await sixth.json(), {
    error: 'Too many requests from this connection. Please try again in an hour or message us on WhatsApp.',
    code: 'rate_limited',
  });
  assertEquals((await list(app)).length, 5);
  // A repeat counts too, so re-sending cannot dodge the limit, and a refused repeat says 429, not "known".
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: phone(0) }, h)).status, 429);
  // Another address is not affected; no address is never limited.
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: phone(6) }, asIp('198.51.100.9'))).status, 200);
  for (let i = 10; i < 18; i++) assertEquals((await ask(app, p.id, { variantId: m.id, phone: phone(i) })).status, 200);
  // An hour later the same address may ask again.
  t += HOUR + 1000;
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: phone(5) }, h)).status, 200);
});

Deno.test('restock: the address limit is shared with sign-ups and unsubscribes', async () => {
  const { app, deps } = await setup();
  const { p, m } = await shop({ app, deps });
  const h = asIp('203.0.113.21');
  const signUp = (phone: string) => send(app, 'POST', '/subscribers', { phone, consent: true, source: 'footer' }, h);
  const unsub = (email: string) => send(app, 'POST', '/subscribers/unsubscribe', { email }, h);
  assertEquals((await signUp('082 777 0001')).status, 200);
  assertEquals((await signUp('082 777 0002')).status, 200);
  assertEquals((await unsub('n@example.com')).status, 200);
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: '082 777 0003' }, h)).status, 200);
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: '082 777 0004' }, h)).status, 200);
  // Five used: all three kinds are refused now, and the restock request left nothing.
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: '082 777 0005' }, h)).status, 429);
  assertEquals((await signUp('082 777 0006')).status, 429);
  assertEquals((await unsub('m@example.com')).status, 429);
  assertEquals((await list(app)).map((r) => r.phone), ['082 777 0003', '082 777 0004']);
  const subs: Subscriber[] = await (await send(app, 'GET', '/admin/subscribers')).json();
  assertEquals(subs.length, 2);
});

Deno.test('restock: a not-found or in-stock answer uses up the limit like any other', async () => {
  const { app, deps } = await setup();
  const { p, m, l } = await shop({ app, deps });
  const h = asIp('203.0.113.30');
  for (let i = 0; i < 3; i++) assertEquals((await ask(app, p.id, { variantId: l.id, phone: `082 555 000${i}` }, h)).status, 409);
  for (let i = 0; i < 2; i++) assertEquals((await ask(app, newId(), { variantId: m.id, phone: `082 555 001${i}` }, h)).status, 404);
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: '082 555 0020' }, h)).status, 429);
});

Deno.test('restock: a request older than 180 days is deleted by the next request', async () => {
  let t = Date.now();
  const { app, deps } = await setup(() => t);
  const { p, m, s } = await shop({ app, deps });
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: '082 123 4567' })).status, 200);
  t += 100 * DAY;
  assertEquals((await ask(app, p.id, { variantId: m.id, email: 'new@example.com' })).status, 200);
  assertEquals((await list(app)).length, 2);
  t += 81 * DAY; // the phone request is now 181 days old, the email one 81
  assertEquals((await ask(app, p.id, { variantId: s.id, phone: '083 000 1111' })).status, 200);
  assertEquals((await list(app)).map((r) => r.email ?? r.phone), ['new@example.com', '083 000 1111']);
});

Deno.test('restock: a request goes when its product or its variant is deleted', async () => {
  const { app, deps } = await setup();
  const a = await mkProduct(deps, 'Gone Tee', [['M', 'Black', 0]]);
  const b = await shop({ app, deps });
  await ask(app, a.id, { variantId: a.variants[0].id, phone: '082 123 4567' });
  await ask(app, b.p.id, { variantId: b.m.id, phone: '082 123 4567' });
  assertEquals((await list(app)).length, 2);
  assertEquals(await deps.products.remove(a.id), true);
  assertEquals((await list(app)).map((r) => r.productId), [b.p.id]);
});

Deno.test('admin restock list: oldest first, with the option\'s current stock, and never cached', async () => {
  let t = Date.now();
  const { app, deps } = await setup(() => t);
  const { p, m, s } = await shop({ app, deps });
  await ask(app, p.id, { variantId: s.id, email: 'first@example.com' });
  t += 5000;
  await ask(app, p.id, { variantId: m.id, phone: '082 123 4567' });
  t += 5000;
  await ask(app, p.id, { variantId: m.id, email: 'third@example.com' });
  const res = await send(app, 'GET', '/admin/restock-requests');
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Cache-Control'), 'no-store');
  const rows: RestockRequest[] = await res.json();
  assertEquals(rows.map((r) => r.email ?? r.phone), ['first@example.com', '082 123 4567', 'third@example.com']);
  assertEquals(rows.map((r) => r.createdAt), [t - 10_000, t - 5000, t].map((x) => new Date(x).toISOString()));
  assertEquals(rows.map((r) => `${r.size}/${r.color}/${r.stock}`), ['S/Red/0', 'M/Black/0', 'M/Black/0']);
  // When the option comes back, the owner sees the stock.
  await deps.products.update(p.id, {}, undefined, [{ id: m.id, stock: 6 }]);
  assertEquals((await list(app)).map((r) => r.stock), [0, 6, 6]);
});

Deno.test('admin restock delete: 204 once, then 404; a non-UUID and an unknown id are 404', async () => {
  const { app, deps } = await setup();
  const { p, m } = await shop({ app, deps });
  await ask(app, p.id, { variantId: m.id, phone: '082 123 4567' });
  await ask(app, p.id, { variantId: m.id, email: 'a@example.com' });
  const [first, second] = await list(app);
  const del = await send(app, 'DELETE', `/admin/restock-requests/${first.id}`);
  assertEquals(del.status, 204);
  assertEquals(await del.text(), '');
  assertEquals((await list(app)).map((r) => r.id), [second.id]);
  assertEquals((await send(app, 'DELETE', `/admin/restock-requests/${first.id}`)).status, 404);
  assertEquals((await send(app, 'DELETE', '/admin/restock-requests/nope')).status, 404);
  assertEquals((await send(app, 'DELETE', `/admin/restock-requests/${newId()}`)).status, 404);
  assertEquals((await list(app)).length, 1);
  // After the owner removes a request, the person can ask again.
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: '082 123 4567' })).status, 200);
  assertEquals((await list(app)).length, 2);
  // The id is matched in any case.
  assertEquals((await send(app, 'DELETE', `/admin/restock-requests/${second.id.toUpperCase()}`)).status, 204);
});

Deno.test('admin restock routes: 401 without a token and 403 for a non-admin, and the store is not touched', async () => {
  const ctx = await setup();
  const { p, m } = await shop(ctx);
  await ask(ctx.app, p.id, { variantId: m.id, phone: '082 123 4567' });
  const [row] = await list(ctx.app);
  // Count every call into the store, then check the refused requests made none.
  const calls: string[] = [];
  const real = ctx.deps.restock;
  const spy: RestockStore = {
    request: (...a) => (calls.push('request'), real.request(...a)),
    list: () => (calls.push('list'), real.list()),
    remove: (...a) => (calls.push('remove'), real.remove(...a)),
  };
  const app = createApp({ ...ctx.deps, restock: spy });
  const routes: [string, string][] = [
    ['GET', '/admin/restock-requests'],
    ['DELETE', `/admin/restock-requests/${row.id}`],
    ['DELETE', '/admin/restock-requests/not-a-uuid'],
  ];
  for (const [method, path] of routes) {
    for (const [headers, status] of [[JSON_H, 401], [{ Authorization: 'Bearer user', ...JSON_H }, 403]] as const) {
      assertEquals((await send(app, method, path, undefined, headers)).status, status, `${method} ${path}`);
    }
  }
  assertEquals(calls, []);
  assertEquals((await list(ctx.app)).length, 1);
  // The public route is open to everyone and does call the store.
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: '083 000 1111' })).status, 200);
  assertEquals(calls, ['request']);
});

Deno.test('unsubscribe: removes the restock requests of that contact, in any spelling, and keeps everyone else\'s', async () => {
  const { app, deps } = await setup();
  const { p, m, s } = await shop({ app, deps });
  const unsub = (body: unknown) => send(app, 'POST', '/subscribers/unsubscribe', body, JSON_H);
  await ask(app, p.id, { variantId: m.id, phone: '082 123 4567' });
  await ask(app, p.id, { variantId: s.id, phone: '+27 82 123 4567' }); // the same person on another option
  await ask(app, p.id, { variantId: m.id, email: 'Thandi@Example.com' });
  await ask(app, p.id, { variantId: m.id, phone: '083 000 1111' });
  await ask(app, p.id, { variantId: s.id, email: 'keep@example.com' });
  assertEquals((await list(app)).length, 5);

  // Someone who is on no list at all can still be a restock requester; an unknown contact removes nothing.
  assertEquals((await unsub({ phone: '084 999 9999', email: 'nobody@example.com' })).status, 200);
  assertEquals((await list(app)).length, 5);

  assertEquals((await unsub({ phone: '0027821234567' })).status, 200);
  assertEquals((await list(app)).map((r) => r.email ?? r.phone), ['Thandi@Example.com', '083 000 1111', 'keep@example.com']);
  assertEquals((await unsub({ email: 'thandi@example.com' })).status, 200);
  assertEquals((await list(app)).map((r) => r.email ?? r.phone), ['083 000 1111', 'keep@example.com']);
  // A phone and an email together remove both people's requests.
  assertEquals((await unsub({ phone: '083 000 1111', email: 'KEEP@example.com' })).status, 200);
  assertEquals((await list(app)).length, 0);
});

Deno.test('unsubscribe: a request refused by the limit removes no restock request', async () => {
  const { app, deps } = await setup();
  const { p, m } = await shop({ app, deps });
  const h = asIp('203.0.113.40');
  assertEquals((await ask(app, p.id, { variantId: m.id, phone: '082 123 4567' })).status, 200);
  for (let i = 0; i < 5; i++) assertEquals((await send(app, 'POST', '/subscribers/unsubscribe', { email: `n${i}@example.com` }, h)).status, 200);
  assertEquals((await send(app, 'POST', '/subscribers/unsubscribe', { phone: '082 123 4567' }, h)).status, 429);
  assertEquals((await list(app)).length, 1);
});
