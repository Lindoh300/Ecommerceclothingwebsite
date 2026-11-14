// HTTP and store tests for discount codes (discount_routes.ts, the discount parts of app.ts, validation.ts and
// mailer.ts), against the in-memory stores in dev.ts. The SQL functions they mirror are tested in
// supabase/tests/discounts.test.ts (place_order_v4, the use-release trigger, check_discount and the grants).
import { assert, assertEquals } from '@std/assert';
import { createApp, toPublicOrder } from './app.ts';
import { createMemoryDb, createMemoryDeps, discountRule, memoryDiscounts } from './dev.ts';
import { createFakeProvider } from './fake_payments.ts';
import { createFakeMailer, orderReceivedEmail, paymentReceivedEmail } from './mailer.ts';
import type { CartQuote, Deps, Discount, DiscountCheckResult, DiscountInput, Order } from './types.ts';
import { validateDiscountInput, validateOrder, validateQuote } from './validation.ts';

const P = '/make-server-fbb8f0e1';
const JSON_H = { 'Content-Type': 'application/json' };
const ADMIN = { Authorization: 'Bearer admin', ...JSON_H };
const USER = { Authorization: 'Bearer user', ...JSON_H };
const CUSTOMER = { name: 'Test', phone: '0821234567' };
const ONLINE_CUSTOMER = { ...CUSTOMER, email: 't@example.com' };
const DOOR = { method: 'door', address: { line1: '12 Main Rd', suburb: 'Sea Point', city: 'Cape Town', postalCode: '8005' } };
const COLLECT = { method: 'collect' };

const isAdmin: Deps['isAdmin'] = (h) =>
  Promise.resolve(h === 'Bearer admin' ? 'ok' : h === 'Bearer user' ? 'forbidden' : 'unauthenticated');

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T10:00:00Z');

async function setup() {
  let t = T0;
  const clock = { now: () => t, advance: (ms: number) => void (t += ms) };
  const deps = await createMemoryDeps(isAdmin, true, createFakeProvider('test-secret'), clock.now);
  const mailer = createFakeMailer();
  const app = createApp({ ...deps, mailer });
  return { deps, app, mailer, clock };
}
type W = Awaited<ReturnType<typeof setup>>;

const send = (app: W['app'], method: string, path: string, body?: unknown, headers: Record<string, string> = ADMIN) =>
  app.request(`${P}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const GOOD = { code: 'SAVE10', kind: 'percent', value: 10, active: true };
const put = (w: W, body: unknown, id: string = crypto.randomUUID()) => send(w.app, 'PUT', `/admin/discounts/${id}`, body);
const make = async (w: W, over: Record<string, unknown> = {}, id: string = crypto.randomUUID()): Promise<Discount> => {
  const r = await put(w, { ...GOOD, ...over }, id);
  assertEquals(r.status, 200, JSON.stringify(over));
  return (await r.json()) as Discount;
};
const list = async (w: W): Promise<Discount[]> => await (await send(w.app, 'GET', '/admin/discounts')).json();
const uses = async (w: W, id: string) => (await list(w)).find((d) => d.id === id)!.uses;

/** Product 1 is R25: two of them are R50 of goods. */
const orderBody = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  items: [{ productId: '1', quantity: 2 }],
  customer: CUSTOMER,
  ...over,
});
const placeAt = (w: W, body: unknown, ip?: string) =>
  w.app.request(`${P}/orders`, { method: 'POST', headers: { ...JSON_H, ...(ip ? { 'cf-connecting-ip': ip } : {}) }, body: JSON.stringify(body) });
const placeOk = async (w: W, body: Record<string, unknown>, ip?: string): Promise<Order> => {
  const r = await placeAt(w, body, ip);
  assert(r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(body)}`);
  return (await r.json()) as Order;
};
const stock1 = async (w: W) => (await w.deps.products.get('1'))!.stock;
const quote = (w: W, body: unknown, ip?: string) =>
  w.app.request(`${P}/cart/quote`, { method: 'POST', headers: { ...JSON_H, ...(ip ? { 'cf-connecting-ip': ip } : {}) }, body: JSON.stringify(body) });

// --- admin routes -----------------------------------------------------------------------------------------------------

Deno.test('discounts admin: 401 without a session and 403 for a non-admin, on both routes, and nothing is changed', async () => {
  const w = await setup();
  const id = crypto.randomUUID();
  for (const [headers, status] of [[JSON_H, 401], [{ Authorization: 'Bearer nobody', ...JSON_H }, 401], [USER, 403]] as const) {
    assertEquals((await send(w.app, 'GET', '/admin/discounts', undefined, headers)).status, status);
    assertEquals((await send(w.app, 'PUT', `/admin/discounts/${id}`, GOOD, headers)).status, status);
  }
  assertEquals(await list(w), []);
});

Deno.test('discounts admin: create returns the code with uses 0; the list is newest first with the exact keys', async () => {
  const w = await setup();
  const a = await make(w, { code: 'FIRST' });
  w.clock.advance(1000);
  const b = await make(w, {
    code: ' second ', kind: 'fixed', value: 25.5, minSpend: 100, expiresAt: '2099-01-01T00:00:00Z', maxUses: 4, active: false,
  });
  assertEquals(Object.keys(a).sort(), ['active', 'code', 'createdAt', 'expiresAt', 'id', 'kind', 'maxUses', 'minSpend', 'uses', 'value']);
  assertEquals(
    [a.code, a.kind, a.value, a.minSpend, a.expiresAt, a.maxUses, a.uses, a.active],
    ['FIRST', 'percent', 10, 0, null, null, 0, true],
  );
  assertEquals(
    [b.code, b.kind, b.value, b.minSpend, b.expiresAt, b.maxUses, b.uses, b.active],
    ['SECOND', 'fixed', 25.5, 100, '2099-01-01T00:00:00.000Z', 4, 0, false],
  );
  assertEquals((await list(w)).map((d) => d.code), ['SECOND', 'FIRST']);
});

