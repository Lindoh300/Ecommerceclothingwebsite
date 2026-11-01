// Tests for payments.ts (the Paystack provider, against a stubbed fetch: no network), the pay route and
// the webhook route. The secret below is made up for these tests; it is not a key to anything.
import { assert, assertEquals, assertNotEquals, assertRejects } from '@std/assert';
import { createApp } from './app.ts';
import {
  createLock,
  createMemoryDb,
  memoryCategories,
  memoryCustomers,
  memoryDeliveryOptions,
  memoryDiscounts,
  memoryCommunity,
  memoryListSends,
  memoryRestock,
  memoryEvents,
  type MemoryOrderStore,
  memoryOrders,
  memoryProducts,
} from './dev.ts';
import { createFakeProvider } from './fake_payments.ts';
import { createPaystackProvider, hmacSha512Hex, loadPaymentProvider, type PaymentProvider } from './payments.ts';
import { seedCatalogue } from './seed.ts';
import type { Deps, Order } from './types.ts';

const P = '/make-server-fbb8f0e1';
const SECRET = 'unit-test-secret-not-a-real-key';
const JSON_H = { 'Content-Type': 'application/json' };
const SIG = 'x-paystack-signature';
const UNAVAILABLE = { error: 'Online payment is not available' };

// deno-lint-ignore no-explicit-any
type Json = any;

// --- an independent signer, so the tests do not rely on hmacSha512Hex to check hmacSha512Hex -------------
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function sign(body: string, key = SECRET): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(body)));
}

// --- a stand-in for api.paystack.co --------------------------------------------------------------------
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  json: Json;
}

function stubPaystack() {
  const calls: Call[] = [];
  const tx = new Map<string, { amount: number; currency: string; paid: boolean }>();
  const stub = {
    calls,
    tx,
    /** Replace the answer to initialize / verify. Return an Error to make the request itself fail. */
    initialize: null as null | ((c: Call) => Response | Error),
    verify: null as null | ((ref: string) => Response | Error),
    /** The customer paid on Paystack's page. */
    markPaid: (ref: string) => {
      tx.get(ref)!.paid = true;
    },
    count: (path: string) => calls.filter((c) => c.url.includes(path)).length,
    fetch: (input: string, init?: RequestInit): Promise<Response> => {
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
      const call: Call = {
        url: input,
        method: init?.method ?? 'GET',
        headers,
        json: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      };
      calls.push(call);
      const done = (r: Response | Error) => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r));
      if (call.url === 'https://api.paystack.co/transaction/initialize' && call.method === 'POST') {
        if (stub.initialize) return done(stub.initialize(call));
        const ref = call.json.reference as string;
        tx.set(ref, { amount: call.json.amount, currency: call.json.currency, paid: false });
        return done(Response.json({
          status: true,
          message: 'Authorization URL created',
          data: { authorization_url: `https://checkout.paystack.test/${ref}`, access_code: 'ac_1', reference: ref },
        }));
      }
      const m = call.url.match(/^https:\/\/api\.paystack\.co\/transaction\/verify\/(.+)$/);
      if (m && call.method === 'GET') {
        const ref = decodeURIComponent(m[1]);
        if (stub.verify) return done(stub.verify(ref));
        const t = tx.get(ref);
        if (!t) return done(Response.json({ status: false, message: 'Transaction reference not found' }, { status: 404 }));
        return done(Response.json({
          status: true,
          message: 'Verification successful',
          data: { status: t.paid ? 'success' : 'abandoned', reference: ref, amount: t.amount, currency: t.currency },
        }));
      }
      return Promise.reject(new Error(`unexpected request to ${call.url}`));
    },
  };
  return stub;
}
type Stub = ReturnType<typeof stubPaystack>;

/** The real Paystack provider, wired to the stub. */
function paystackWith(stub: Stub, callbackUrl?: string): PaymentProvider {
  return createPaystackProvider(SECRET, stub.fetch, callbackUrl);
}

// --- the shop, with two sample shirts ----------------------------------------------------------------
const isAdmin: Deps['isAdmin'] = () => Promise.resolve('unauthenticated');

async function world(payments: PaymentProvider | null) {
  const db = createMemoryDb();
  const lock = createLock();
  const products = memoryProducts(db, lock);
  const categories = memoryCategories(db, lock);
  await seedCatalogue(categories, products);
  const mk = (id: string, price: number, stock: number) =>
    products.create({
      id,
      name: id,
      category: 'pants',
      price,
      description: '',
      images: [],
      sizes: ['M'],
      colors: ['Black'],
      stock,
    });
  await mk('shirt-1', 100.5, 5);
  await mk('shirt-2', 50, 5);
  const orders: MemoryOrderStore = memoryOrders(db, lock);
  const deps: Deps = {
    products,
    categories,
    deliveryOptions: memoryDeliveryOptions(db),
    discounts: memoryDiscounts(db),
    customers: memoryCustomers(() => orders.list(), () => Promise.resolve([])),
    orders,
    events: memoryEvents(lock),
    community: memoryCommunity(),
    restock: memoryRestock(),
    listSends: memoryListSends(),
    payments,
    mailer: null,
    siteUrl: null,
    isAdmin,
    uploadImage: () => Promise.resolve(''),
  };
  const app = createApp(deps);
  const stock = async (id: string) => (await products.get(id))!.stock;
  const order = async (id: string) => (await orders.list()).find((o) => o.id === id)!;
  return { deps, app, products, orders, stock, order };
}
type World = Awaited<ReturnType<typeof world>>;

