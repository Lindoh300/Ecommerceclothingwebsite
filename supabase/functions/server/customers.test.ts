// HTTP tests for the admin customer list (customers_routes.ts), against the in-memory stores in dev.ts. The SQL function
// it mirrors, list_customers, is tested in supabase/tests/customers.test.ts with the SAME orders and the same expected list.
import { assertEquals } from '@std/assert';
import { createApp } from './app.ts';
import { createMemoryDeps } from './dev.ts';
import type { CustomerSummary, Deps, Order, OrderStatus } from './types.ts';

const P = '/make-server-fbb8f0e1';
const JSON_H = { 'Content-Type': 'application/json' };
const ADMIN = { Authorization: 'Bearer admin', ...JSON_H };
const USER = { Authorization: 'Bearer user', ...JSON_H };

const isAdmin: Deps['isAdmin'] = (h) =>
  Promise.resolve(h === 'Bearer admin' ? 'ok' : h === 'Bearer user' ? 'forbidden' : 'unauthenticated');

async function setup() {
  const deps = await createMemoryDeps(isAdmin, true);
  return { deps, app: createApp(deps) };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const get = (ctx: Ctx, headers: Record<string, string> = ADMIN) =>
  ctx.app.request(`${P}/admin/customers`, { headers });
const list = async (ctx: Ctx): Promise<CustomerSummary[]> => await (await get(ctx)).json();

/** An order of any status, with the given customer, total and time. Stock is taken as for any order. */
async function addOrder(
  ctx: Ctx,
  o: { phone: string; name?: string; email?: string; status: OrderStatus; total: number; at: string },
): Promise<Order> {
  const r = await ctx.deps.orders.place(
    crypto.randomUUID(),
    [{ productId: '1', quantity: 1 }],
    { name: o.name ?? 'Test', phone: o.phone, ...(o.email === undefined ? {} : { email: o.email }) },
  );
  if (!r.ok) throw new Error('place failed');
  ctx.deps.orders.patch(r.order.id, { status: o.status, total: o.total, createdAt: o.at });
  return r.order;
}

const T = (n: number) => `2026-10-${String(n).padStart(2, '0')}T10:00:00.000Z`;

/** The shared scenario (also in the SQL test). */
async function scenario(ctx: Ctx) {
  const a = (phone: string, name: string, status: OrderStatus, total: number, at: string, email?: string) =>
    addOrder(ctx, { phone, name, status, total, at, email });
  // Ann: one number written three ways. Newest order has no email, an older one does.
  await a('0821234567', 'Ann Old', 'pending', 100, T(1), 'ann@x.com');
  await a('+27 82 123 4567', 'Ann Mid', 'shipped', 50, T(3));
  await a('082 123 4567', 'Ann', 'paid', 200.5, T(5));
  // Bea: delivered and refunded count as orders, only delivered as spend; the cancelled one is the newest.
  await a('0719998888', 'Bea', 'delivered', 80, T(2));
  await a('0719998888', 'Bea', 'refunded', 40, T(4));
  await a('0719998888', 'Bea', 'cancelled', 30, T(6));
  // Cy: only cancelled and expired. A blank email is none.
  await a('0605554444', 'Cy', 'cancelled', 70, T(7), '   ');
  await a('0605554444', 'Cy', 'expired', 20, T(8));
  // Di: packed and awaiting_payment; email from the older order.
  await a('0731112222', 'Di', 'packed', 10, T(0 + 1), 'di@x.com');
  await a('0731112222', 'Di', 'awaiting_payment', 60, T(9));
  // Flo: ties with Ann on the newest time, so phone decides. Her email is on the mailing list but her phone is not.
  await a('0830000002', 'Flo', 'pending', 20, T(5), 'flo@x.com');
  const c = ctx.deps.community;
  await c.subscribe({ phone: '+27821234567', source: 'footer' }, 'consent', undefined);
  await c.subscribe({ phone: '0719998888', source: 'footer' }, 'consent', undefined);
  await c.unsubscribeContact({ phone: '071 999 8888' }, undefined);
  await c.subscribe({ email: 'flo@x.com', source: 'footer' }, 'consent', undefined);
}

/** What both implementations must return for the scenario. */
export const EXPECTED: CustomerSummary[] = [
  { phone: '0731112222', name: 'Di', email: 'di@x.com', orders: 2, spent: 10, lastOrderAt: T(9), subscribed: false },
  { phone: '0605554444', name: 'Cy', email: null, orders: 0, spent: 0, lastOrderAt: T(8), subscribed: false },
  { phone: '0719998888', name: 'Bea', email: null, orders: 2, spent: 80, lastOrderAt: T(6), subscribed: false },
  { phone: '082 123 4567', name: 'Ann', email: 'ann@x.com', orders: 3, spent: 250.5, lastOrderAt: T(5), subscribed: true },
  { phone: '0830000002', name: 'Flo', email: 'flo@x.com', orders: 1, spent: 0, lastOrderAt: T(5), subscribed: false },
];

Deno.test('customers: 401 without a session and 403 for a non-admin, and nothing is read', async () => {
  const ctx = await setup();
  let reads = 0;
  const counted = createApp({ ...ctx.deps, customers: { list: () => (reads++, ctx.deps.customers.list()) } });
  for (const [headers, status] of [[JSON_H, 401], [{ Authorization: 'Bearer nobody', ...JSON_H }, 401], [USER, 403]] as const) {
    assertEquals((await counted.request(`${P}/admin/customers`, { headers })).status, status);
  }
  assertEquals(reads, 0);
  assertEquals((await counted.request(`${P}/admin/customers`, { headers: ADMIN })).status, 200);
  assertEquals(reads, 1);
});

Deno.test('customers: empty with no orders, and the response is not cached', async () => {
  const ctx = await setup();
  const r = await get(ctx);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get('Cache-Control'), 'no-store');
  assertEquals(await r.json(), []);
});