Deno.test('discounts admin: PUT again updates by id, keeps uses and createdAt, and `uses` in the body is ignored', async () => {
  const w = await setup();
  const d = await make(w, { code: 'SAVE10', maxUses: 5 });
  assert((await placeAt(w, orderBody({ discountCode: 'SAVE10' }))).status === 201);
  assertEquals(await uses(w, d.id), 1);
  w.clock.advance(5000);
  const r = await put(w, { code: 'WINTER', kind: 'fixed', value: 5, active: true, uses: 99, id: 'other', createdAt: 'x' }, d.id);
  assertEquals(r.status, 200);
  const u = (await r.json()) as Discount;
  assertEquals([u.id, u.code, u.kind, u.value, u.uses, u.createdAt, u.maxUses], [d.id, 'WINTER', 'fixed', 5, 1, d.createdAt, null]);
  // A brand new code with `uses` in the body starts at 0.
  assertEquals((await make(w, { code: 'FRESH', uses: 50 })).uses, 0);
  assertEquals((await list(w)).length, 2);
});

Deno.test('discounts admin: a duplicate code is 409 code_taken and changes nothing', async () => {
  const w = await setup();
  const a = await make(w, { code: 'TAKEN' });
  const b = await make(w, { code: 'OTHER' });
  const dup = await put(w, { ...GOOD, code: 'taken' });
  assertEquals(dup.status, 409);
  assertEquals(await dup.json(), { error: 'That code already exists', code: 'code_taken' });
  const rename = await put(w, { ...GOOD, code: 'TAKEN' }, b.id);
  assertEquals(rename.status, 409);
  assertEquals((await list(w)).map((d) => d.code).sort(), ['OTHER', 'TAKEN']);
  // Saving a code under its own id is fine.
  assertEquals((await put(w, { ...GOOD, code: 'TAKEN', value: 20 }, a.id)).status, 200);
});

Deno.test('discounts admin: a bad id or body is 400 and changes nothing', async () => {
  const w = await setup();
  const bad: unknown[] = [
    ...[undefined, '', 'ab', 'x'.repeat(21), 'has space', 'bad!', 'a_b', 5, null].map((code) => ({ ...GOOD, code })),
    ...[undefined, 'amount', 'PERCENT', 5, null].map((kind) => ({ ...GOOD, kind })),
    ...[undefined, 0, -1, 100.01, 1.005, 12.345, NaN, Infinity, '10', null, true].map((value) => ({ ...GOOD, value })),
    { ...GOOD, kind: 'fixed', value: 100000.01 },
    { ...GOOD, kind: 'fixed', value: 0 },
    ...[-1, 1.005, '5', null, true].map((minSpend) => ({ ...GOOD, minSpend })),
    ...['tomorrow', '2026-13-45T00:00:00Z', '2026-12-01', 123, true].map((expiresAt) => ({ ...GOOD, expiresAt })),
    ...[0, -1, 1.5, '3', true].map((maxUses) => ({ ...GOOD, maxUses })),
    ...[undefined, 'true', 1, 0, null].map((active) => ({ ...GOOD, active })),
    [], null, 'text', 7,
  ];
  for (const body of bad) {
    const r = await put(w, body);
    assertEquals(r.status, 400, JSON.stringify(body));
    assertEquals(typeof ((await r.json()) as { error: string }).error, 'string');
  }
  assertEquals((await send(w.app, 'PUT', '/admin/discounts/not-a-uuid', GOOD)).status, 400);
  assertEquals((await send(w.app, 'PUT', `/admin/discounts/${crypto.randomUUID()}`, undefined)).status, 400); // no body
  const malformed = await w.app.request(`${P}/admin/discounts/${crypto.randomUUID()}`, { method: 'PUT', headers: ADMIN, body: '{nope' });
  assertEquals(malformed.status, 400);
  assertEquals(await list(w), []);
});

Deno.test('discounts admin: the edges that are allowed', async () => {
  const w = await setup();
  assertEquals((await make(w, { code: 'ABC', value: 0.01 })).value, 0.01);
  assertEquals((await make(w, { code: 'FULL', value: 100 })).value, 100);
  assertEquals((await make(w, { code: 'BIGFIX', kind: 'fixed', value: 100000 })).value, 100000);
  assertEquals((await make(w, { code: 'A-B-C-1-2-3', minSpend: 0 })).minSpend, 0);
  assertEquals((await make(w, { code: 'X'.repeat(20), maxUses: 1, expiresAt: null })).maxUses, 1);
  assertEquals((await make(w, { code: 'EXP', expiresAt: '2030-05-05T10:00:00+02:00' })).expiresAt, '2030-05-05T08:00:00.000Z');
});

// --- validation -------------------------------------------------------------------------------------------------------

Deno.test('validateOrder: discountCode is trimmed and upper-cased; blank is none; a bad shape is 400', () => {
  const base = { id: crypto.randomUUID(), items: [{ productId: '1', quantity: 1 }], customer: CUSTOMER };
  const ok = (discountCode: unknown) => validateOrder({ ...base, discountCode });
  for (const [input, want] of [[' save-10 ', 'SAVE-10'], ['abc', 'ABC'], ['X'.repeat(20), 'X'.repeat(20)]] as const) {
    const r = ok(input);
    assert(r.ok && r.value.discountCode === want, input);
  }
  for (const blank of ['', '   ', null, undefined]) {
    const r = ok(blank);
    assert(r.ok && !('discountCode' in r.value), String(blank));
  }
  for (const bad of ['ab', 'X'.repeat(21), 'has space', 'bad!', 'a_b', 'é-code', 5, true, {}, []]) {
    assertEquals(ok(bad).ok, false, JSON.stringify(bad));
  }
  // No code at all: the value is exactly what it was before.
  const none = validateOrder(base);
  assert(none.ok && !('discountCode' in none.value));
});

Deno.test('validateQuote: discountCode is trimmed and upper-cased; blank is none; a non-string is 400', () => {
  const items = [{ productId: '1', quantity: 1 }];
  const r = validateQuote({ items, discountCode: ' save10 ' });
  assert(r.ok && r.value.discountCode === 'SAVE10');
  for (const blank of ['', '  ', null, undefined]) {
    const b = validateQuote({ items, discountCode: blank });
    assert(b.ok && !('discountCode' in b.value));
  }
  assertEquals(validateQuote({ items, discountCode: 5 }).ok, false);
  assertEquals(validateQuote({ items, discountCode: 'x'.repeat(201) }).ok, false);
  // A wrong shape passes validation: the route answers it as an invalid code without failing the quote.
  const odd = validateQuote({ items, discountCode: 'bad code!' });
  assert(odd.ok && odd.value.discountCode === 'BAD CODE!');
});