async function paystackWorld() {
  const stub = stubPaystack();
  const w = await world(paystackWith(stub));
  return { ...w, stub };
}

const customer = { name: 'Thandi M', phone: '+27 82 123 4567', email: 'thandi@example.com' };

const postOrder = (app: World['app'], body: Json) =>
  app.request(`${P}/orders`, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) });

/** Place an online order for shirt-1 (R100.50 each). */
async function placeOnline(
  w: Pick<World, 'app'>,
  over: { items?: Json[]; delivery?: Json; customer?: Json; paymentMethod?: string } = {},
): Promise<Order> {
  const r = await postOrder(w.app, {
    id: crypto.randomUUID(),
    items: over.items ?? [{ productId: 'shirt-1', size: 'M', color: 'Black', quantity: 1 }],
    customer: over.customer ?? customer,
    delivery: over.delivery ?? { method: 'collect' },
    paymentMethod: over.paymentMethod ?? 'online',
  });
  assertEquals(r.status, 201);
  return (await r.json()) as Order;
}

const pay = (app: World['app'], id: string, body?: Json) =>
  app.request(`${P}/orders/${id}/pay`, {
    method: 'POST',
    headers: JSON_H,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** An online order that has been through /pay: the customer holds Paystack's page. */
async function startedOrder(w: World & { stub: Stub }, over: Parameters<typeof placeOnline>[1] = {}): Promise<Order> {
  const o = await placeOnline(w, over);
  assertEquals((await pay(w.app, o.id)).status, 200);
  return o;
}

const charge = (ref: string, data: Json = {}) =>
  JSON.stringify({ event: 'charge.success', data: { id: 1, status: 'success', reference: ref, ...data } });

/** POST the webhook. `signature` undefined = signed correctly, null = no header. */
async function deliver(app: World['app'], body: string, signature?: string | null) {
  const headers: Record<string, string> = { ...JSON_H };
  const sig = signature === undefined ? await sign(body) : signature;
  if (sig !== null) headers[SIG] = sig;
  return await app.request(`${P}/payments/webhook`, { method: 'POST', headers, body });
}

/** Silence expected console.error / console.warn from the routes, and keep what they wrote. */
async function quietly<T>(fn: () => T | Promise<T>): Promise<{ result: T; logged: string }> {
  const err = console.error;
  const warn = console.warn;
  let logged = '';
  console.error = (...a: unknown[]) => void (logged += a.map(String).join(' ') + '\n');
  console.warn = (...a: unknown[]) => void (logged += a.map(String).join(' ') + '\n');
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = err;
    console.warn = warn;
  }
}

const isUntouched = (o: Order) => o.status === 'awaiting_payment' && o.paidAt == null && o.paymentFlag == null;

// ---------------------------------------------------------------------------
// The signature code
// ---------------------------------------------------------------------------
Deno.test('hmacSha512Hex: the RFC 4231 vector, and the same answer as an independent signer', async () => {
  assertEquals(
    await hmacSha512Hex('Jefe', 'what do ya want for nothing?'),
    '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
  );
  for (const body of ['', '{"a":1}', 'héllo ✓']) {
    assertEquals(await hmacSha512Hex(SECRET, body), await sign(body));
    assertEquals(await hmacSha512Hex(SECRET, enc.encode(body)), await sign(body));
  }
});

Deno.test('loadPaymentProvider: no provider for an unset, empty or blank secret', async () => {
  assertEquals(loadPaymentProvider(undefined), null);
  assertEquals(loadPaymentProvider(''), null);
  assertEquals(loadPaymentProvider('   '), null);
  assertEquals(loadPaymentProvider('\n\t '), null);
  assertEquals(loadPaymentProvider(undefined, 'https://shop.example/thanks'), null);

  // A real secret gives a provider that trims it and carries the callback url. fetch is replaced so
  // nothing leaves the process.
  const stub = stubPaystack();
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string, init?: RequestInit) => stub.fetch(String(input), init)) as typeof fetch;
  try {
    const p = loadPaymentProvider(`  ${SECRET}\n`, ' https://shop.example/thanks ');
    assert(p);
    await p.start({ reference: 'r1', amountCents: 500, currency: 'ZAR', email: 'a@b.co', orderRef: 'ABC' });
  } finally {
    globalThis.fetch = realFetch;
  }
  assertEquals(stub.calls[0].headers.Authorization, `Bearer ${SECRET}`);
  assertEquals(stub.calls[0].json.callback_url, 'https://shop.example/thanks');
});

