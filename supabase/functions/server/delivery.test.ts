// HTTP tests for the admin delivery option routes (delivery_routes.ts), against the in-memory stores in dev.ts. The SQL
// functions they mirror are tested in supabase/tests/delivery.test.ts.
import { assertEquals } from '@std/assert';
import { createApp } from './app.ts';
import { createMemoryDb, createMemoryDeps, memoryDeliveryOptions } from './dev.ts';
import type { DeliveryOptionAdmin, Deps, Order } from './types.ts';

const P = '/make-server-fbb8f0e1';
const JSON_H = { 'Content-Type': 'application/json' };
const ADMIN = { Authorization: 'Bearer admin', ...JSON_H };
const USER = { Authorization: 'Bearer user', ...JSON_H };

const isAdmin: Deps['isAdmin'] = (h) =>
  Promise.resolve(h === 'Bearer admin' ? 'ok' : h === 'Bearer user' ? 'forbidden' : 'unauthenticated');

async function setup() {
  const deps = await createMemoryDeps(isAdmin, true);
  return createApp(deps);
}
type App = Awaited<ReturnType<typeof setup>>;

const send = (app: App, method: string, path: string, body?: unknown, headers: Record<string, string> = ADMIN) =>
  app.request(`${P}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const listAll = async (app: App): Promise<DeliveryOptionAdmin[]> => await (await send(app, 'GET', '/admin/delivery-options')).json();
const put = (app: App, id: string, body: unknown) => send(app, 'PUT', `/admin/delivery-options/${id}`, body);
const GOOD = { name: 'Courier', price: 99.5, active: true };

Deno.test('delivery admin: 401 without a session and 403 for a non-admin, on both routes', async () => {
  const app = await setup();
  for (const [headers, status] of [[JSON_H, 401], [{ Authorization: 'Bearer nobody', ...JSON_H }, 401], [USER, 403]] as const) {
    assertEquals((await send(app, 'GET', '/admin/delivery-options', undefined, headers)).status, status);
    assertEquals((await send(app, 'PUT', '/admin/delivery-options/door', GOOD, headers)).status, status);
  }
  assertEquals((await listAll(app))[0].name, 'Door delivery');
});

Deno.test('delivery admin: the list has every option with sort and active, and inactive ones only here', async () => {
  const app = await setup();
  assertEquals(await listAll(app), [
    { id: 'door', name: 'Door delivery', price: 85, sort: 1, active: true },
    { id: 'locker', name: 'Locker', price: 55, sort: 2, active: true },
    { id: 'collect', name: 'Collect', price: 0, sort: 3, active: true },
  ]);
  assertEquals((await put(app, 'locker', { name: 'Locker', price: 55, active: false })).status, 200);
  assertEquals((await listAll(app)).map((o) => [o.id, o.active]), [['door', true], ['locker', false], ['collect', true]]);
  const pub = (await (await app.request(`${P}/delivery-options`)).json()) as { id: string }[];
  assertEquals(pub.map((o) => o.id), ['door', 'collect']);
});

Deno.test('delivery admin: an edit returns the option and shows in the public list', async () => {
  const app = await setup();
  const r = await put(app, 'door', { name: '  Courier  ', price: 99.5, active: true });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { id: 'door', name: 'Courier', price: 99.5, sort: 1, active: true });
  assertEquals(((await (await app.request(`${P}/delivery-options`)).json()) as unknown[])[0], {
    id: 'door',
    name: 'Courier',
    price: 99.5,
  });
  // Free, the top of the range and a two-decimal price are all fine.
  for (const price of [0, 10000, 0.1, 12.34]) assertEquals((await put(app, 'locker', { ...GOOD, price })).status, 200);
});

Deno.test('delivery admin: a placed order uses the changed price, and a turned-off option is refused', async () => {
  const app = await setup();
  await put(app, 'door', { name: 'Door delivery', price: 120, active: true });
  const order = (id: string, method: string) =>
    app.request(`${P}/orders`, {
      method: 'POST',
      headers: JSON_H,
      body: JSON.stringify({
        id,
        items: [{ productId: '1', quantity: 1 }],
        customer: { name: 'Test', phone: '0821234567' },
        delivery: method === 'door'
          ? { method, address: { line1: '12 Main Rd', suburb: 'Sea Point', city: 'Cape Town', postalCode: '8005' } }
          : { method },
      }),
    });
  const r = await order(crypto.randomUUID(), 'door');
  assertEquals(r.status, 201);
  const o = (await r.json()) as Order;
  assertEquals(o.deliveryFee, 120);
  assertEquals(o.total, o.lines[0].subtotal + 120);
  await put(app, 'collect', { name: 'Collect', price: 0, active: false });
  assertEquals((await order(crypto.randomUUID(), 'collect')).status, 400);
});

Deno.test('delivery admin: bad name, price, active and body each give 400 and change nothing', async () => {
  const app = await setup();
  const was = await listAll(app);
  const bad: unknown[] = [
    ...[undefined, '', '   ', 'x'.repeat(61), 5, null].map((name) => ({ ...GOOD, name })),
    ...[undefined, -1, -0.01, 10000.01, 1.005, 12.345, NaN, Infinity, '5', null, true].map((price) => ({ ...GOOD, price })),
    ...[undefined, 'true', 1, 0, null].map((active) => ({ ...GOOD, active })),
    [], null, 'text', 7,
  ];
  for (const body of bad) {
    const r = await put(app, 'door', body);
    assertEquals(r.status, 400, JSON.stringify(body));
    assertEquals(typeof ((await r.json()) as { error: string }).error, 'string');
  }
  const malformed = await app.request(`${P}/admin/delivery-options/door`, { method: 'PUT', headers: ADMIN, body: '{nope' });
  assertEquals(malformed.status, 400);
  assertEquals(await listAll(app), was);
  // Name length limits: 1 and 60 characters pass.
  assertEquals((await put(app, 'door', { ...GOOD, name: 'x' })).status, 200);
  assertEquals((await put(app, 'door', { ...GOOD, name: 'x'.repeat(60) })).status, 200);
});

Deno.test('delivery admin: an unknown id is 404, also for a bad body only after it validates', async () => {
  const app = await setup();
  const r = await put(app, 'drone', GOOD);
  assertEquals(r.status, 404);
  assertEquals(await r.json(), { error: 'Delivery option not found' });
  assertEquals((await put(app, 'drone', { ...GOOD, price: -1 })).status, 400);
  assertEquals((await listAll(app)).length, 3);
});

Deno.test('delivery admin: turning off the last active option is 409 and changes nothing', async () => {
  const app = await setup();
  assertEquals((await put(app, 'door', { name: 'Door delivery', price: 85, active: false })).status, 200);
  assertEquals((await put(app, 'locker', { name: 'Locker', price: 55, active: false })).status, 200);
  const was = await listAll(app);
  const r = await put(app, 'collect', { name: 'Pick up', price: 5, active: false });
  assertEquals(r.status, 409);
  assertEquals(await r.json(), { error: 'At least one delivery option must stay on', code: 'last_active' });
  assertEquals(await listAll(app), was);
  // Staying on is fine, and turning another back on frees the last one to go off.
  assertEquals((await put(app, 'collect', { name: 'Pick up', price: 5, active: true })).status, 200);
  assertEquals((await put(app, 'door', { name: 'Door delivery', price: 85, active: true })).status, 200);
  assertEquals((await put(app, 'collect', { name: 'Pick up', price: 5, active: false })).status, 200);
});

Deno.test('delivery admin: saving an off option as off works when nothing is on (as in SQL)', async () => {
  const db = createMemoryDb();
  for (const o of db.deliveryOptions.values()) o.active = false;
  const store = memoryDeliveryOptions(db);
  const r = await store.update('door', { name: 'Door', price: 80, active: false });
  assertEquals(r, { ok: true, option: { id: 'door', name: 'Door', price: 80, sort: 1, active: false } });
});

Deno.test('delivery admin: two edits at once cannot turn both of the last two options off', async () => {
  const app = await setup();
  await put(app, 'door', { name: 'Door delivery', price: 85, active: false });
  const [a, b] = await Promise.all([
    put(app, 'locker', { name: 'Locker', price: 55, active: false }),
    put(app, 'collect', { name: 'Collect', price: 0, active: false }),
  ]);
  assertEquals([a.status, b.status].sort(), [200, 409]);
  assertEquals((await listAll(app)).filter((o) => o.active).length, 1);
});