Deno.test('validateDiscountInput: defaults and the exact value it builds', () => {
  const r = validateDiscountInput({ code: ' abc ', kind: 'fixed', value: 5, active: false, uses: 9, extra: 1 });
  assertEquals(r, {
    ok: true,
    value: { code: 'ABC', kind: 'fixed', value: 5, minSpend: 0, expiresAt: null, maxUses: null, active: false },
  });
});

// --- the rule ---------------------------------------------------------------------------------------------------------

const row = (over: Partial<Discount> = {}): Discount => ({
  id: 'i', code: 'C', kind: 'percent', value: 10, minSpend: 0, expiresAt: null, maxUses: null, uses: 0, active: true,
  createdAt: 'x', ...over,
});

Deno.test('discountRule: percent and fixed, capped, and rounded to cents half away from zero', () => {
  assertEquals(discountRule(row(), 250, T0), { ok: true, amount: 25 });
  assertEquals(discountRule(row({ kind: 'fixed', value: 25 }), 250, T0), { ok: true, amount: 25 });
  assertEquals(discountRule(row({ kind: 'fixed', value: 500 }), 120, T0), { ok: true, amount: 120 });
  assertEquals(discountRule(row({ value: 100 }), 99.99, T0), { ok: true, amount: 99.99 });
  // 33.33 * 15% = 4.9995 -> 5; 10.05 * 10% = 1.005 -> 1.01; 10.04 * 10% = 1.004 -> 1; 99.99 * 33.33% = 33.32667 -> 33.33
  assertEquals(discountRule(row({ value: 15 }), 33.33, T0), { ok: true, amount: 5 });
  assertEquals(discountRule(row({ value: 10 }), 10.05, T0), { ok: true, amount: 1.01 });
  assertEquals(discountRule(row({ value: 10 }), 10.04, T0), { ok: true, amount: 1 });
  assertEquals(discountRule(row({ value: 33.33 }), 99.99, T0), { ok: true, amount: 33.33 });
  // 0.5 cent exactly (R0.05 at 10%) rounds up to a cent.
  assertEquals(discountRule(row({ value: 10 }), 0.05, T0), { ok: true, amount: 0.01 });
});

Deno.test('discountRule: off, expired (at the very moment too), used up and below minimum', () => {
  const invalid = { ok: false, reason: 'discount_invalid' } as const;
  assertEquals(discountRule(row({ active: false }), 100, T0), invalid);
  assertEquals(discountRule(row({ expiresAt: new Date(T0).toISOString() }), 100, T0), invalid);
  assertEquals(discountRule(row({ expiresAt: new Date(T0 - 1).toISOString() }), 100, T0), invalid);
  assertEquals(discountRule(row({ expiresAt: new Date(T0 + 1).toISOString() }), 100, T0), { ok: true, amount: 10 });
  assertEquals(discountRule(row({ maxUses: 3, uses: 3 }), 100, T0), invalid);
  assertEquals(discountRule(row({ maxUses: 3, uses: 2 }), 100, T0), { ok: true, amount: 10 });
  assertEquals(discountRule(row({ maxUses: 3, uses: 7 }), 100, T0), invalid);
  assertEquals(discountRule(row({ minSpend: 500 }), 499.99, T0), { ok: false, reason: 'discount_minimum', minSpend: 500 });
  assertEquals(discountRule(row({ minSpend: 500 }), 500, T0), { ok: true, amount: 50 });
  // Off beats the minimum: a guesser learns nothing.
  assertEquals(discountRule(row({ minSpend: 500, active: false }), 1, T0), invalid);
});

// --- placing an order -------------------------------------------------------------------------------------------------

Deno.test('order: a percent code comes off goods only, delivery is untouched, and the public order shows it', async () => {
  const w = await setup();
  const d = await make(w, { code: 'SAVE10', kind: 'percent', value: 10 });
  const o = await placeOk(w, orderBody({ discountCode: ' save10 ', delivery: DOOR }));
  // Goods R50, delivery R85, discount R5, total R130.
  assertEquals([o.deliveryFee, o.discountAmount, o.discountCode, o.total], [85, 5, 'SAVE10', 130]);
  assertEquals(await uses(w, d.id), 1);
  assertEquals(await stock1(w), 48);
  const stored = (await w.deps.orders.get(o.id))!;
  assertEquals([stored.discountCode, stored.discountAmount, stored.total], ['SAVE10', 5, 130]);
  const pub = await (await w.app.request(`${P}/orders/${o.id}/public`)).json();
  assertEquals([pub.discountCode, pub.discountAmount, pub.total, pub.deliveryFee], ['SAVE10', 5, 130, 85]);
  const listed = (await (await send(w.app, 'GET', '/orders')).json()) as Order[];
  assertEquals([listed[0].discountCode, listed[0].discountAmount], ['SAVE10', 5]);
});

Deno.test('order: a fixed code, a fixed value above goods caps at goods, and rounding to cents', async () => {
  const w = await setup();
  await make(w, { code: 'FIX10', kind: 'fixed', value: 10 });
  await make(w, { code: 'FIX900', kind: 'fixed', value: 900 });
  await make(w, { code: 'P33', kind: 'percent', value: 33.33 });
  const a = await placeOk(w, orderBody({ discountCode: 'FIX10', delivery: DOOR }));
  assertEquals([a.discountAmount, a.total], [10, 125]);
  const b = await placeOk(w, orderBody({ discountCode: 'FIX900', delivery: DOOR }));
  assertEquals([b.discountAmount, b.total], [50, 85]);
  // Goods 3 x R45 = R135; 33.33% = 44.9955 -> R45.00.
  const c = await placeOk(w, orderBody({ items: [{ productId: '2', quantity: 3 }], discountCode: 'P33', delivery: COLLECT }));
  assertEquals([c.discountAmount, c.total], [45, 90]);
  // Goods R20 (a cap); 33.33% = 6.666 -> R6.67; total 13.33 with no float dust.
  const e = await placeOk(w, orderBody({ items: [{ productId: '5', quantity: 1 }], discountCode: 'P33' }));
  assertEquals([e.discountAmount, e.total], [6.67, 13.33]);
});