// ---------------------------------------------------------------------------
// Without the key
// ---------------------------------------------------------------------------
Deno.test('no key: pay, online orders and the webhook give 503 and change nothing; WhatsApp orders work', async () => {
  // An online order exists (placed while a provider was configured); then the shop runs without the key.
  const fake = createFakeProvider(SECRET);
  const w = await world(fake);
  const started = await startedOrder({ ...w, stub: stubPaystack() });
  const app = createApp({ ...w.deps, payments: null });

  const stockBefore = await w.stock('shirt-1');
  assertEquals((await pay(app, started.id)).status, 503);
  assertEquals(await (await pay(app, started.id)).json(), UNAVAILABLE);
  assertEquals((await pay(app, crypto.randomUUID())).status, 503, 'checked before the order is looked up');

  const online = await postOrder(app, {
    id: crypto.randomUUID(),
    items: [{ productId: 'shirt-1', size: 'M', color: 'Black', quantity: 2 }],
    customer,
    paymentMethod: 'online',
  });
  assertEquals(online.status, 503);
  assertEquals(await online.json(), UNAVAILABLE);
  assertEquals(await w.stock('shirt-1'), stockBefore, 'no stock was taken');
  assertEquals((await w.orders.list()).length, 1, 'no order was stored');

  const paid = await fake.pay(started.id);
  const hook = await app.request(`${P}/payments/webhook`, { method: 'POST', headers: paid.headers, body: paid.body });
  assertEquals(hook.status, 503);
  assertEquals(await hook.json(), UNAVAILABLE);
  assert(isUntouched(await w.order(started.id)), 'nothing was marked');

  const wa = await postOrder(app, {
    id: crypto.randomUUID(),
    items: [{ productId: 'shirt-1', size: 'M', color: 'Black', quantity: 1 }],
    customer: { name: 'A', phone: '0821234567' },
    paymentMethod: 'whatsapp',
  });
  assertEquals(wa.status, 201);
  assertEquals(((await wa.json()) as Order).status, 'pending');
  // And with no paymentMethod at all.
  assertEquals(
    (await postOrder(app, {
      id: crypto.randomUUID(),
      items: [{ productId: 'shirt-1', size: 'M', color: 'Black', quantity: 1 }],
      customer: { name: 'A', phone: '0821234567' },
    })).status,
    201,
  );
});

// ---------------------------------------------------------------------------
// The Paystack provider
// ---------------------------------------------------------------------------
Deno.test('paystack start: the request Paystack gets', async () => {
  const stub = stubPaystack();
  const p = paystackWith(stub, 'https://shop.example/thanks');
  const out = await p.start({ reference: 'abc-123', amountCents: 10050, currency: 'ZAR', email: 'a@b.co', orderRef: 'ABC12345' });
  assertEquals(out, { redirectUrl: 'https://checkout.paystack.test/abc-123' });
  const [c] = stub.calls;
  assertEquals([c.method, c.url], ['POST', 'https://api.paystack.co/transaction/initialize']);
  assertEquals(c.headers.Authorization, `Bearer ${SECRET}`);
  assertEquals(c.headers['Content-Type'], 'application/json');
  assertEquals(c.json, {
    email: 'a@b.co',
    amount: 10050,
    currency: 'ZAR',
    reference: 'abc-123',
    metadata: { orderRef: 'ABC12345' },
    callback_url: 'https://shop.example/thanks',
  });
  // No callback url configured: none is sent.
  await paystackWith(stub).start({ reference: 'r2', amountCents: 100, currency: 'ZAR', email: 'a@b.co', orderRef: 'X' });
  assert(!('callback_url' in stub.calls[1].json));
  // Amounts must be whole cents, and nothing is sent when they are not.
  for (const bad of [100.5, 0, -5, NaN]) {
    await assertRejects(() => p.start({ reference: 'r3', amountCents: bad, currency: 'ZAR', email: 'a@b.co', orderRef: 'X' }));
  }
  assertEquals(stub.calls.length, 2);
});

Deno.test('paystack failures carry Paystack\'s message and never the key', async () => {
  const input = { reference: 'r1', amountCents: 500, currency: 'ZAR' as const, email: 'a@b.co', orderRef: 'X' };
  const cases: [string, () => Response | Error, string][] = [
    ['http error', () => Response.json({ status: false, message: 'Duplicate Transaction Reference' }, { status: 400 }), 'Duplicate Transaction Reference'],
    ['status false on 200', () => Response.json({ status: false, message: 'Invalid amount' }), 'Invalid amount'],
    ['message that echoes the key', () => Response.json({ status: false, message: `Invalid key ${SECRET}` }, { status: 401 }), 'Invalid key'],
    ['not json', () => new Response('<html>bad gateway</html>', { status: 502 }), '502'],
    ['network failure that echoes the key', () => new TypeError(`connect failed, sent Bearer ${SECRET}`), 'connect failed'],
    ['no payment page', () => Response.json({ status: true, message: 'ok', data: {} }), 'no payment page'],
  ];
  for (const [label, answer, expected] of cases) {
    const stub = stubPaystack();
    stub.initialize = answer;
    const err = await assertRejects(() => paystackWith(stub).start(input), Error, expected, label);
    assert(!err.message.includes(SECRET), `${label}: the key is not in the message`);
  }
  // Same for verify.
  const stub = stubPaystack();
  stub.verify = () => Response.json({ status: false, message: `Transaction not found for ${SECRET}` }, { status: 404 });
  const err = await assertRejects(() => paystackWith(stub).verify('r1'), Error, 'Transaction not found');
  assert(!err.message.includes(SECRET));
});