Deno.test('customers: the scenario gives the expected list (same as the SQL test)', async () => {
  const ctx = await setup();
  await scenario(ctx);
  assertEquals(await list(ctx), EXPECTED);
});

Deno.test('customers: one number written differently is one customer; +27, 0 and spaces are the same, other numbers are not', async () => {
  const ctx = await setup();
  for (const [i, phone] of ['0821234567', '082 123 4567', '+27 82 123 4567', '(082) 123-4567', '0821234568'].entries()) {
    await addOrder(ctx, { phone, status: 'paid', total: 10, at: T(i + 1) });
  }
  const got = await list(ctx);
  assertEquals(got.map((c) => [c.phone, c.orders]), [['0821234568', 1], ['(082) 123-4567', 4]]);
});

Deno.test('customers: each status group counts as the rules say', async () => {
  const ctx = await setup();
  const rows: [OrderStatus, number, number][] = [
    ['pending', 0, 1], ['awaiting_payment', 0, 1], ['paid', 10, 1], ['packed', 10, 1], ['shipped', 10, 1],
    ['delivered', 10, 1], ['refunded', 0, 1], ['cancelled', 0, 0], ['expired', 0, 0],
  ];
  for (const [i, [status, spent, orders]] of rows.entries()) {
    const phone = `07300000${String(i).padStart(2, '0')}`;
    await addOrder(ctx, { phone, status, total: 10, at: T(i + 1) });
    const c = (await list(ctx)).find((x) => x.phone === phone)!;
    assertEquals([status, c.spent, c.orders], [status, spent, orders]);
  }
});

Deno.test('customers: spent is exact to the cent', async () => {
  const ctx = await setup();
  for (const [i, total] of [0.1, 0.2, 100.05].entries()) {
    await addOrder(ctx, { phone: '0821234567', status: 'paid', total, at: T(i + 1) });
  }
  assertEquals((await list(ctx))[0].spent, 100.35);
});

Deno.test('customers: subscribed follows the phone only, and is false after an opt-out', async () => {
  const ctx = await setup();
  await addOrder(ctx, { phone: '0821234567', status: 'paid', total: 10, at: T(1), email: 'ann@x.com' });
  assertEquals((await list(ctx))[0].subscribed, false);
  await ctx.deps.community.subscribe({ email: 'ann@x.com', source: 'footer' }, 'consent', undefined);
  assertEquals((await list(ctx))[0].subscribed, false);
  await ctx.deps.community.subscribe({ phone: '+27 82 123 4567', source: 'footer' }, 'consent', undefined);
  assertEquals((await list(ctx))[0].subscribed, true);
  await ctx.deps.community.unsubscribeContact({ phone: '0821234567' }, undefined);
  assertEquals((await list(ctx))[0].subscribed, false);
});

Deno.test('customers: an owner-created order counts like any other', async () => {
  const ctx = await setup();
  const r = await ctx.app.request(`${P}/admin/orders`, {
    method: 'POST',
    headers: ADMIN,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      items: [{ productId: '1', quantity: 1 }],
      customer: { name: 'Walk In', phone: '0821234567' },
    }),
  });
  assertEquals(r.status, 201);
  const placed = (await r.json()) as Order;
  await ctx.deps.orders.setStatus(placed.id, 'paid');
  const got = await list(ctx);
  assertEquals(got.length, 1);
  assertEquals([got[0].name, got[0].orders, got[0].spent], ['Walk In', 1, placed.total]);
});