Deno.test('order: POST /admin/orders takes a code too, and a blank code or null is none', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  const r = await send(w.app, 'POST', '/admin/orders', orderBody({ discountCode: 'save10' }));
  assertEquals(r.status, 201);
  const o = (await r.json()) as Order;
  assertEquals([o.discountCode, o.discountAmount, o.total], ['SAVE10', 5, 45]);
  // The admin route is guarded as before.
  assertEquals((await send(w.app, 'POST', '/admin/orders', orderBody({ discountCode: 'SAVE10' }), USER)).status, 403);
  for (const blank of ['', '   ', null]) {
    const n = await placeOk(w, orderBody({ discountCode: blank }));
    assertEquals([n.discountCode, n.discountAmount, n.total], [null, 0, 50]);
  }
  const plain = await placeOk(w, orderBody());
  assertEquals([plain.discountCode, plain.discountAmount, plain.total], [null, 0, 50]);
});

Deno.test('order: a malformed code is 400 and nothing is taken', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  const was = await stock1(w);
  for (const bad of ['ab', 'x'.repeat(21), 'has space', 'bad!', 5, true]) {
    assertEquals((await placeAt(w, orderBody({ discountCode: bad }))).status, 400, JSON.stringify(bad));
  }
  assertEquals(await stock1(w), was);
  assertEquals((await w.deps.orders.list()).length, 0);
});

Deno.test('order: unknown, off, expired and used-up codes give the same 409; below the minimum gives discount_minimum', async () => {
  const w = await setup();
  const invalid = { error: "This code isn't valid", code: 'discount_invalid' };
  await make(w, { code: 'OFF', active: false });
  await make(w, { code: 'OLD', expiresAt: new Date(T0 + HOUR).toISOString() });
  const full = await make(w, { code: 'FULL', maxUses: 1 });
  await make(w, { code: 'MIN500', minSpend: 500 });
  await make(w, { code: 'MINCENT', minSpend: 99.5 });
  assertEquals((await placeOk(w, orderBody({ discountCode: 'FULL' }))).discountCode, 'FULL');
  w.clock.advance(2 * HOUR);

  // Take one real order first, so "unchanged" is not just zero.
  await placeOk(w, orderBody(), '198.51.100.7');
  const was = { stock: await stock1(w), orders: (await w.deps.orders.list()).length, usesFull: await uses(w, full.id) };
  for (const code of ['NOPE', 'OFF', 'OLD', 'FULL']) {
    const r = await placeAt(w, orderBody({ discountCode: code }), '198.51.100.7');
    assertEquals(r.status, 409, code);
    assertEquals(await r.json(), invalid, code);
  }
  const min = await placeAt(w, orderBody({ discountCode: 'MIN500' }), '198.51.100.7');
  assertEquals(min.status, 409);
  assertEquals(await min.json(), { error: 'Spend at least R500 to use this code', code: 'discount_minimum', minSpend: 500 });
  const cent = await placeAt(w, orderBody({ discountCode: 'MINCENT' }), '198.51.100.7');
  assertEquals(((await cent.json()) as { error: string }).error, 'Spend at least R99.50 to use this code');
  // The same on the admin route.
  const admin = await send(w.app, 'POST', '/admin/orders', orderBody({ discountCode: 'NOPE' }));
  assertEquals([admin.status, await admin.json()], [409, invalid]);

  // Stock, orders and uses are as they were, and the failures did not use up the address's five orders an hour.
  assertEquals({ stock: await stock1(w), orders: (await w.deps.orders.list()).length, usesFull: await uses(w, full.id) }, was);
  for (let i = 0; i < 4; i++) assertEquals((await placeAt(w, orderBody(), '198.51.100.7')).status, 201);
  assertEquals((await placeAt(w, orderBody(), '198.51.100.7')).status, 429);
});

Deno.test('order: the order limit, a stock shortfall and unknown products answer before the code is looked at', async () => {
  const w = await setup();
  const d = await make(w, { code: 'SAVE10' });
  for (let i = 0; i < 5; i++) await placeOk(w, orderBody(), '192.0.2.5');
  const limited = await placeAt(w, orderBody({ discountCode: 'SAVE10' }), '192.0.2.5');
  assertEquals(limited.status, 429);
  assertEquals((await placeAt(w, orderBody({ items: [{ productId: '1', quantity: 999 }], discountCode: 'NOPE' }))).status, 400); // 50-per-line cap
  assertEquals((await placeAt(w, orderBody({ items: [{ productId: 'nope', quantity: 1 }], discountCode: 'NOPE' }))).status, 400);
  assertEquals(await uses(w, d.id), 0);
});

Deno.test('order: an idempotent replay changes neither uses nor the total', async () => {
  const w = await setup();
  const d = await make(w, { code: 'SAVE10', maxUses: 1 });
  const body = orderBody({ discountCode: 'SAVE10', delivery: DOOR });
  const first = await placeAt(w, body);
  assertEquals(first.status, 201);
  const o = (await first.json()) as Order;
  assertEquals(o.total, 130);
  // The code is used up now, and the replay still returns the first order.
  for (const code of ['SAVE10', 'NOPE', undefined]) {
    const again = await placeAt(w, { ...body, discountCode: code });
    assertEquals(again.status, 200);
    const r = (await again.json()) as Order;
    assertEquals([r.total, r.discountAmount, r.discountCode], [130, 5, 'SAVE10']);
    assertEquals(await uses(w, d.id), 1);
  }
  assertEquals(await stock1(w), 48);
  // An order placed without a code does not pick one up on replay.
  const plain = orderBody();
  await placeAt(w, plain);
  const e = await make(w, { code: 'SECOND', maxUses: 5 });
  const replay = (await (await placeAt(w, { ...plain, discountCode: 'SECOND' })).json()) as Order;
  assertEquals([replay.discountCode, replay.total], [null, 50]);
  assertEquals(await uses(w, e.id), 0);
});