Deno.test('paystack verify: asks GET /transaction/verify/{reference} and reads status, amount and currency', async () => {
  const stub = stubPaystack();
  const p = paystackWith(stub);
  await p.start({ reference: 'a b/c', amountCents: 2500, currency: 'ZAR', email: 'a@b.co', orderRef: 'X' });
  assertEquals(await p.verify('a b/c'), { status: 'not_paid', reference: 'a b/c', amountCents: 2500, currency: 'ZAR' });
  stub.markPaid('a b/c');
  assertEquals(await p.verify('a b/c'), { status: 'success', reference: 'a b/c', amountCents: 2500, currency: 'ZAR' });
  const last = stub.calls[stub.calls.length - 1];
  assertEquals([last.method, last.url], ['GET', 'https://api.paystack.co/transaction/verify/a%20b%2Fc']);
  assertEquals(last.headers.Authorization, `Bearer ${SECRET}`);

  // Anything that is not 'success' is not paid.
  for (const status of ['failed', 'abandoned', 'reversed', 'ongoing', '', undefined]) {
    stub.verify = (ref) => Response.json({ status: true, data: { status, reference: ref, amount: 2500, currency: 'ZAR' } });
    assertEquals((await p.verify('a b/c')).status, 'not_paid', String(status));
  }
  // Unreadable answers throw rather than guess.
  const odd: Json[] = [
    { status: 'success', reference: 'r', amount: 25.5, currency: 'ZAR' },
    { status: 'success', reference: 'r', amount: '2500', currency: 'ZAR' },
    { status: 'success', reference: 'r', amount: 2500 },
    { status: 'success', reference: 'other', amount: 2500, currency: 'ZAR' },
  ];
  for (const data of odd) {
    stub.verify = () => Response.json({ status: true, data });
    await assertRejects(() => p.verify('r'), Error, '', JSON.stringify(data));
  }
});

// ---------------------------------------------------------------------------
// POST /orders/:id/pay
// ---------------------------------------------------------------------------
Deno.test('pay: Paystack gets the server total in cents, ZAR, the order id and the order email; the body is ignored', async () => {
  const w = await paystackWorld();
  const o = await placeOnline(w, { delivery: { method: 'locker', locker: 'Pep Seapoint' } }); // 100.50 + 55
  assertEquals(o.total, 155.5);
  const r = await pay(w.app, o.id, { amount: 1, currency: 'USD', email: 'attacker@example.com', reference: 'x', total: 1 });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { redirectUrl: `https://checkout.paystack.test/${o.id}` });
  assertEquals(w.stub.calls.length, 1);
  const c = w.stub.calls[0];
  assertEquals([c.method, c.url], ['POST', 'https://api.paystack.co/transaction/initialize']);
  assertEquals(c.headers.Authorization, `Bearer ${SECRET}`);
  assertEquals(c.json.amount, 15550);
  assert(Number.isInteger(c.json.amount));
  assertEquals(c.json.currency, 'ZAR');
  assertEquals(c.json.reference, o.id);
  assertEquals(c.json.email, 'thandi@example.com');
  assertEquals(c.json.metadata, { orderRef: o.ref });

  // R100.50 on its own is 10050 cents (a float product would be 10050.000000000001).
  const collect = await placeOnline(w);
  assertEquals(collect.total, 100.5);
  assertEquals((await pay(w.app, collect.id)).status, 200);
  assertEquals(w.stub.calls[1].json.amount, 10050);
  // Awkward cents stay whole.
  const cheap = await placeOnline(w, { items: [{ productId: 'shirt-1', size: 'M', color: 'Black', quantity: 3 }] });
  assertEquals(cheap.total, 301.5);
  assertEquals((await pay(w.app, cheap.id)).status, 200);
  assertEquals(w.stub.calls[2].json.amount, 30150);
});

Deno.test('pay: a second call returns the stored URL and does not call the provider', async () => {
  const w = await paystackWorld();
  const o = await placeOnline(w);
  const first = await (await pay(w.app, o.id)).json();
  const again = await pay(w.app, o.id, { amount: 5 });
  assertEquals(again.status, 200);
  assertEquals(await again.json(), first);
  assertEquals(w.stub.count('/transaction/initialize'), 1);
  // The URL and reference are never part of the order JSON.
  const listed = JSON.stringify(await w.orders.list());
  assert(!listed.includes('checkout.paystack.test'));
});

Deno.test('pay: orders that cannot be paid online, unknown orders and a missing email', async () => {
  const w = await paystackWorld();
  const whatsapp = await placeOnline(w, { paymentMethod: 'whatsapp' });
  assertEquals(whatsapp.status, 'pending');
  let r = await pay(w.app, whatsapp.id);
  assertEquals([r.status, await r.json()], [409, { error: 'This order can no longer be paid online', status: 'pending' }]);

  const paid = await startedOrder(w);
  assertEquals((await w.orders.setStatus(paid.id, 'paid')).ok, true);
  r = await pay(w.app, paid.id);
  assertEquals([r.status, (await r.json()).status], [409, 'paid']);

  const expired = await startedOrder(w);
  assertEquals((await w.orders.setStatus(expired.id, 'expired')).ok, true);
  r = await pay(w.app, expired.id);
  assertEquals([r.status, (await r.json()).status], [409, 'expired']);

  const cancelled = await placeOnline(w);
  await w.orders.cancel(cancelled.id);
  assertEquals((await pay(w.app, cancelled.id)).status, 409);

  assertEquals((await pay(w.app, crypto.randomUUID())).status, 404);
  assertEquals((await pay(w.app, 'not-a-uuid')).status, 404);

  // An online order with no email (it cannot be placed that way; reach it by hand).
  const noEmail = await placeOnline(w);
  w.orders.patch(noEmail.id, { customer: { name: 'A', phone: '1' } });
  const callsBefore = w.stub.calls.length;
  assertEquals((await pay(w.app, noEmail.id)).status, 400);
  assertEquals(w.stub.calls.length, callsBefore);
});