Deno.test('order: the last use cannot be spent twice, even by two orders at the same moment', async () => {
  const w = await setup();
  const d = await make(w, { code: 'LAST', maxUses: 1 });
  const results = await Promise.all(
    Array.from({ length: 4 }, () => placeAt(w, orderBody({ discountCode: 'LAST' }))),
  );
  assertEquals(results.map((r) => r.status).sort(), [201, 409, 409, 409]);
  const loser = results.find((r) => r.status === 409)!;
  assertEquals(await loser.json(), { error: "This code isn't valid", code: 'discount_invalid' });
  assertEquals(await uses(w, d.id), 1);
  assertEquals(await stock1(w), 48);
  assertEquals((await w.deps.orders.list()).length, 1);
});

Deno.test('order: an online order that would total 0 fails and keeps nothing; a WhatsApp order may reach 0', async () => {
  const w = await setup();
  const d = await make(w, { code: 'FREE', kind: 'percent', value: 100 });
  const was = await stock1(w);
  const online = await placeAt(w, orderBody({ discountCode: 'FREE', paymentMethod: 'online', customer: ONLINE_CUSTOMER, delivery: COLLECT }), '203.0.113.1');
  assertEquals(online.status, 409);
  assertEquals(await online.json(), { error: "This code isn't valid", code: 'discount_invalid' });
  assertEquals([await stock1(w), (await w.deps.orders.list()).length, await uses(w, d.id)], [was, 0, 0]);
  // The failed order did not use up an order slot for the address.
  for (let i = 0; i < 5; i++) assertEquals((await placeAt(w, orderBody(), '203.0.113.1')).status, 201);

  // Delivery left to pay: an online order is fine.
  const fee = await placeOk(w, orderBody({ discountCode: 'FREE', paymentMethod: 'online', customer: ONLINE_CUSTOMER, delivery: DOOR }));
  assertEquals([fee.total, fee.status], [85, 'awaiting_payment']);
  // WhatsApp reaches zero.
  const wa = await placeOk(w, orderBody({ discountCode: 'FREE', delivery: COLLECT }));
  assertEquals([wa.total, wa.discountAmount, wa.status], [0, 50, 'pending']);
  assertEquals(await uses(w, d.id), 2);
});

// --- giving a use back ------------------------------------------------------------------------------------------------

Deno.test('uses: the cancel route, set-status cancel and expiry each give one use back, exactly once', async () => {
  const w = await setup();
  const d = await make(w, { code: 'SAVE10', maxUses: 9 });
  const a = await placeOk(w, orderBody({ discountCode: 'SAVE10' }));
  const b = await placeOk(w, orderBody({ discountCode: 'SAVE10' }));
  const c = await placeOk(w, orderBody({ discountCode: 'SAVE10', paymentMethod: 'online', customer: ONLINE_CUSTOMER }));
  const e = await placeOk(w, orderBody({ discountCode: 'SAVE10' }));
  assertEquals(await uses(w, d.id), 4);

  assertEquals((await send(w.app, 'POST', `/orders/${a.id}/cancel`, {})).status, 200);
  assertEquals(await uses(w, d.id), 3);
  await send(w.app, 'POST', `/orders/${a.id}/cancel`, {}); // again
  assertEquals(await uses(w, d.id), 3);

  assertEquals((await w.deps.orders.setStatus(b.id, 'cancelled', 'pending')).ok, true);
  assertEquals(await uses(w, d.id), 2);
  assertEquals((await w.deps.orders.setStatus(b.id, 'cancelled')).ok, true); // already there
  assertEquals((await w.deps.orders.setStatus(b.id, 'paid')).ok, false); // refused
  assertEquals(await uses(w, d.id), 2);

  // The expiry job: the online order (30 minutes) and the pending order (48 hours) both lapse.
  w.clock.advance(49 * HOUR);
  assertEquals((await w.deps.orders.expireDue()).sort(), [c.id, e.id].sort());
  assertEquals(await uses(w, d.id), 0);
  assertEquals((await w.deps.orders.expireDue()), []);
  assertEquals(await uses(w, d.id), 0);
  assertEquals(await stock1(w), 50);
  // A paid order is not given back by anything.
  const f = await placeOk(w, orderBody({ discountCode: 'SAVE10' }));
  await send(w.app, 'POST', `/orders/${f.id}/mark-paid`, {});
  assertEquals(await uses(w, d.id), 1);
});

Deno.test('uses: a code row that is gone, and uses never below zero, are no-ops', async () => {
  const w = await setup();
  const d = await make(w, { code: 'SAVE10' });
  const o = await placeOk(w, orderBody({ discountCode: 'SAVE10' }));
  const o2 = await placeOk(w, orderBody({ discountCode: 'SAVE10' }));
  (w.deps.orders as unknown as { patch(id: string, f: Partial<Order>): void }).patch(o.id, { status: 'cancelled' });
  assertEquals(await uses(w, d.id), 1);
  // The memory store has no delete for codes (neither does the API); the rule is "a missing row is a no-op", which
  // the SQL test covers with a real delete. Here: cancelling again changes nothing.
  assertEquals((await w.deps.orders.setStatus(o.id, 'cancelled')).ok, true);
  assertEquals(await uses(w, d.id), 1);
  assertEquals((await w.deps.orders.cancel(o2.id))!.status, 'cancelled');
  assertEquals(await uses(w, d.id), 0);
});

Deno.test('uses: a late payment takes the use again (past max_uses); refund after cancel changes nothing', async () => {
  const w = await setup();
  const d = await make(w, { code: 'ONE', maxUses: 1 });
  const o = await placeOk(w, orderBody({ discountCode: 'ONE', paymentMethod: 'online', customer: ONLINE_CUSTOMER, delivery: DOOR }));
  assertEquals(o.total, 130);
  assert(await w.deps.orders.attachPayment(o.id, o.id, 'https://pay.example/x'));
  w.clock.advance(HOUR);
  assertEquals(await w.deps.orders.expireDue(), [o.id]);
  assertEquals(await uses(w, d.id), 0);
  // Another customer takes the use.
  // (A different product, so the first customer's variant is still on the shelf when the money arrives.)
  assertEquals((await placeAt(w, orderBody({ items: [{ productId: '2', quantity: 1 }], discountCode: 'ONE' }))).status, 201);
  assertEquals(await uses(w, d.id), 1);
  // The first customer pays late, at the discounted amount: the order revives and the use is taken again, 2 of 1.
  assertEquals(await w.deps.orders.recordPayment(o.id, 13000, 'ZAR'), { ok: true, changed: true, outcome: 'paid_late' });
  assertEquals((await w.deps.orders.get(o.id))!.status, 'paid');
  assertEquals(await uses(w, d.id), 2);
  assertEquals(await w.deps.orders.recordPayment(o.id, 13000, 'ZAR'), { ok: true, changed: false, outcome: 'already' });
  assertEquals(await uses(w, d.id), 2);
  assertEquals((await w.deps.orders.setStatus(o.id, 'refunded')).ok, true);
  assertEquals(await uses(w, d.id), 2);
});

Deno.test('uses: a payment that needs a refund keeps the use given back, and refunding changes nothing', async () => {
  const w = await setup();
  const d = await make(w, { code: 'SAVE10' });
  const o = await placeOk(w, orderBody({ discountCode: 'SAVE10', paymentMethod: 'online', customer: ONLINE_CUSTOMER }));
  assert(await w.deps.orders.attachPayment(o.id, o.id, 'https://pay.example/x'));
  w.clock.advance(HOUR);
  await w.deps.orders.expireDue();
  assertEquals(await uses(w, d.id), 0);
  await w.deps.products.update('1', { stock: 0 });
  assertEquals(await w.deps.orders.recordPayment(o.id, 4500, 'ZAR'), { ok: true, changed: true, outcome: 'refund_due' });
  assertEquals((await w.deps.orders.get(o.id))!.status, 'expired');
  assertEquals(await uses(w, d.id), 0);
  assertEquals((await w.deps.orders.setStatus(o.id, 'refunded')).ok, true);
  assertEquals(await uses(w, d.id), 0);
});

Deno.test('payments: record_payment works on a discounted order at the discounted amount only', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  const o = await placeOk(w, orderBody({ discountCode: 'SAVE10', paymentMethod: 'online', customer: ONLINE_CUSTOMER, delivery: DOOR }));
  assertEquals(o.total, 130);
  assert(await w.deps.orders.attachPayment(o.id, o.id, 'https://pay.example/x'));
  assertEquals(await w.deps.orders.recordPayment(o.id, 13500, 'ZAR'), { ok: false, reason: 'amount_mismatch' }); // undiscounted
  assertEquals((await w.deps.orders.get(o.id))!.status, 'awaiting_payment');
  assertEquals(await w.deps.orders.recordPayment(o.id, 13000, 'ZAR'), { ok: true, changed: true, outcome: 'paid' });
  assertEquals((await w.deps.orders.get(o.id))!.status, 'paid');
  assertEquals((await w.deps.orders.paymentInfo(o.id))!.total, 130);
});

Deno.test('payments: the pay route charges the discounted total', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  const o = await placeOk(w, orderBody({ discountCode: 'SAVE10', paymentMethod: 'online', customer: ONLINE_CUSTOMER, delivery: DOOR }));
  const r = await w.app.request(`${P}/orders/${o.id}/pay`, { method: 'POST' });
  assertEquals(r.status, 200);
  assertEquals((await w.deps.orders.paymentInfo(o.id))!.total, 130);
});

// --- the check and the quote ------------------------------------------------------------------------------------------

Deno.test('check: 20 an hour per address, the 21st is rate_limited, an hour later it works again; no address, no limit', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  const check = (ip?: string) => w.deps.discounts.check('SAVE10', 200, ip);
  for (let i = 1; i <= 20; i++) assertEquals(await check('203.0.113.77'), { ok: true, code: 'SAVE10', amount: 20 }, `check ${i}`);
  assertEquals(await check('203.0.113.77'), { ok: false, reason: 'rate_limited' });
  assertEquals((await check('203.0.113.78')).ok, true); // another address
  for (let i = 0; i < 40; i++) assertEquals((await check()).ok, true); // no address
  w.clock.advance(HOUR + 1000);
  assertEquals((await check('203.0.113.77')).ok, true);
  // A refused check is not logged: after the hour the count restarts from one.
  for (let i = 0; i < 19; i++) assertEquals((await check('203.0.113.77')).ok, true);
  assertEquals((await check('203.0.113.77')).ok, false);
});

Deno.test('check: answers are the rule\'s, and a check never spends a use', async () => {
  const w = await setup();
  const d = await make(w, { code: 'MIN500', minSpend: 500, maxUses: 1 });
  const store = w.deps.discounts;
  assertEquals(await store.check('NOPE', 100), { ok: false, reason: 'discount_invalid' });
  assertEquals(await store.check('min500', 100), { ok: false, reason: 'discount_minimum', minSpend: 500 });
  assertEquals(await store.check(' min500 ', 600), { ok: true, code: 'MIN500', amount: 60 });
  assertEquals(await uses(w, d.id), 0);
});

Deno.test('quote: the total is unchanged by a code; discount is {code, amount}; no code means no discount key', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  const items = [{ productId: '1', quantity: 2 }, { productId: '2', quantity: 1 }];
  const plain = (await (await quote(w, { items })).json()) as CartQuote;
  assertEquals(plain.total, 95);
  assert(!('discount' in plain));
  const q = (await (await quote(w, { items, discountCode: ' save10 ' })).json()) as CartQuote;
  assertEquals(q.total, 95);
  assertEquals(q.discount, { code: 'SAVE10', amount: 9.5 });
  assertEquals({ ...q, discount: undefined }, { ...plain, discount: undefined });
  // Blank is none.
  for (const blank of ['', '  ', null]) {
    const b = (await (await quote(w, { items, discountCode: blank })).json()) as CartQuote;
    assert(!('discount' in b));
    assertEquals(b.total, 95);
  }
  assertEquals((await quote(w, { items, discountCode: 5 })).status, 400);
});