Deno.test('pay: a provider failure gives 502, no URL is stored, the key is nowhere, and a retry works', async () => {
  const w = await paystackWorld();
  const o = await placeOnline(w);
  w.stub.initialize = () => Response.json({ status: false, message: `Invalid key ${SECRET}` }, { status: 401 });
  const { result: r, logged } = await quietly(() => pay(w.app, o.id));
  assertEquals(r.status, 502);
  const text = await r.text();
  assertEquals(JSON.parse(text), { error: 'Could not start payment' });
  assert(!text.includes(SECRET) && !logged.includes(SECRET), 'the key is in neither the response nor the log');
  assertEquals((await w.orders.paymentInfo(o.id))?.paymentUrl, null);

  // Network failure too.
  w.stub.initialize = () => new TypeError(`offline, Bearer ${SECRET}`);
  const net = await quietly(() => pay(w.app, o.id));
  assertEquals(net.result.status, 502);
  assert(!(await net.result.text()).includes(SECRET) && !net.logged.includes(SECRET));

  w.stub.initialize = null;
  assertEquals((await pay(w.app, o.id)).status, 200);
});

Deno.test('pay: two calls at once end with one stored URL, and both customers get it', async () => {
  let n = 0;
  const provider: PaymentProvider = {
    start: (i) => Promise.resolve({ redirectUrl: `https://pay.test/${i.reference}/${++n}` }),
    parseWebhook: () => Promise.resolve(null),
    verify: () => Promise.reject(new Error('unused')),
  };
  const w = await world(provider);
  const o = await placeOnline(w);
  const [a, b] = await Promise.all([pay(w.app, o.id), pay(w.app, o.id)]);
  assertEquals([a.status, b.status], [200, 200]);
  const urls = [(await a.json()).redirectUrl, (await b.json()).redirectUrl];
  assertEquals(urls[0], urls[1]);
  assertEquals((await w.orders.paymentInfo(o.id))?.paymentUrl, urls[0]);
});

// ---------------------------------------------------------------------------
// POST /payments/webhook: signatures
// ---------------------------------------------------------------------------
Deno.test('webhook: a correctly signed charge.success is verified with Paystack and marks the order paid', async () => {
  const w = await paystackWorld();
  const o = await startedOrder(w);
  assertEquals(await w.stock('shirt-1'), 4);
  w.stub.markPaid(o.id);
  const r = await deliver(w.app, charge(o.id));
  assertEquals([r.status, await r.json()], [200, { received: true }]);
  const stored = await w.order(o.id);
  assertEquals(stored.status, 'paid');
  assert(stored.paidAt);
  assertEquals(stored.paymentFlag, null);
  assertEquals(stored.expiresAt, null);
  assertEquals(await w.stock('shirt-1'), 4);
  // Verified the way Paystack documents it.
  const v = w.stub.calls.filter((c) => c.url.includes('/transaction/verify/'));
  assertEquals(v.length, 1);
  assertEquals([v[0].method, v[0].url], ['GET', `https://api.paystack.co/transaction/verify/${o.id}`]);
  assertEquals(v[0].headers.Authorization, `Bearer ${SECRET}`);
});

Deno.test('webhook: a wrong, missing or malformed signature gives 401, asks Paystack nothing and marks nothing', async () => {
  const w = await paystackWorld();
  const o = await startedOrder(w);
  w.stub.markPaid(o.id);
  const body = charge(o.id);
  const good = await sign(body);
  const other = await sign(body, 'a-different-secret');
  const flipped = (good[0] === '0' ? '1' : '0') + good.slice(1);
  const attempts: [string, string | null][] = [
    ['signed with another secret', other],
    ['one hex digit changed', flipped],
    ['no header', null],
    ['empty header', ''],
    ['odd length', good.slice(0, -1)],
    ['too short, valid hex', good.slice(0, 64)],
    ['too long', good + '00'],
    ['non-hex characters', 'zz' + good.slice(2)],
    ['0x prefix', '0x' + good.slice(2)],
    ['with a space inside', good.slice(0, 20) + ' ' + good.slice(20)],
    ['the secret itself', SECRET],
    ['base64 of the digest', btoa(good)],
  ];
  for (const [label, sig] of attempts) {
    const r = await deliver(w.app, body, sig);
    assertEquals(r.status, 401, label);
    assertEquals(await r.json(), { error: 'Invalid signature' }, label);
  }
  assert(isUntouched(await w.order(o.id)));
  assertEquals(w.stub.count('/transaction/verify/'), 0, 'Paystack was not asked about any of them');

  // Control: the same body with the right signature does pass.
  assertEquals((await deliver(w.app, body, good)).status, 200);
  assertEquals((await w.order(o.id)).status, 'paid');
});

Deno.test('webhook: a body altered after signing gives 401', async () => {
  const w = await paystackWorld();
  const a = await startedOrder(w);
  const b = await startedOrder(w);
  w.stub.markPaid(a.id);
  w.stub.markPaid(b.id);
  const signedForA = await sign(charge(a.id));
  // The attacker swaps in another order's reference, or adds a character.
  assertEquals((await deliver(w.app, charge(b.id), signedForA)).status, 401);
  assertEquals((await deliver(w.app, charge(a.id) + ' ', signedForA)).status, 401);
  assertEquals((await deliver(w.app, charge(a.id, { amount: 1 }), signedForA)).status, 401);
  assert(isUntouched(await w.order(a.id)) && isUntouched(await w.order(b.id)));
  assertEquals(w.stub.count('/transaction/verify/'), 0);
});

Deno.test('webhook: the raw bytes are hashed, not a re-serialisation of the JSON', async () => {
  const w = await paystackWorld();
  const a = await startedOrder(w);
  const b = await startedOrder(w);
  w.stub.markPaid(a.id);
  w.stub.markPaid(b.id);

  // Signed over the compact JSON, delivered re-serialised with indentation and the keys in another order:
  // the same data, different bytes.
  const compact = charge(a.id);
  const parsed = JSON.parse(compact);
  const pretty = JSON.stringify({ data: parsed.data, event: parsed.event }, null, 2);
  assertEquals(JSON.parse(pretty), { data: parsed.data, event: parsed.event });
  assertNotEquals(pretty, compact);
  assertEquals((await deliver(w.app, pretty, await sign(compact))).status, 401);
  assert(isUntouched(await w.order(a.id)));

  // Signed over exactly the bytes sent (odd spacing and all), it passes.
  const odd = `{ "event" :"charge.success",\n\t"data":{"reference":"${b.id}"  ,"status":"success"} }\n`;
  assertEquals((await deliver(w.app, odd, await sign(odd))).status, 200);
  assertEquals((await w.order(b.id)).status, 'paid');
  // Non-ASCII bytes are hashed as UTF-8.
  const c = await startedOrder(w);
  w.stub.markPaid(c.id);
  const accented = charge(c.id, { customer: { first_name: 'Zoë ✓' } });
  assertEquals((await deliver(w.app, accented, await sign(accented))).status, 200);
});

Deno.test('webhook: events that are not a successful charge are acknowledged and ignored', async () => {
  const w = await paystackWorld();
  const o = await startedOrder(w);
  w.stub.markPaid(o.id);
  const bodies = [
    JSON.stringify({ event: 'charge.failed', data: { reference: o.id } }),
    JSON.stringify({ event: 'transfer.success', data: { reference: o.id } }),
    JSON.stringify({ event: 'charge.success', data: {} }),
    JSON.stringify({ event: 'charge.success', data: { reference: 42 } }),
    JSON.stringify({ event: 'charge.success' }),
    JSON.stringify([1, 2]),
    'not json at all',
    '',
  ];
  for (const body of bodies) {
    const r = await deliver(w.app, body);
    assertEquals([r.status, await r.json()], [200, { received: true }], body);
  }
  assert(isUntouched(await w.order(o.id)));
  assertEquals(w.stub.count('/transaction/verify/'), 0);
});

// ---------------------------------------------------------------------------
// POST /payments/webhook: verification is what counts
// ---------------------------------------------------------------------------
Deno.test('webhook: a signed event does nothing unless Paystack says the transaction succeeded', async () => {
  const w = await paystackWorld();
  const o = await startedOrder(w);
  // Not paid on Paystack's side ('abandoned'), though the (signed) body claims success.
  let r = await deliver(w.app, charge(o.id, { status: 'success', amount: 10050, currency: 'ZAR' }));
  assertEquals([r.status, await r.json()], [200, { received: true }]);
  assert(isUntouched(await w.order(o.id)));
  assertEquals(w.stub.count('/transaction/verify/'), 1);
  for (const status of ['failed', 'reversed', 'ongoing']) {
    w.stub.verify = (ref) => Response.json({ status: true, data: { status, reference: ref, amount: 10050, currency: 'ZAR' } });
    assertEquals((await deliver(w.app, charge(o.id))).status, 200);
    assert(isUntouched(await w.order(o.id)), status);
  }
  // A reference no order has: acknowledged, nothing to mark.
  const ghost = 'ghost-ref';
  w.stub.verify = (ref) => Response.json({ status: true, data: { status: 'success', reference: ref, amount: 10050, currency: 'ZAR' } });
  const gone = await quietly(() => deliver(w.app, charge(ghost)));
  assertEquals(gone.result.status, 200);
  assert(gone.logged.includes('not_found') && gone.logged.includes(ghost));
  r = await deliver(w.app, charge(o.id));
  assertEquals((await w.order(o.id)).status, 'paid');
});

Deno.test('webhook: a verified amount or currency that differs from the order is flagged and not paid', async () => {
  const cases: [string, number, string][] = [
    ['one cent short', 10049, 'ZAR'],
    ['one cent over', 10051, 'ZAR'],
    ['half', 5025, 'ZAR'],
    ['rand instead of cents', 100, 'ZAR'],
    ['other currency, same number', 10050, 'USD'],
    ['currency in the wrong case', 10050, 'zar'],
  ];
  for (const [label, amount, currency] of cases) {
    const w = await paystackWorld();
    const o = await startedOrder(w);
    w.stub.verify = (ref) => Response.json({ status: true, data: { status: 'success', reference: ref, amount, currency } });
    const stockBefore = await w.stock('shirt-1');
    const { result: r, logged } = await quietly(() => deliver(w.app, charge(o.id, { amount: 10050, currency: 'ZAR' })));
    assertEquals(r.status, 200, label);
    const stored = await w.order(o.id);
    assertEquals([stored.status, stored.paymentFlag, stored.paidAt], ['awaiting_payment', 'amount_mismatch', null], label);
    assertEquals(await w.stock('shirt-1'), stockBefore, label);
    assert(logged.includes('amount_mismatch') && logged.includes(o.id), label);
  }
});