Deno.test('quote: unknown, off, expired and used-up codes are one discount_invalid; below the minimum says so', async () => {
  const w = await setup();
  await make(w, { code: 'OFF', active: false });
  await make(w, { code: 'OLD', expiresAt: new Date(T0 + HOUR).toISOString() });
  await make(w, { code: 'FULL', maxUses: 1 });
  await make(w, { code: 'MIN500', minSpend: 500 });
  await placeOk(w, orderBody({ discountCode: 'FULL' }));
  w.clock.advance(2 * HOUR);
  const items = [{ productId: '1', quantity: 2 }];
  for (const code of ['NOPE', 'OFF', 'OLD', 'FULL', 'bad code!', 'ab']) {
    const r = await quote(w, { items, discountCode: code });
    assertEquals(r.status, 200, code);
    const q = (await r.json()) as CartQuote;
    assertEquals(q.discount, { error: "This code isn't valid", code: 'discount_invalid' }, code);
    assertEquals(q.total, 50);
  }
  const min = (await (await quote(w, { items, discountCode: 'MIN500' })).json()) as CartQuote;
  assertEquals(min.discount, { error: 'Spend at least R500 to use this code', code: 'discount_minimum' });
});

Deno.test('quote: the store is only asked when a code was sent and no line is missing', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  const calls: [string, number][] = [];
  const spy = { ...w.deps.discounts, check: (code: string, goods: number, ip?: string) => {
    calls.push([code, goods]);
    return w.deps.discounts.check(code, goods, ip);
  } };
  const app = createApp({ ...w.deps, discounts: spy });
  const post = (body: unknown) => app.request(`${P}/cart/quote`, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) });
  await post({ items: [{ productId: '1', quantity: 1 }] });
  await post({ items: [{ productId: '1', quantity: 1 }], discountCode: '' });
  await post({ items: [{ productId: 'nope', quantity: 1 }], discountCode: 'SAVE10' });
  const half = (await (await post({ items: [{ productId: '1', quantity: 1 }, { productId: 'nope', quantity: 1 }], discountCode: 'SAVE10' })).json()) as CartQuote;
  assertEquals(calls, []);
  assertEquals(half.missing, ['nope']);
  assert(!('discount' in half));
  await post({ items: [{ productId: '1', quantity: 3 }], discountCode: 'bad code!' }); // wrong shape: not asked either
  assertEquals(calls, []);
  await post({ items: [{ productId: '1', quantity: 3 }], discountCode: 'save10' });
  assertEquals(calls, [['SAVE10', 75]]);
});

Deno.test('quote: the 21st check from one address is rate_limited inside discount, not a 429; totals are unchanged', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  const items = [{ productId: '1', quantity: 2 }];
  for (let i = 0; i < 20; i++) {
    const q = (await (await quote(w, { items, discountCode: 'SAVE10' }, '203.0.113.9')).json()) as CartQuote;
    assertEquals(q.discount, { code: 'SAVE10', amount: 5 });
  }
  const r = await quote(w, { items, discountCode: 'SAVE10' }, '203.0.113.9');
  assertEquals(r.status, 200);
  const q = (await r.json()) as CartQuote;
  assertEquals(q.discount, { error: 'Too many tries. Please wait a while and try again.', code: 'rate_limited' });
  assertEquals(q.total, 50);
  assertEquals(q.lines.length, 1);
  // Another address, and a quote with no code from the limited one, are fine.
  assertEquals(((await (await quote(w, { items, discountCode: 'SAVE10' }, '203.0.113.10')).json()) as CartQuote).discount, { code: 'SAVE10', amount: 5 });
  assert(!('discount' in ((await (await quote(w, { items }, '203.0.113.9')).json()) as CartQuote)));
  // Quotes do not touch the order limit.
  for (let i = 0; i < 5; i++) assertEquals((await placeAt(w, orderBody(), '203.0.113.9')).status, 201);
});

// --- the code attempt limit shared by orders and checks ---------------------------------------------------------------

Deno.test('attempts: 20 orders with a bad code from one address fail, the 21st is a 429; nothing is kept, the attempts are', async () => {
  const w = await setup();
  const d = await make(w, { code: 'REAL' });
  const ip = '203.0.113.99';
  const was = { stock: await stock1(w), orders: (await w.deps.orders.list()).length };
  for (let i = 1; i <= 20; i++) {
    const r = await placeAt(w, orderBody({ discountCode: `GUESS${i}` }), ip);
    assertEquals(r.status, 409, `try ${i}`);
    assertEquals(((await r.json()) as { code: string }).code, 'discount_invalid');
  }
  // The 21st, with a real code or a bad one, is refused before anything is looked at.
  for (const code of ['REAL', 'GUESS21']) {
    const r = await placeAt(w, orderBody({ discountCode: code }), ip);
    assertEquals(r.status, 429, code);
    assertEquals(r.headers.get('Retry-After'), '3600');
  }
  assertEquals({ stock: await stock1(w), orders: (await w.deps.orders.list()).length }, was);
  assertEquals(await uses(w, d.id), 0);
  // The failed attempts count even though the orders were undone: a check from the address is limited too.
  assertEquals(await w.deps.discounts.check('REAL', 100, ip), { ok: false, reason: 'rate_limited' });
  // Another address is fine, and an hour later the address can try again.
  assertEquals((await placeAt(w, orderBody({ discountCode: 'REAL' }), '203.0.113.100')).status, 201);
  w.clock.advance(HOUR + 1000);
  assertEquals((await placeAt(w, orderBody({ discountCode: 'REAL' }), ip)).status, 201);
});

Deno.test('attempts: orders and quotes share the same 20 an hour per address', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  const items = [{ productId: '1', quantity: 1 }];
  const ip = '198.51.100.20';
  for (let i = 0; i < 12; i++) {
    assertEquals(((await (await quote(w, { items, discountCode: 'SAVE10' }, ip)).json()) as CartQuote).discount, { code: 'SAVE10', amount: 2.5 });
  }
  for (let i = 0; i < 8; i++) assertEquals((await placeAt(w, orderBody({ discountCode: 'NOPE' }), ip)).status, 409);
  assertEquals(((await (await quote(w, { items, discountCode: 'SAVE10' }, ip)).json()) as CartQuote).discount, {
    error: 'Too many tries. Please wait a while and try again.',
    code: 'rate_limited',
  });
  assertEquals((await placeAt(w, orderBody({ discountCode: 'SAVE10' }), ip)).status, 429);
  // The other way round.
  const ip2 = '198.51.100.21';
  for (let i = 0; i < 20; i++) await placeAt(w, orderBody({ discountCode: 'NOPE' }), ip2);
  assertEquals((await w.deps.discounts.check('SAVE10', 100, ip2)).ok, false);
});