Deno.test('webhook: the amount and currency in the webhook body are never used', async () => {
  const w = await paystackWorld();
  // The body lies low (1 USD), Paystack says the right figures: paid.
  const honest = await startedOrder(w);
  w.stub.markPaid(honest.id);
  assertEquals((await deliver(w.app, charge(honest.id, { amount: 1, currency: 'USD' }))).status, 200);
  assertEquals((await w.order(honest.id)).status, 'paid');
  // The body looks right, Paystack says a different amount: flagged.
  const liar = await startedOrder(w);
  w.stub.markPaid(liar.id);
  w.stub.verify = (ref) => Response.json({ status: true, data: { status: 'success', reference: ref, amount: 5000, currency: 'ZAR' } });
  assertEquals((await deliver(w.app, charge(liar.id, { amount: 10050, currency: 'ZAR' }))).status, 200);
  const stored = await w.order(liar.id);
  assertEquals([stored.status, stored.paymentFlag], ['awaiting_payment', 'amount_mismatch']);
});

Deno.test('webhook: when verification fails the answer is 502, nothing is marked, and a retry succeeds', async () => {
  const w = await paystackWorld();
  const o = await startedOrder(w);
  w.stub.markPaid(o.id);
  const failures: [string, () => Response | Error][] = [
    ['network error', () => new TypeError(`offline Bearer ${SECRET}`)],
    ['http 500', () => Response.json({ status: false, message: `server error ${SECRET}` }, { status: 500 })],
    ['status false', () => Response.json({ status: false, message: 'Transaction reference not found' })],
    ['not json', () => new Response('oops', { status: 200 })],
    ['unreadable amount', () => Response.json({ status: true, data: { status: 'success', reference: o.id, amount: 'x', currency: 'ZAR' } })],
  ];
  for (const [label, answer] of failures) {
    w.stub.verify = answer;
    const { result: r, logged } = await quietly(() => deliver(w.app, charge(o.id)));
    assertEquals(r.status, 502, label);
    const text = await r.text();
    assert(!text.includes(SECRET) && !logged.includes(SECRET), `${label}: the key stays out of the response and the log`);
    assert(isUntouched(await w.order(o.id)), label);
  }
  w.stub.verify = null;
  assertEquals((await deliver(w.app, charge(o.id))).status, 200);
  assertEquals((await w.order(o.id)).status, 'paid');
});

Deno.test('webhook: a store error gives 500 and marks nothing', async () => {
  const w = await paystackWorld();
  const o = await startedOrder(w);
  w.stub.markPaid(o.id);
  const app = createApp({ ...w.deps, orders: { ...w.orders, recordPayment: () => Promise.reject(new Error('db down')) } });
  const { result: r } = await quietly(() => deliver(app, charge(o.id)));
  assertEquals(r.status, 500);
  assert(isUntouched(await w.order(o.id)));
});

// ---------------------------------------------------------------------------
// Repeats and late payments
// ---------------------------------------------------------------------------
Deno.test('webhook: a repeated delivery changes nothing, not paid_at, not stock, not later statuses', async () => {
  const w = await paystackWorld();
  const o = await startedOrder(w);
  w.stub.markPaid(o.id);
  assertEquals((await deliver(w.app, charge(o.id))).status, 200);
  const first = await w.order(o.id);
  const stock = await w.stock('shirt-1');
  assertEquals(first.status, 'paid');
  assert(first.paidAt);
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 3));
    assertEquals((await deliver(w.app, charge(o.id))).status, 200);
    assertEquals(await w.order(o.id), first);
    assertEquals(await w.stock('shirt-1'), stock);
  }
  // Once the order has moved on, a repeat does not drag it back.
  await w.orders.setStatus(o.id, 'packed');
  assertEquals((await deliver(w.app, charge(o.id))).status, 200);
  assertEquals((await w.order(o.id)).status, 'packed');
  assertEquals((await w.order(o.id)).paidAt, first.paidAt);
  // Two deliveries racing each other pay once.
  const race = await startedOrder(w);
  w.stub.markPaid(race.id);
  const stockBefore = await w.stock('shirt-1');
  const rs = await Promise.all([deliver(w.app, charge(race.id)), deliver(w.app, charge(race.id))]);
  assertEquals(rs.map((r) => r.status), [200, 200]);
  assertEquals((await w.order(race.id)).status, 'paid');
  assertEquals(await w.stock('shirt-1'), stockBefore);
});

Deno.test('late payment: an expired or cancelled order whose stock is still there is retaken and paid', async () => {
  for (const how of ['expired', 'cancelled'] as const) {
    const w = await paystackWorld();
    const o = await startedOrder(w, { items: [{ productId: 'shirt-1', size: 'M', color: 'Black', quantity: 2 }] });
    assertEquals(await w.stock('shirt-1'), 3);
    if (how === 'expired') assert((await w.orders.setStatus(o.id, 'expired')).ok);
    else await w.orders.cancel(o.id);
    assertEquals((await w.order(o.id)).status, how);
    assertEquals(await w.stock('shirt-1'), 5, 'the stock went back');

    w.stub.markPaid(o.id);
    assertEquals((await deliver(w.app, charge(o.id))).status, 200);
    const stored = await w.order(o.id);
    assertEquals([stored.status, stored.paymentFlag, stored.expiresAt], ['paid', null, null], how);
    assert(stored.paidAt, how);
    assertEquals(await w.stock('shirt-1'), 3, `${how}: the stock was taken again`);

    // Repeats do nothing.
    assertEquals((await deliver(w.app, charge(o.id))).status, 200);
    assertEquals(await w.order(o.id), stored);
    assertEquals(await w.stock('shirt-1'), 3);
  }
});

Deno.test('late payment: stock gone or product deleted leaves stock and status alone and flags a refund', async () => {
  const setups: [string, (w: World & { stub: Stub }) => Promise<void>][] = [
    ['stock taken by another order', async (w) => {
      assertEquals((await postOrder(w.app, {
        id: crypto.randomUUID(),
        items: [{ productId: 'shirt-1', size: 'M', color: 'Black', quantity: 5 }],
        customer: { name: 'B', phone: '0821234567' },
      })).status, 201);
    }],
    ['product deleted', async (w) => {
      assert(await w.products.remove('shirt-1'));
    }],
  ];
  for (const [label, disturb] of setups) {
    const w = await paystackWorld();
    const o = await startedOrder(w, { items: [{ productId: 'shirt-1', size: 'M', color: 'Black', quantity: 2 }] });
    assert((await w.orders.setStatus(o.id, 'expired')).ok);
    await disturb(w);
    const others = await Promise.all(['shirt-2', '1'].map(w.stock));
    const stockNow = (await w.products.get('shirt-1'))?.stock;

    w.stub.markPaid(o.id);
    assertEquals((await deliver(w.app, charge(o.id))).status, 200, label);
    const stored = await w.order(o.id);
    assertEquals([stored.status, stored.paymentFlag], ['expired', 'refund_due'], label);
    assert(stored.paidAt, `${label}: paid_at is set`);
    assertEquals((await w.products.get('shirt-1'))?.stock, stockNow, `${label}: stock is unchanged`);
    assertEquals(await Promise.all(['shirt-2', '1'].map(w.stock)), others, label);

    // A repeat changes nothing.
    assertEquals((await deliver(w.app, charge(o.id))).status, 200, label);
    assertEquals(await w.order(o.id), stored, label);
    assertEquals((await w.products.get('shirt-1'))?.stock, stockNow, label);
  }
});

Deno.test('late payment: every line must be served or none is taken', async () => {
  const w = await paystackWorld();
  const o = await startedOrder(w, {
    items: [
      { productId: 'shirt-1', size: 'M', color: 'Black', quantity: 1 },
      { productId: 'shirt-2', size: 'M', color: 'Black', quantity: 2 },
    ],
  });
  assert((await w.orders.setStatus(o.id, 'expired')).ok);
  // Someone else takes all of shirt-2 (stock 5); shirt-1 is untouched.
  assertEquals((await postOrder(w.app, {
    id: crypto.randomUUID(),
    items: [{ productId: 'shirt-2', size: 'M', color: 'Black', quantity: 5 }],
    customer: { name: 'B', phone: '0821234567' },
  })).status, 201);
  w.stub.markPaid(o.id);
  assertEquals((await deliver(w.app, charge(o.id))).status, 200);
  const stored = await w.order(o.id);
  assertEquals([stored.status, stored.paymentFlag], ['expired', 'refund_due']);
  assertEquals([await w.stock('shirt-1'), await w.stock('shirt-2')], [5, 0]);
});

Deno.test('late payment: two lines on one variant need the sum of their quantities', async () => {
  const w = await paystackWorld();
  const lines = [
    { productId: 'shirt-1', size: 'M', color: 'Black', quantity: 3 },
    { productId: 'shirt-1', size: 'M', color: 'Black', quantity: 2 },
  ];
  const o = await startedOrder(w, { items: lines }); // all 5
  assert((await w.orders.setStatus(o.id, 'expired')).ok);
  assertEquals(await w.stock('shirt-1'), 5);
  // Another customer takes 1: 4 left, and the order needs 3 + 2 = 5 even though each line alone fits.
  assertEquals((await postOrder(w.app, {
    id: crypto.randomUUID(),
    items: [{ productId: 'shirt-1', size: 'M', color: 'Black', quantity: 1 }],
    customer: { name: 'B', phone: '0821234567' },
  })).status, 201);
  w.stub.markPaid(o.id);
  assertEquals((await deliver(w.app, charge(o.id))).status, 200);
  assertEquals([(await w.order(o.id)).status, (await w.order(o.id)).paymentFlag], ['expired', 'refund_due']);
  assertEquals(await w.stock('shirt-1'), 4);
});

Deno.test('webhook: a mismatch flag is cleared when a later verification shows the right amount', async () => {
  const w = await paystackWorld();
  const o = await startedOrder(w);
  w.stub.verify = (ref) => Response.json({ status: true, data: { status: 'success', reference: ref, amount: 1, currency: 'ZAR' } });
  assertEquals((await quietly(() => deliver(w.app, charge(o.id)))).result.status, 200);
  assertEquals((await w.order(o.id)).paymentFlag, 'amount_mismatch');
  w.stub.verify = null;
  w.stub.markPaid(o.id);
  assertEquals((await deliver(w.app, charge(o.id))).status, 200);
  const stored = await w.order(o.id);
  assertEquals([stored.status, stored.paymentFlag], ['paid', null]);
});