Deno.test('attempts: a replay at the limit returns the order and adds no attempt; a plain order from a limited address works', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  const ip = '203.0.113.60';
  const body = orderBody({ discountCode: 'SAVE10' });
  assertEquals((await placeAt(w, body, ip)).status, 201);
  for (let i = 0; i < 19; i++) await placeAt(w, orderBody({ discountCode: 'NOPE' }), ip);
  assertEquals((await placeAt(w, orderBody({ discountCode: 'SAVE10' }), ip)).status, 429);
  const again = await placeAt(w, body, ip);
  assertEquals(again.status, 200);
  assertEquals(((await again.json()) as Order).discountCode, 'SAVE10');
  // The replay took no attempt: a different order is still refused, and exactly 20 are logged (a new check is refused).
  assertEquals((await w.deps.discounts.check('SAVE10', 100, ip)).ok, false);
  // No code from a limited address: fine. A blank code is no code.
  assertEquals((await placeAt(w, orderBody(), ip)).status, 201);
  assertEquals((await placeAt(w, orderBody({ discountCode: '  ' }), ip)).status, 201);
});

Deno.test('attempts: no address means no limit (the owner\'s orders)', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  for (let i = 0; i < 25; i++) {
    assertEquals((await send(w.app, 'POST', '/admin/orders', orderBody({ discountCode: 'NOPE' }))).status, 409);
  }
  assertEquals((await send(w.app, 'POST', '/admin/orders', orderBody({ discountCode: 'SAVE10' }))).status, 201);
  // Without a cf-connecting-ip header a public order is not limited either (as for the order limit).
  for (let i = 0; i < 22; i++) assertEquals((await placeAt(w, orderBody({ discountCode: 'NOPE' }))).status, 409);
  assertEquals((await placeAt(w, orderBody({ discountCode: 'SAVE10' }))).status, 201);
});

// --- emails and the public shape --------------------------------------------------------------------------------------

Deno.test('mailer: order emails show a Discount line when the amount is above 0, and not otherwise', async () => {
  const w = await setup();
  await make(w, { code: 'SAVE10' });
  const withCode = await placeOk(w, orderBody({ discountCode: 'SAVE10', delivery: DOOR, customer: ONLINE_CUSTOMER }));
  const plain = await placeOk(w, orderBody({ delivery: DOOR, customer: ONLINE_CUSTOMER }));
  assertEquals(w.mailer.sent.length, 2);
  const [a, b] = w.mailer.sent.map((m) => m.text.split('\n'));
  assert(a.includes('Discount (SAVE10): -R5.00'), a.join('|'));
  assert(a.indexOf('Discount (SAVE10): -R5.00') < a.indexOf('Delivery: R85.00'));
  assert(a.includes('Total: R130.00'));
  assert(!b.some((l) => l.startsWith('Discount')), b.join('|'));
  assert(b.includes('Total: R135.00'));
  // The payment email shows it too.
  const pay = paymentReceivedEmail(withCode, null)!;
  assert(pay.text.includes('Discount (SAVE10): -R5.00'));
  // A zero amount, or an order from before discounts, shows no line.
  assert(!orderReceivedEmail({ ...plain, discountCode: 'X', discountAmount: 0 }, null)!.text.includes('Discount'));
  const { discountCode: _c, discountAmount: _a, ...old } = plain;
  assert(!orderReceivedEmail(old as Order, null)!.text.includes('Discount'));
});

Deno.test('public order: includes discountCode and discountAmount, and fills the empty values for an older order', () => {
  const old = toPublicOrder({ id: 'i', ref: 'R', createdAt: 'c', status: 'pending', lines: [], total: 5, customer: { name: 'N', phone: '1' } });
  assertEquals([old.discountCode, old.discountAmount], [null, 0]);
  const some = toPublicOrder({ ...{ id: 'i', ref: 'R', createdAt: 'c', status: 'pending' as const, lines: [], total: 5, customer: { name: 'N', phone: '1' } }, discountCode: 'ABC', discountAmount: 2.5 });
  assertEquals([some.discountCode, some.discountAmount], ['ABC', 2.5]);
});

Deno.test('store: upsert keeps uses and createdAt; list is newest first with the id as the tie-break', async () => {
  const db = createMemoryDb();
  let t = T0;
  const store = memoryDiscounts(db, undefined, () => t);
  const input: DiscountInput = { code: 'A', kind: 'percent', value: 10, minSpend: 0, expiresAt: null, maxUses: null, active: true };
  const r1 = await store.upsert('00000000-0000-4000-8000-000000000002', input);
  const r2 = await store.upsert('00000000-0000-4000-8000-000000000001', { ...input, code: 'B' });
  assert(r1.ok && r2.ok);
  assertEquals((await store.list()).map((d) => d.code), ['B', 'A']); // same createdAt: lower id first
  t += 1000;
  await store.upsert('00000000-0000-4000-8000-000000000003', { ...input, code: 'C' });
  assertEquals((await store.list()).map((d) => d.code), ['C', 'B', 'A']);
  db.discounts.get('00000000-0000-4000-8000-000000000002')!.uses = 3;
  const again = await store.upsert('00000000-0000-4000-8000-000000000002', { ...input, value: 20 });
  assert(again.ok && again.discount.uses === 3 && again.discount.value === 20 && again.discount.createdAt === r1.discount.createdAt);
  // The list gives copies: changing one does not change the store.
  (await store.list())[0].uses = 99;
  assertEquals((await store.list())[0].uses, 0);
  const r: DiscountCheckResult = await store.check('b', 100);
  assertEquals(r, { ok: true, code: 'B', amount: 10 });
});
