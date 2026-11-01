import { assert, assertEquals } from '@std/assert';
import { clientIp, createApp, toPublicOrder } from './app.ts';
import {
  createLock,
  createMemoryDb,
  createMemoryDeps,
  memoryCustomers,
  memoryCategories,
  memoryDeliveryOptions,
  memoryCommunity,
  memoryListSends,
  memoryRestock,
  memoryEvents,
  memoryOrders,
  memoryProducts,
  ORDER_TRANSITIONS,
} from './dev.ts';
import { createFakeProvider } from './fake_payments.ts';
import { createFakeMailer, type Mailer } from './mailer.ts';
import type { PaymentProvider } from './payments.ts';
import { seedCatalogue } from './seed.ts';
import type { Category, Deps, Order, OrderStatus, Product } from './types.ts';

const P = '/make-server-fbb8f0e1';
const ADMIN = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };

const isAdmin: Deps['isAdmin'] = (h) =>
  Promise.resolve(h === 'Bearer admin' ? 'ok' : h === 'Bearer user' ? 'forbidden' : 'unauthenticated');

// In-memory stores seeded with the five sample categories and products (dev.ts and tests only).
// No payment provider unless one is passed: online payment is then off, like a deploy without the key.
async function setup(payments: PaymentProvider | null = null) {
  const deps = await createMemoryDeps(isAdmin, true, payments);
  return createApp({ ...deps, uploadImage: () => Promise.resolve('https://example.com/img.png') });
}
type App = Awaited<ReturnType<typeof setup>>;

const validBody = {
  name: 'Hoodie',
  category: 'pants',
  price: 60,
  images: ['https://example.com/a.jpg', ''],
  sizes: ['M'],
  colors: ['Black'],
  stock: 5,
  id: 'hacked',
  extra: 'ignored',
};

const post = (app: App, body: unknown, headers: Record<string, string> = ADMIN) =>
  app.request(`${P}/products`, { method: 'POST', headers, body: JSON.stringify(body) });

Deno.test('health', async () => {
  const r = await (await setup()).request(`${P}/health`);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { status: 'ok' });
});

Deno.test('cors preflight allows apikey', async () => {
  const r = await (await setup()).request(`${P}/products`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'apikey,authorization',
    },
  });
  assertEquals(r.status, 204);
  const allow = (r.headers.get('access-control-allow-headers') ?? '').toLowerCase();
  assert(allow.includes('apikey'));
  assert(allow.includes('authorization'));
});

Deno.test('list seeds once', async () => {
  const app = await setup();
  const a = (await (await app.request(`${P}/products`)).json()) as Product[];
  assertEquals(a.length, 5);
  assertEquals(a.map((p) => p.id), ['1', '2', '3', '4', '5']);
  const b = (await (await app.request(`${P}/products`)).json()) as Product[];
  assertEquals(b.length, 5);
});

Deno.test('get product 200 and 404', async () => {
  const app = await setup();
  await app.request(`${P}/products`);
  const ok = await app.request(`${P}/products/2`);
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).name, 'Premium Sports Jersey');
  const nf = await app.request(`${P}/products/nope`);
  assertEquals(nf.status, 404);
  assert((await nf.json()).error);
});

Deno.test('create auth', async () => {
  const app = await setup();
  assertEquals((await post(app, validBody, { 'Content-Type': 'application/json' })).status, 401);
  assertEquals(
    (await post(app, validBody, { Authorization: 'Bearer user', 'Content-Type': 'application/json' })).status,
    403,
  );
});

Deno.test('create validation', async () => {
  const app = await setup();
  assertEquals((await post(app, { ...validBody, price: -1 })).status, 400);
  assertEquals((await post(app, { ...validBody, price: 'x' })).status, 400);
  assertEquals((await post(app, { ...validBody, images: ['data:image/png;base64,AAAA'] })).status, 400);
  const { name: _n, ...noName } = validBody;
  assertEquals((await post(app, noName)).status, 400);
  const bad = await app.request(`${P}/products`, { method: 'POST', headers: ADMIN, body: '{nope' });
  assertEquals(bad.status, 400);
});

Deno.test('create valid derives image', async () => {
  const app = await setup();
  const r = await post(app, validBody);
  assertEquals(r.status, 201);
  const p = (await r.json()) as Product;
  assertEquals(p.image, 'https://example.com/a.jpg');
  assertEquals(p.description, '');
  assert(p.id !== 'hacked');
  assert(!('extra' in p));
  assert(p.createdAt);
  assertEquals((await app.request(`${P}/products/${p.id}`)).status, 200);
});

Deno.test('update', async () => {
  const app = await setup();
  const created = (await (await post(app, validBody)).json()) as Product;
  const r = await app.request(`${P}/products/${created.id}`, {
    method: 'PUT',
    headers: ADMIN,
    body: JSON.stringify({ price: 70, images: ['https://example.com/b.jpg'], id: 'zzz', createdAt: 'x' }),
  });
  assertEquals(r.status, 200);
  const u = (await r.json()) as Product;
  assertEquals(u.id, created.id);
  assertEquals(u.createdAt, created.createdAt);
  assertEquals(u.price, 70);
  assertEquals(u.image, 'https://example.com/b.jpg');
  assertEquals(u.name, 'Hoodie');
  const nf = await app.request(`${P}/products/missing`, {
    method: 'PUT',
    headers: ADMIN,
    body: JSON.stringify({ price: 1 }),
  });
  assertEquals(nf.status, 404);
});

Deno.test('delete', async () => {
  const app = await setup();
  const created = (await (await post(app, validBody)).json()) as Product;
  const del = () => app.request(`${P}/products/${created.id}`, { method: 'DELETE', headers: ADMIN });
  assertEquals((await del()).status, 204);
  assertEquals((await del()).status, 404);
});

function upload(app: App, file?: File) {
  const fd = new FormData();
  if (file) fd.set('file', file);
  return app.request(`${P}/images`, { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: fd });
}

Deno.test('images', async () => {
  const app = await setup();
  assertEquals((await upload(app)).status, 400);
  assertEquals((await upload(app, new File(['hi'], 'a.txt', { type: 'text/plain' }))).status, 400);
  const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
  assertEquals((await upload(app, big)).status, 400);
  const ok = await upload(app, new File([new Uint8Array(10)], 'a.png', { type: 'image/png' }));
  assertEquals(ok.status, 201);
  assertEquals(await ok.json(), { url: 'https://example.com/img.png' });
});

Deno.test('images require admin', async () => {
  const fd = new FormData();
  fd.set('file', new File(['x'], 'a.png', { type: 'image/png' }));
  const r = await (await setup()).request(`${P}/images`, { method: 'POST', body: fd });
  assertEquals(r.status, 401);
});

Deno.test('cart quote', async () => {
  const app = await setup();
  await app.request(`${P}/products`);
  const q = (body: unknown) =>
    app.request(`${P}/cart/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const r = await q({
    items: [
      { productId: '1', size: 'M', color: 'Black', quantity: 2, price: 0.01 },
      { productId: 'ghost', quantity: 1 },
      { productId: '5', quantity: 1 },
    ],
  });
  assertEquals(r.status, 200);
  const quote = await r.json();
  assertEquals(quote.missing, ['ghost']);
  assertEquals(quote.lines.length, 2);
  assertEquals(quote.lines[0].price, 25);
  assertEquals(quote.lines[0].subtotal, 50);
  // `available` is the stock of the matched variant (M / Black), not of the whole product.
  assertEquals(quote.lines[0].available, 3);
  assertEquals((await (await app.request(`${P}/products/1`)).json()).stock, 50);
  assertEquals(quote.lines[0].size, 'M');
  assertEquals(quote.total, 70);
  assertEquals((await q({ items: [{ productId: '1', quantity: 0 }] })).status, 400);
  assertEquals((await q({ items: [{ productId: '1', quantity: 1.5 }] })).status, 400);
  assertEquals((await q({ items: [] })).status, 400);
});

Deno.test('internal errors give 500', async () => {
  const base = await createMemoryDeps(isAdmin);
  const deps: Deps = {
    ...base,
    products: { ...base.products, get: () => Promise.reject(new Error('boom')) },
    isAdmin: () => Promise.resolve('ok'),
    uploadImage: () => Promise.resolve(''),
  };
  const orig = console.error;
  console.error = () => {};
  const r = await createApp(deps).request(`${P}/products/1`);
  console.error = orig;
  assertEquals(r.status, 500);
  assertEquals(await r.json(), { error: 'Internal error' });
});

Deno.test('image derived from first non-empty entry', async () => {
  const app = await setup();
  const url = 'https://example.com/side.jpg';
  const p = (await (await post(app, { ...validBody, images: ['', url, ''] })).json()) as Product;
  assertEquals(p.image, url);
  const u = await app.request(`${P}/products/${p.id}`, {
    method: 'PUT',
    headers: ADMIN,
    body: JSON.stringify({ images: ['', '', 'https://example.com/c.jpg'] }),
  });
  assertEquals(((await u.json()) as Product).image, 'https://example.com/c.jpg');
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
const JSON_H = { 'Content-Type': 'application/json' };
const customer = { name: '  Thandi M  ', phone: '+27 82 123 4567', note: '  Leave at gate  ' };

const placeOrder = (app: App, body: unknown) =>
  app.request(`${P}/orders`, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) });

const stockOf = async (app: App, id: string) =>
  ((await (await app.request(`${P}/products/${id}`)).json()) as Product).stock;

const newProduct = async (app: App, stock: number) =>
  ((await (await post(app, { ...validBody, stock })).json()) as Product);

Deno.test('order: placed with server prices and decrements stock', async () => {
  const app = await setup();
  await app.request(`${P}/products`); // seed
  const id = '3f2a9c1b-0000-4000-8000-000000000001';
  const r = await placeOrder(app, {
    id,
    items: [
      { productId: '1', size: 'M', color: 'Black', quantity: 2, price: 0.01, name: 'hacked' },
      { productId: '5', quantity: 1 },
    ],
    customer: { ...customer, extra: 'dropped' },
  });
  assertEquals(r.status, 201);
  const o = (await r.json()) as Order;
  assertEquals(o.id, id);
  assertEquals(o.ref, '3F2A9C1B');
  assertEquals(o.status, 'pending');
  assert(o.createdAt);
  assertEquals(o.lines.length, 2);
  assertEquals(o.lines[0].price, 25);
  assertEquals(o.lines[0].subtotal, 50);
  assertEquals(o.lines[0].size, 'M');
  assertEquals(o.lines[0].color, 'Black');
  assert(o.lines[0].name !== 'hacked');
  assertEquals(o.total, 70);
  assertEquals(o.customer, { name: 'Thandi M', phone: '+27 82 123 4567', note: 'Leave at gate' });
  assertEquals(await stockOf(app, '1'), 48);
  assertEquals(await stockOf(app, '5'), 59);
});

Deno.test('order: over-stock across size lines gives 409 and changes nothing', async () => {
  const app = await setup();
  const p = await newProduct(app, 5);
  const r = await placeOrder(app, {
    id: crypto.randomUUID(),
    items: [
      { productId: p.id, size: 'M', quantity: 3 },
      { productId: p.id, size: 'M', quantity: 3 },
    ],
    customer,
  });
  assertEquals(r.status, 409);
  const body = await r.json();
  assertEquals(body.error, 'Insufficient stock');
  assertEquals(body.short, [{ productId: p.id, name: 'Hoodie', size: 'M', color: 'Black', requested: 6, available: 5 }]);
  assertEquals(await stockOf(app, p.id), 5);
});

Deno.test('order: unknown product gives 400 with missing', async () => {
  const app = await setup();
  const p = await newProduct(app, 5);
  const r = await placeOrder(app, {
    id: crypto.randomUUID(),
    items: [{ productId: p.id, quantity: 1 }, { productId: 'ghost', quantity: 1 }],
    customer,
  });
  assertEquals(r.status, 400);
  const body = await r.json();
  assertEquals(body.error, 'Unknown products');
  assertEquals(body.missing, ['ghost']);
  assertEquals(await stockOf(app, p.id), 5);
});

Deno.test('order: replay with same id returns 200 and decrements once', async () => {
  const app = await setup();
  const p = await newProduct(app, 5);
  const body = { id: crypto.randomUUID(), items: [{ productId: p.id, quantity: 2 }], customer };
  const first = await placeOrder(app, body);
  assertEquals(first.status, 201);
  const firstOrder = await first.json();
  const second = await placeOrder(app, body);
  assertEquals(second.status, 200);
  assertEquals(await second.json(), firstOrder);
  // Even with different items, the existing order wins and stock is untouched.
  const third = await placeOrder(app, { ...body, items: [{ productId: p.id, quantity: 1 }] });
  assertEquals(third.status, 200);
  assertEquals(await third.json(), firstOrder);
  assertEquals(await stockOf(app, p.id), 3);
});

Deno.test('order: concurrent orders cannot oversell the last item', async () => {
  const app = await setup();
  const p = await newProduct(app, 1);
  const mk = () => placeOrder(app, { id: crypto.randomUUID(), items: [{ productId: p.id, quantity: 1 }], customer });
  const results = await Promise.all([mk(), mk()]);
  assertEquals(results.map((r) => r.status).sort(), [201, 409]);
  assertEquals(await stockOf(app, p.id), 0);
});

Deno.test('order: validation', async () => {
  const app = await setup();
  const p = await newProduct(app, 100);
  const good = { id: crypto.randomUUID(), items: [{ productId: p.id, quantity: 1 }], customer };
  assertEquals((await placeOrder(app, { ...good, customer: { ...customer, phone: 'abc' } })).status, 400);
  assertEquals((await placeOrder(app, { ...good, customer: { ...customer, phone: '+-+-+-+-' } })).status, 400);
  assertEquals((await placeOrder(app, { ...good, customer: { ...customer, phone: '12345' } })).status, 400);
  assertEquals((await placeOrder(app, { ...good, customer: { ...customer, name: '   ' } })).status, 400);
  assertEquals((await placeOrder(app, { ...good, items: [] })).status, 400);
  assertEquals((await placeOrder(app, { ...good, items: [{ productId: p.id, quantity: 51 }] })).status, 400);
  assertEquals((await placeOrder(app, { ...good, items: [{ productId: p.id, quantity: 1.5 }] })).status, 400);
  assertEquals((await placeOrder(app, { ...good, id: 'not-a-uuid' })).status, 400);
  assertEquals((await placeOrder(app, { ...good, items: [{ productId: 'x'.repeat(65), quantity: 1 }] })).status, 400);
  assertEquals(
    (await placeOrder(app, { ...good, items: [{ productId: p.id, size: 'x'.repeat(41), quantity: 1 }] })).status,
    400,
  );
  assertEquals(
    (await placeOrder(app, { ...good, items: [{ productId: p.id, color: 'x'.repeat(41), quantity: 1 }] })).status,
    400,
  );
  const malformed = await app.request(`${P}/orders`, { method: 'POST', headers: JSON_H, body: '{nope' });
  assertEquals(malformed.status, 400);
  assertEquals(await stockOf(app, p.id), 100);
  // Empty note is dropped.
  const ok = await placeOrder(app, { ...good, customer: { ...customer, note: '   ' } });
  assertEquals(ok.status, 201);
  assert(!('note' in ((await ok.json()) as Order).customer));
});

Deno.test('orders: list and cancel require admin', async () => {
  const app = await setup();
  const id = crypto.randomUUID();
  const none = { 'Content-Type': 'application/json' };
  const user = { Authorization: 'Bearer user' };
  assertEquals((await app.request(`${P}/orders`, { headers: none })).status, 401);
  assertEquals((await app.request(`${P}/orders`, { headers: user })).status, 403);
  assertEquals((await app.request(`${P}/orders/${id}/cancel`, { method: 'POST', headers: none })).status, 401);
  assertEquals((await app.request(`${P}/orders/${id}/cancel`, { method: 'POST', headers: user })).status, 403);
});

Deno.test('orders: admin lists newest first, cancel restores stock once', async () => {
  const app = await setup();
  const p = await newProduct(app, 10);
  const mk = async (qty: number) => {
    const id = crypto.randomUUID();
    assertEquals((await placeOrder(app, { id, items: [{ productId: p.id, quantity: qty }], customer })).status, 201);
    await new Promise((r) => setTimeout(r, 5));
    return id;
  };
  const a = await mk(2);
  const b = await mk(3);
  assertEquals(await stockOf(app, p.id), 5);

  const list = (await (await app.request(`${P}/orders`, { headers: ADMIN })).json()) as Order[];
  assertEquals(list.map((o) => o.id), [b, a]);

  const cancel = (id: string) => app.request(`${P}/orders/${id}/cancel`, { method: 'POST', headers: ADMIN });
  const c1 = await cancel(b);
  assertEquals(c1.status, 200);
  assertEquals(((await c1.json()) as Order).status, 'cancelled');
  assertEquals(await stockOf(app, p.id), 8);
  const c2 = await cancel(b);
  assertEquals(c2.status, 200);
  assertEquals(((await c2.json()) as Order).status, 'cancelled');
  assertEquals(await stockOf(app, p.id), 8);

  const missing = await cancel(crypto.randomUUID());
  assertEquals(missing.status, 404);
  assertEquals(await missing.json(), { error: 'Order not found' });
  assertEquals((await cancel('not-a-uuid')).status, 404);
});

// ---------------------------------------------------------------------------
// Stock-safe product updates
// ---------------------------------------------------------------------------
const putProduct = (app: App, id: string, body: unknown) =>
  app.request(`${P}/products/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify(body) });

const orderOne = (app: App, productId: string, quantity: number) =>
  placeOrder(app, { id: crypto.randomUUID(), items: [{ productId, quantity }], customer });

Deno.test('update: price edit after an order keeps the decremented stock', async () => {
  const app = await setup();
  await app.request(`${P}/products`); // seed
  assertEquals((await orderOne(app, '1', 2)).status, 201);
  assertEquals(await stockOf(app, '1'), 48);
  const r = await putProduct(app, '1', { price: 30 });
  assertEquals(r.status, 200);
  const p = (await r.json()) as Product;
  assertEquals(p.price, 30);
  assertEquals(p.stock, 48);
});

Deno.test('update: expectedStock mismatch gives 409 and writes nothing', async () => {
  const app = await setup();
  await app.request(`${P}/products`);
  await orderOne(app, '1', 2);
  const before = (await (await app.request(`${P}/products/1`)).json()) as Product;
  const r = await putProduct(app, '1', { stock: 10, expectedStock: 50 });
  assertEquals(r.status, 409);
  assertEquals(await r.json(), { error: 'Stock changed', stock: 48 });
  assertEquals((await (await app.request(`${P}/products/1`)).json()) as Product, before);
});

Deno.test('update: expectedStock match sets stock', async () => {
  const app = await setup();
  await app.request(`${P}/products`);
  await orderOne(app, '1', 2);
  const r = await putProduct(app, '1', { stock: 10, expectedStock: 48 });
  assertEquals(r.status, 200);
  assertEquals(((await r.json()) as Product).stock, 10);
  assertEquals(await stockOf(app, '1'), 10);
});

Deno.test('update: explicit stock without expectedStock is still allowed', async () => {
  const app = await setup();
  await app.request(`${P}/products`);
  await orderOne(app, '1', 2);
  const r = await putProduct(app, '1', { stock: 10 });
  assertEquals(r.status, 200);
  assertEquals(await stockOf(app, '1'), 10);
});

Deno.test('update: invalid expectedStock gives 400', async () => {
  const app = await setup();
  await app.request(`${P}/products`);
  for (const bad of [-1, 'x', 1.5, null]) {
    const r = await putProduct(app, '1', { stock: 10, expectedStock: bad });
    assertEquals(r.status, 400);
    assertEquals(await r.json(), { error: 'expectedStock must be a whole number of 0 or more' });
  }
  assertEquals(await stockOf(app, '1'), 50);
});

Deno.test('update: concurrent order and edit lose neither change', async () => {
  const app = await setup();
  await app.request(`${P}/products`);
  const [o, u] = await Promise.all([orderOne(app, '1', 1), putProduct(app, '1', { name: 'Renamed' })]);
  assertEquals(o.status, 201);
  assertEquals(u.status, 200);
  const p = (await (await app.request(`${P}/products/1`)).json()) as Product;
  assertEquals(p.stock, 49);
  assertEquals(p.name, 'Renamed');
});

Deno.test('update: unknown id gives 404', async () => {
  const app = await setup();
  const r = await putProduct(app, 'missing', { price: 1, expectedStock: 3, stock: 2 });
  assertEquals(r.status, 404);
  assertEquals(await r.json(), { error: 'Product not found' });
});

// ---------------------------------------------------------------------------
// Catalogue: stock per variant, slugs, inactive products, categories
// ---------------------------------------------------------------------------
const NONE = { 'Content-Type': 'application/json' };
const USER = { Authorization: 'Bearer user', 'Content-Type': 'application/json' };

const quote = (app: App, items: unknown[]) =>
  app.request(`${P}/cart/quote`, { method: 'POST', headers: NONE, body: JSON.stringify({ items }) });

const getProduct = async (app: App, id: string, headers: Record<string, string> = NONE) =>
  (await (await app.request(`${P}/products/${id}`, { headers })).json()) as Product;

/** Sizes M and L, one colour. M / Black has 1 unit and L / Black has 5, so the total is 6. */
async function twoVariantProduct(app: App): Promise<Product> {
  const r = await post(app, {
    ...validBody,
    name: 'Two Sizes',
    sizes: ['M', 'L'],
    colors: ['Black'],
    stock: undefined,
    variants: [{ size: 'M', color: 'Black', stock: 1 }, { size: 'L', color: 'Black', stock: 5 }],
  });
  assertEquals(r.status, 201);
  return (await r.json()) as Product;
}

const sum = (p: Product) => p.variants.reduce((n, v) => n + v.stock, 0);
const variantOf = (p: Product, size: string, color: string) => {
  const v = p.variants.find((x) => x.size === size && x.color === color);
  assert(v, `variant ${size}/${color}`);
  return v;
};

Deno.test('catalogue: products carry slug, active and variants; stock is their sum', async () => {
  const app = await setup();
  const p = await getProduct(app, '1');
  assertEquals(p.slug, 'classic-cotton-t-shirt');
  assertEquals(p.active, true);
  assertEquals(p.variants.length, 20);
  assertEquals(p.stock, 50);
  assertEquals(sum(p), 50);
  assertEquals(p.variants.slice(0, 2).map((v) => [v.size, v.color]), [['S', 'Black'], ['S', 'White']]);
  assert(p.variants.every((v) => v.id && v.sku));
  // An even split: the remainder goes one unit each to the first variants.
  assertEquals(p.variants.map((v) => v.stock), [...Array(10).fill(3), ...Array(10).fill(2)]);
  const list = (await (await app.request(`${P}/products`)).json()) as Product[];
  assertEquals(list.map((x) => x.id), ['1', '2', '3', '4', '5']);
});

Deno.test('catalogue: create with variants gives each listed combination its stock and the others 0', async () => {
  const app = await setup();
  const r = await post(app, {
    ...validBody,
    sizes: ['M', 'L'],
    colors: ['Black', 'Red'],
    stock: undefined,
    variants: [{ size: 'L', color: 'Red', stock: 4 }, { size: 'M', color: 'Black', stock: 2 }],
  });
  assertEquals(r.status, 201);
  const p = (await r.json()) as Product;
  assertEquals(p.variants.map((v) => [v.size, v.color, v.stock]), [
    ['M', 'Black', 2],
    ['M', 'Red', 0],
    ['L', 'Black', 0],
    ['L', 'Red', 4],
  ]);
  assertEquals(p.stock, 6);
  // Without variants the stock is split evenly (5 over 1 variant here).
  assertEquals((await newProduct(app, 5)).variants.map((v) => v.stock), [5]);
});

Deno.test('catalogue: negative or non-integer variant stock is rejected', async () => {
  const app = await setup();
  for (const bad of [-1, 1.5, '3', null]) {
    const body = { ...validBody, stock: undefined, variants: [{ size: 'M', color: 'Black', stock: bad }] };
    assertEquals((await post(app, body)).status, 400);
  }
  const p = await newProduct(app, 5);
  const v = p.variants[0];
  for (const bad of [-1, 1.5, '3']) {
    assertEquals((await putProduct(app, p.id, { variants: [{ id: v.id, stock: bad }] })).status, 400);
    assertEquals((await putProduct(app, p.id, { variants: [{ id: v.id, stock: 1, expectedStock: bad }] })).status, 400);
  }
  assertEquals((await putProduct(app, p.id, { variants: [{ stock: 1 }] })).status, 400);
  assertEquals((await putProduct(app, p.id, { variants: 'x' })).status, 400);
  assertEquals((await putProduct(app, p.id, { active: 'no' })).status, 400);
  assertEquals((await getProduct(app, p.id)).stock, 5);
});

Deno.test('catalogue: a variant short while the product total is positive gives 409', async () => {
  const app = await setup();
  const p = await twoVariantProduct(app);
  assertEquals(p.stock, 6);
  const r = await placeOrder(app, {
    id: crypto.randomUUID(),
    items: [{ productId: p.id, size: 'M', color: 'Black', quantity: 2 }],
    customer,
  });
  assertEquals(r.status, 409);
  const body = await r.json();
  assertEquals(body.error, 'Insufficient stock');
  assertEquals(body.short, [{ productId: p.id, name: 'Two Sizes', size: 'M', color: 'Black', requested: 2, available: 1 }]);
  assertEquals((await getProduct(app, p.id)).stock, 6);
  // The same quantity on the other variant works.
  const ok = await placeOrder(app, {
    id: crypto.randomUUID(),
    items: [{ productId: p.id, size: 'L', color: 'Black', quantity: 2 }],
    customer,
  });
  assertEquals(ok.status, 201);
  const o = (await ok.json()) as Order;
  const l = variantOf(await getProduct(app, p.id), 'L', 'Black');
  assertEquals(l.stock, 3);
  assertEquals(o.lines[0].variantId, l.id);
  assertEquals(o.lines[0].sku, l.sku);
});

Deno.test('quote: available is the stock of the matched variant, with variantId and sku', async () => {
  const app = await setup();
  const p = await twoVariantProduct(app);
  const r = await quote(app, [
    { productId: p.id, size: 'M', color: 'Black', quantity: 1 },
    { productId: p.id, size: 'L', color: 'Black', quantity: 2 },
  ]);
  assertEquals(r.status, 200);
  const q = await r.json();
  assertEquals(q.missing, []);
  assertEquals(q.lines.map((l: { available: number }) => l.available), [1, 5]);
  const m = variantOf(p, 'M', 'Black');
  assertEquals(q.lines[0].variantId, m.id);
  assertEquals(q.lines[0].sku, m.sku);
  assertEquals(q.lines[0].size, 'M');
  assertEquals(q.total, 180);
  // After an order, available follows the variant's stock.
  await placeOrder(app, {
    id: crypto.randomUUID(),
    items: [{ productId: p.id, size: 'L', color: 'Black', quantity: 2 }],
    customer,
  });
  const after = await (await quote(app, [{ productId: p.id, size: 'L', color: 'Black', quantity: 1 }])).json();
  assertEquals(after.lines[0].available, 3);
});

Deno.test('quote: a missing size or colour matches any and picks the most stock; no match is missing', async () => {
  const app = await setup();
  const p = await twoVariantProduct(app);
  const avail = async (item: Record<string, unknown>) => {
    const q = await (await quote(app, [{ productId: p.id, quantity: 1, ...item }])).json();
    return q.lines.length ? q.lines[0].available : 'missing';
  };
  assertEquals(await avail({}), 5); // L / Black has the most
  assertEquals(await avail({ size: '' }), 5);
  assertEquals(await avail({ color: 'Black' }), 5);
  assertEquals(await avail({ size: 'M' }), 1);
  assertEquals(await avail({ size: 'XL' }), 'missing');
  assertEquals(await avail({ color: 'Pink' }), 'missing');
  // A tie goes to the first variant in size then colour order: seeded product 5 has 15 in each colour.
  const tie = await (await quote(app, [{ productId: '5', quantity: 1 }])).json();
  assertEquals(tie.lines[0].available, 15);
  assertEquals(tie.lines[0].variantId, (await getProduct(app, '5')).variants[0].id);
  // The order takes the same variant as the quote.
  const o = await (await placeOrder(app, {
    id: crypto.randomUUID(),
    items: [{ productId: p.id, quantity: 1 }],
    customer,
  })).json() as Order;
  assertEquals(o.lines[0].size, 'L');
  // A slug is not a product id for quotes and orders, and an inactive product is missing.
  const bySlug = await (await quote(app, [{ productId: p.slug, quantity: 1 }])).json();
  assertEquals(bySlug.missing, [p.slug]);
  await putProduct(app, p.id, { active: false });
  const inactive = await (await quote(app, [{ productId: p.id, quantity: 1 }])).json();
  assertEquals(inactive.missing, [p.id]);
  assertEquals(inactive.lines, []);
});

Deno.test('old-style client flow: GET product, order with no variant ids, PUT stock + expectedStock', async () => {
  const app = await setup();
  const first = await getProduct(app, '2');
  assertEquals(first.stock, 30);
  // An old order has only productId, size, colour and quantity.
  const o = await placeOrder(app, {
    id: crypto.randomUUID(),
    items: [{ productId: '2', size: 'M', color: 'Blue', quantity: 2 }, { productId: '2', quantity: 1 }],
    customer,
  });
  assertEquals(o.status, 201);
  assertEquals((await getProduct(app, '2')).stock, 27);
  // The admin form still holds the stock it loaded (30): stale.
  const stale = await putProduct(app, '2', { price: 46, stock: 40, expectedStock: 30 });
  assertEquals(stale.status, 409);
  assertEquals(await stale.json(), { error: 'Stock changed', stock: 27 });
  assertEquals((await getProduct(app, '2')).price, 45);
  // Reload, then save the new total.
  const ok = await putProduct(app, '2', { price: 46, stock: 40, expectedStock: 27 });
  assertEquals(ok.status, 200);
  const p = (await ok.json()) as Product;
  assertEquals(p.stock, 40);
  assertEquals(sum(p), 40);
  assertEquals(p.price, 46);
  const down = (await (await putProduct(app, '2', { stock: 7 })).json()) as Product;
  assertEquals(down.stock, 7);
  assertEquals(sum(down), 7);
  assertEquals((await getProduct(app, '2')).stock, 7);
});

Deno.test('catalogue: total-only edits spread an increase from the first variant and level a decrease down', async () => {
  const app = await setup();
  const p = await twoVariantProduct(app); // M 1, L 5
  const down = (await (await putProduct(app, p.id, { stock: 3 })).json()) as Product;
  assertEquals(down.variants.map((v) => v.stock), [1, 2]); // the highest variant gives up units
  const up = (await (await putProduct(app, p.id, { stock: 8 })).json()) as Product;
  assertEquals(up.variants.map((v) => v.stock), [4, 4]); // +5 over two variants: 2 each, the extra unit to the first
  assertEquals(up.stock, 8);
  const odd = (await (await putProduct(app, p.id, { stock: 11 })).json()) as Product;
  assertEquals(odd.variants.map((v) => v.stock), [6, 5]); // +3: 1 each, the extra unit to the first
});

Deno.test('catalogue: sizes and colours changes reconcile variants and keep the total', async () => {
  const app = await setup();
  const p = await twoVariantProduct(app); // M 1, L 5
  const dropped = (await (await putProduct(app, p.id, { sizes: ['M'] })).json()) as Product;
  assertEquals(dropped.variants.map((v) => [v.size, v.stock]), [['M', 6]]);
  const added = (await (await putProduct(app, p.id, { colors: ['Black', 'White'] })).json()) as Product;
  assertEquals(added.variants.map((v) => [v.color, v.stock]), [['Black', 6], ['White', 0]]);
  assertEquals(added.stock, 6);
});

Deno.test('catalogue: PUT with variants sets each variant; a stale expectedStock writes nothing at all', async () => {
  const app = await setup();
  const p = await twoVariantProduct(app);
  const m = variantOf(p, 'M', 'Black');
  const l = variantOf(p, 'L', 'Black');
  // Someone buys the last M while the admin form is open.
  await placeOrder(app, {
    id: crypto.randomUUID(),
    items: [{ productId: p.id, size: 'M', color: 'Black', quantity: 1 }],
    customer,
  });
  const stale = await putProduct(app, p.id, {
    name: 'Renamed',
    variants: [{ id: m.id, stock: 10, expectedStock: 1 }, { id: l.id, stock: 9, expectedStock: 5 }],
  });
  assertEquals(stale.status, 409);
  const body = await stale.json();
  assertEquals(body.error, 'Stock changed');
  assertEquals(body.stock, 5);
  assertEquals(body.variants, [{ id: m.id, stock: 0 }, { id: l.id, stock: 5 }]);
  const unchanged = await getProduct(app, p.id);
  assertEquals(unchanged.name, 'Two Sizes');
  assertEquals(unchanged.variants.map((v) => v.stock), [0, 5]);
  // A matching expectedStock (or none) applies; a stray `stock` is ignored when variants are given.
  const ok = await putProduct(app, p.id, {
    name: 'Renamed',
    stock: 999,
    variants: [{ id: m.id, stock: 10, expectedStock: 0 }, { id: l.id, stock: 9 }],
  });
  assertEquals(ok.status, 200);
  const u = (await ok.json()) as Product;
  assertEquals(u.name, 'Renamed');
  assertEquals(u.variants.map((v) => v.stock), [10, 9]);
  assertEquals(u.stock, 19);
  // An unknown variant with an expectedStock counts as changed.
  const gone = await putProduct(app, p.id, { variants: [{ id: crypto.randomUUID(), stock: 1, expectedStock: 0 }] });
  assertEquals(gone.status, 409);
});

Deno.test('catalogue: lookup by slug as well as id', async () => {
  const app = await setup();
  const p = await newProduct(app, 5);
  assertEquals(p.slug, 'hoodie');
  assertEquals((await getProduct(app, 'hoodie')).id, p.id);
  assertEquals((await getProduct(app, p.id)).slug, 'hoodie');
  assertEquals((await newProduct(app, 1)).slug, 'hoodie-2');
  assertEquals((await getProduct(app, 'premium-sports-jersey')).id, '2');
  assertEquals((await app.request(`${P}/products/no-such-slug`)).status, 404);
  // Renaming keeps the slug, so links keep working.
  await putProduct(app, p.id, { name: 'Another Name' });
  assertEquals((await getProduct(app, 'hoodie')).name, 'Another Name');
});

Deno.test('catalogue: inactive products are hidden from the public and shown to admins', async () => {
  const app = await setup();
  const r = await putProduct(app, '3', { active: false });
  assertEquals(r.status, 200);
  assertEquals(((await r.json()) as Product).active, false);

  const ids = async (path: string, headers: Record<string, string> = NONE) =>
    ((await (await app.request(`${P}${path}`, { headers })).json()) as Product[]).map((p) => p.id);
  assertEquals(await ids('/products'), ['1', '2', '4', '5']);
  assertEquals((await app.request(`${P}/products/3`)).status, 404);
  assertEquals((await app.request(`${P}/products/3`, { headers: USER })).status, 404);
  assertEquals((await app.request(`${P}/products/athletic-shorts`)).status, 404);
  assertEquals((await app.request(`${P}/products/3`, { headers: ADMIN })).status, 200);
  assertEquals((await app.request(`${P}/products/athletic-shorts`, { headers: ADMIN })).status, 200);

  assertEquals((await app.request(`${P}/products?all=1`, { headers: NONE })).status, 401);
  assertEquals((await app.request(`${P}/products?all=1`, { headers: USER })).status, 403);
  assertEquals(await ids('/products?all=1', ADMIN), ['1', '2', '3', '4', '5']);

  const o = await placeOrder(app, { id: crypto.randomUUID(), items: [{ productId: '3', quantity: 1 }], customer });
  assertEquals(o.status, 400);
  assertEquals((await o.json()).missing, ['3']);

  await putProduct(app, '3', { active: true });
  assertEquals(await ids('/products'), ['1', '2', '3', '4', '5']);
});

Deno.test('categories: public list shows active ones, ?all=1 needs admin', async () => {
  const app = await setup();
  const list = (await (await app.request(`${P}/categories`)).json()) as Category[];
  assertEquals(list.map((c) => c.id), ['tshirts', 'jerseys', 'shorts', 'pants', 'accessories']);
  assertEquals(list[0], { id: 'tshirts', name: 'T-Shirts', sort: 1, active: true });

  const put = (id: string, body: unknown, headers: Record<string, string> = ADMIN) =>
    app.request(`${P}/categories/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  const r = await put('baby-wear', { name: 'Baby Wear', sort: 0, active: false });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { id: 'baby-wear', name: 'Baby Wear', sort: 0, active: false });
  const pub = (await (await app.request(`${P}/categories`)).json()) as Category[];
  assertEquals(pub.map((c) => c.id), ['tshirts', 'jerseys', 'shorts', 'pants', 'accessories']);
  assertEquals((await app.request(`${P}/categories?all=1`)).status, 401);
  assertEquals((await app.request(`${P}/categories?all=1`, { headers: USER })).status, 403);
  const all = (await (await app.request(`${P}/categories?all=1`, { headers: ADMIN })).json()) as Category[];
  assertEquals(all.map((c) => c.id), ['baby-wear', 'tshirts', 'jerseys', 'shorts', 'pants', 'accessories']);

  // Update by id; the order follows sort, then name.
  const r2 = await put('baby-wear', { name: 'Kids', sort: 9, active: true });
  assertEquals(await r2.json(), { id: 'baby-wear', name: 'Kids', sort: 9, active: true });
  const sorted = (await (await app.request(`${P}/categories`)).json()) as Category[];
  assertEquals(sorted.at(-1)?.id, 'baby-wear');

  // Validation.
  assertEquals((await put('Bad_Id', { name: 'x', sort: 1, active: true })).status, 400);
  assertEquals((await put('a'.repeat(41), { name: 'x', sort: 1, active: true })).status, 400);
  assertEquals((await put('ok', { name: '', sort: 1, active: true })).status, 400);
  assertEquals((await put('ok', { name: 'x', sort: 1.5, active: true })).status, 400);
  assertEquals((await put('ok', { name: 'x', sort: 1, active: 'yes' })).status, 400);
  assertEquals((await put('ok', 'nope')).status, 400);
  const bad = await app.request(`${P}/categories/ok`, { method: 'PUT', headers: ADMIN, body: '{nope' });
  assertEquals(bad.status, 400);
});

Deno.test('categories: delete is refused while products use the category', async () => {
  const app = await setup();
  const del = (id: string, headers: Record<string, string> = ADMIN) =>
    app.request(`${P}/categories/${id}`, { method: 'DELETE', headers });
  const used = await del('tshirts');
  assertEquals(used.status, 409);
  const body = await used.json();
  assertEquals(body.count, 1);
  assert(body.error);
  assertEquals(((await (await app.request(`${P}/categories`)).json()) as Category[]).length, 5);

  await app.request(`${P}/categories/temp`, {
    method: 'PUT',
    headers: ADMIN,
    body: JSON.stringify({ name: 'Temp', sort: 7, active: true }),
  });
  assertEquals((await del('temp')).status, 204);
  assertEquals(((await (await app.request(`${P}/categories?all=1`, { headers: ADMIN })).json()) as Category[]).length, 5);
  // Once its products move away the category can go.
  await putProduct(app, '1', { category: 'pants' });
  assertEquals((await del('tshirts')).status, 204);
});

Deno.test('category on products: the store decides, the old ones stay valid', async () => {
  const app = await setup();
  for (const c of ['tshirts', 'jerseys', 'shorts', 'pants', 'accessories']) {
    assertEquals((await post(app, { ...validBody, category: c })).status, 201);
  }
  // Well-formed but unknown: 400 from the store.
  const unknown = await post(app, { ...validBody, category: 'baby-wear' });
  assertEquals(unknown.status, 400);
  assertEquals(await unknown.json(), { error: 'Unknown category' });
  const put = await putProduct(app, '1', { category: 'baby-wear' });
  assertEquals(put.status, 400);
  assertEquals(await put.json(), { error: 'Unknown category' });
  assertEquals((await getProduct(app, '1')).category, 'tshirts');
  // Malformed: 400 from validation.
  for (const bad of ['', 'Pants', 'two words', 5, 'x'.repeat(41)]) {
    assertEquals((await post(app, { ...validBody, category: bad })).status, 400);
    assertEquals((await putProduct(app, '1', { category: bad })).status, 400);
  }
  // A category added by the admin is usable at once.
  await app.request(`${P}/categories/baby-wear`, {
    method: 'PUT',
    headers: ADMIN,
    body: JSON.stringify({ name: 'Baby Wear', sort: 6, active: true }),
  });
  assertEquals((await post(app, { ...validBody, category: 'baby-wear' })).status, 201);
});

Deno.test('catalogue: every new write needs an admin', async () => {
  const app = await setup();
  const p = await twoVariantProduct(app);
  const calls: [string, string, unknown][] = [
    ['PUT', '/categories/tshirts', { name: 'T', sort: 1, active: true }],
    ['DELETE', '/categories/tshirts', undefined],
    ['PUT', `/products/${p.id}`, { variants: [{ id: p.variants[0].id, stock: 9 }] }],
    ['PUT', `/products/${p.id}`, { active: false }],
    ['POST', '/products', { ...validBody, variants: [{ size: 'M', color: 'Black', stock: 1 }] }],
    ['GET', '/products?all=1', undefined],
    ['GET', '/categories?all=1', undefined],
  ];
  for (const [method, path, body] of calls) {
    const init = (headers: Record<string, string>) => ({
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assertEquals((await app.request(`${P}${path}`, init(NONE))).status, 401, `${method} ${path} unauthenticated`);
    assertEquals((await app.request(`${P}${path}`, init(USER))).status, 403, `${method} ${path} non-admin`);
  }
  assertEquals((await getProduct(app, p.id)).variants.map((v) => v.stock), [1, 5]);
  assertEquals((await getProduct(app, p.id)).active, true);
});

Deno.test('orders: cancel puts stock back on the variant, and falls back when the variant is gone', async () => {
  const app = await setup();
  const p = await twoVariantProduct(app);
  const place = async (size: string, quantity: number) => {
    const id = crypto.randomUUID();
    assertEquals((await placeOrder(app, { id, items: [{ productId: p.id, size, color: 'Black', quantity }], customer })).status, 201);
    return id;
  };
  const cancel = (id: string) => app.request(`${P}/orders/${id}/cancel`, { method: 'POST', headers: ADMIN });
  const stocks = async () => (await getProduct(app, p.id)).variants.map((v) => v.stock);

  const a = await place('L', 2);
  assertEquals(await stocks(), [1, 3]);
  assertEquals((await cancel(a)).status, 200);
  assertEquals(await stocks(), [1, 5]);
  assertEquals((await cancel(a)).status, 200); // not restored twice
  assertEquals(await stocks(), [1, 5]);

  // The admin drops size L while an order for it is pending: its stock is not lost.
  const b = await place('L', 3);
  assertEquals(await stocks(), [1, 2]);
  await putProduct(app, p.id, { sizes: ['M'] });
  assertEquals(await stocks(), [3]); // the 2 left on L moved to M
  assertEquals((await cancel(b)).status, 200);
  assertEquals(await stocks(), [6]);

  // A product that is gone: the cancel still works.
  const c = await place('M', 1);
  await app.request(`${P}/products/${p.id}`, { method: 'DELETE', headers: ADMIN });
  assertEquals((await cancel(c)).status, 200);
  assertEquals((await app.request(`${P}/products/${p.id}`)).status, 404);
});

Deno.test('orders: a replay with the same id returns the stored order whatever the stock now', async () => {
  const app = await setup();
  const p = await twoVariantProduct(app);
  const body = {
    id: crypto.randomUUID(),
    items: [{ productId: p.id, size: 'L', color: 'Black', quantity: 5 }],
    customer,
  };
  const first = await placeOrder(app, body);
  assertEquals(first.status, 201);
  const again = await placeOrder(app, body); // L is now at 0, but this is a replay
  assertEquals(again.status, 200);
  assertEquals(await again.json(), await first.json());
  assertEquals((await getProduct(app, p.id)).stock, 1);
});

// ---------------------------------------------------------------------------
// Order lifecycle (mirrors set_order_status in 20261030100000_order_lifecycle.sql)
// ---------------------------------------------------------------------------
const ALL_STATUSES: OrderStatus[] = [
  'pending', 'awaiting_payment', 'paid', 'packed', 'shipped', 'delivered', 'expired', 'cancelled', 'refunded',
];
// Written out here, not read from ORDER_TRANSITIONS, so the test checks the table.
const ALLOWED: [OrderStatus, OrderStatus][] = [
  ['pending', 'paid'], ['pending', 'cancelled'],
  ['awaiting_payment', 'paid'], ['awaiting_payment', 'cancelled'], ['awaiting_payment', 'expired'],
  ['paid', 'packed'], ['paid', 'refunded'],
  ['packed', 'shipped'], ['packed', 'refunded'],
  ['shipped', 'delivered'], ['shipped', 'refunded'],
  ['delivered', 'refunded'],
  ['expired', 'refunded'],
];
const isAllowed = (from: OrderStatus, to: OrderStatus) => ALLOWED.some(([f, t]) => f === from && t === to);

const START = 100; // stock of the test product
const HELD = START - 4; // ... while one 4-unit order is open

/** A memory order store with a product of START in stock; each order() takes 4. */
async function lifecycle() {
  const db = createMemoryDb();
  const lock = createLock();
  const categories = memoryCategories(db, lock);
  const products = memoryProducts(db, lock);
  await seedCatalogue(categories, products);
  const orders = memoryOrders(db, lock);
  await products.create({
    id: 'life', name: 'Life Tee', category: 'pants', price: 10, description: '', images: [],
    sizes: ['M'], colors: ['Black'], stock: START,
  });
  const stock = async () => (await products.get('life'))!.stock;
  /** A new order in `status` (forced, so it holds 4 whatever the status). */
  const order = async (status: OrderStatus = 'pending', fields: Partial<Order> = {}) => {
    const id = crypto.randomUUID();
    const r = await orders.place(id, [{ productId: 'life', quantity: 4 }], { name: 'A', phone: '1' });
    assert(r.ok);
    orders.patch(id, { status, ...fields });
    return id;
  };
  return { orders, stock, order };
}

Deno.test('lifecycle: ORDER_TRANSITIONS is exactly the documented table', () => {
  const pairs = ALL_STATUSES.flatMap((f) => ORDER_TRANSITIONS[f].map((t) => `${f}>${t}`)).sort();
  // cancelled > refunded is listed, but setStatus also needs payment_flag = 'refund_due' for it (tested below).
  assertEquals(pairs, [...ALLOWED.map(([f, t]) => `${f}>${t}`), 'cancelled>refunded'].sort());
  assertEquals(Object.keys(ORDER_TRANSITIONS).sort(), [...ALL_STATUSES].sort());
});

const SOON = '2026-11-01T00:00:00.000Z';

Deno.test('lifecycle: every allowed transition works, every other pair is refused and changes nothing', async () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const label = `${from} -> ${to}`;
      const { orders, stock, order } = await lifecycle(); // a fresh store per pair
      const id = await order(from, { expiresAt: SOON });
      assertEquals(await stock(), HELD, label);
      const r = await orders.setStatus(id, to);
      const stored = (await orders.list()).find((o) => o.id === id)!;

      if (from === to) {
        assert(r.ok && !r.changed, label);
        assertEquals(stored.status, from, label);
        assertEquals(stored.expiresAt, SOON, label);
        assertEquals(await stock(), HELD, label);
      } else if (isAllowed(from, to)) {
        assert(r.ok && r.changed, label);
        assertEquals(r.order, stored, label);
        assertEquals(stored.status, to, label);
        // Stock comes back only for cancelled and expired.
        assertEquals(await stock(), to === 'cancelled' || to === 'expired' ? START : HELD, label);
        assertEquals(stored.paidAt != null, to === 'paid', label);
        // expires_at is cleared by the paid-side statuses and kept by the others.
        const cleared = ['paid', 'packed', 'shipped', 'delivered', 'refunded'].includes(to);
        assertEquals(stored.expiresAt, cleared ? null : SOON, label);
      } else {
        assert(!r.ok && r.reason === 'bad_transition', label);
        if (!r.ok && r.reason === 'bad_transition') {
          assertEquals(r.from, from, label);
          assertEquals(r.to, to, label);
          assertEquals(r.order, stored, label);
        }
        assertEquals(stored.status, from, label);
        assertEquals(stored.expiresAt, SOON, label);
        assertEquals(stored.paidAt, null, label);
        assertEquals(await stock(), HELD, label);
      }
    }
  }
});

Deno.test('lifecycle: an unknown order, an unknown status and a malformed id', async () => {
  const { orders, order, stock } = await lifecycle();
  assertEquals(await orders.setStatus(crypto.randomUUID(), 'paid'), { ok: false, reason: 'not_found' });
  assertEquals(await orders.setStatus('not-a-uuid', 'paid'), { ok: false, reason: 'not_found' });
  const id = await order();
  const r = await orders.setStatus(id, 'bogus' as OrderStatus);
  assert(!r.ok && r.reason === 'bad_transition');
  assertEquals(await stock(), HELD);
});

Deno.test('lifecycle: p_from must match the current status', async () => {
  const { orders, order } = await lifecycle();
  const id = await order('awaiting_payment');
  // A legal move, but from the wrong status: refused, nothing changes.
  const wrong = await orders.setStatus(id, 'paid', 'pending');
  assert(!wrong.ok && wrong.reason === 'bad_transition');
  if (!wrong.ok && wrong.reason === 'bad_transition') {
    assertEquals(wrong.from, 'awaiting_payment');
    assertEquals(wrong.to, 'paid');
    assertEquals(wrong.order.status, 'awaiting_payment');
  }
  // The requested status already holds but `from` is something else: also refused.
  const sameWrong = await orders.setStatus(id, 'awaiting_payment', 'pending');
  assert(!sameWrong.ok && sameWrong.reason === 'bad_transition');
  // The requested status already holds and `from` matches: a no-op.
  const same = await orders.setStatus(id, 'awaiting_payment', 'awaiting_payment');
  assert(same.ok && !same.changed);
  // The right `from` works.
  const ok = await orders.setStatus(id, 'paid', 'awaiting_payment');
  assert(ok.ok && ok.changed && ok.order.status === 'paid');
  // Replaying the same guarded call is now a bad transition (the status moved on).
  const replay = await orders.setStatus(id, 'paid', 'awaiting_payment');
  assert(!replay.ok && replay.reason === 'bad_transition');
});

Deno.test('lifecycle: cancel and expire return stock exactly once, however often they are called', async () => {
  const { orders, order, stock } = await lifecycle();
  const a = await order('pending');
  assert((await orders.setStatus(a, 'cancelled')).ok);
  assertEquals(await stock(), START);
  const again = await orders.setStatus(a, 'cancelled');
  assert(again.ok && !again.changed);
  assertEquals(await stock(), START);
  const viaCancel = await orders.cancel(a);
  assertEquals(viaCancel?.status, 'cancelled');
  assertEquals(await stock(), START);
  // A cancelled order cannot be expired.
  const crossed = await orders.setStatus(a, 'expired');
  assert(!crossed.ok && crossed.reason === 'bad_transition');
  assertEquals(await stock(), START);

  const b = await order('awaiting_payment');
  assertEquals(await stock(), HELD); // b took 4
  assert((await orders.setStatus(b, 'expired')).ok);
  assertEquals(await stock(), START);
  const again2 = await orders.setStatus(b, 'expired');
  assert(again2.ok && !again2.changed);
  assertEquals(await stock(), START);
});

Deno.test('lifecycle: cancel works on awaiting_payment and leaves orders that cannot be cancelled unchanged', async () => {
  const { orders, order, stock } = await lifecycle();
  const a = await order('awaiting_payment');
  assertEquals(await stock(), HELD);
  assertEquals((await orders.cancel(a))?.status, 'cancelled');
  assertEquals(await stock(), START);

  const paid = await order('paid');
  const r = await orders.cancel(paid);
  assertEquals(r?.status, 'paid');
  assertEquals(await stock(), HELD);
  assertEquals(await orders.cancel(crypto.randomUUID()), null);
});

Deno.test('lifecycle: refunding never returns stock, however far the order had got', async () => {
  const { orders, order, stock } = await lifecycle();
  for (const from of ['paid', 'packed', 'shipped', 'delivered', 'expired'] as OrderStatus[]) {
    const id = await order(from);
    const before = await stock();
    const r = await orders.setStatus(id, 'refunded');
    assert(r.ok && r.changed && r.order.status === 'refunded', from);
    assertEquals(await stock(), before, `${from} -> refunded`);
  }
  // Nothing leaves refunded.
  const id = await order('refunded');
  for (const to of ALL_STATUSES.filter((s) => s !== 'refunded')) {
    const r = await orders.setStatus(id, to);
    assert(!r.ok && r.reason === 'bad_transition', to);
  }
});

Deno.test('lifecycle: the whole path through the store, paid_at is set once', async () => {
  const { orders, stock } = await lifecycle();
  const id = crypto.randomUUID();
  const placed = await orders.place(id, [{ productId: 'life', quantity: 4 }], { name: 'A', phone: '1' });
  assert(placed.ok);
  // New fields on a fresh order: empty, with a zero delivery fee.
  assertEquals(placed.order.deliveryFee, 0);
  for (const k of ['delivery', 'paymentMethod', 'paymentFlag', 'paidAt', 'expiresAt', 'tracking'] as const) {
    assertEquals(placed.order[k], null, k);
  }
  const paid = await orders.setStatus(id, 'paid', 'pending');
  assert(paid.ok && paid.changed && paid.order.paidAt);
  const paidAt = paid.order.paidAt;
  for (const next of ['packed', 'shipped', 'delivered', 'refunded'] as OrderStatus[]) {
    const r = await orders.setStatus(id, next);
    assert(r.ok && r.changed && r.order.status === next, next);
    assertEquals(r.order.paidAt, paidAt, next);
  }
  assertEquals(await stock(), HELD);

  // paid_at survives going back to a waiting status and paying again.
  const id2 = crypto.randomUUID();
  await orders.place(id2, [{ productId: 'life', quantity: 1 }], { name: 'A', phone: '1' });
  orders.patch(id2, { status: 'awaiting_payment', paidAt: '2026-01-01T00:00:00.000Z' });
  const r2 = await orders.setStatus(id2, 'paid');
  assert(r2.ok && r2.order.paidAt === '2026-01-01T00:00:00.000Z');
});

Deno.test('lifecycle: POST /orders still returns the old fields, with the new ones empty', async () => {
  const app = await setup();
  const p = await newProduct(app, 5);
  const id = crypto.randomUUID();
  const r = await placeOrder(app, { id, items: [{ productId: p.id, quantity: 1 }], customer });
  assertEquals(r.status, 201);
  const o = (await r.json()) as Order;
  assertEquals(o.status, 'pending');
  assertEquals(o.deliveryFee, 0);
  assertEquals(o.delivery, null);
  assertEquals(o.tracking, null);
  assertEquals('paymentUrl' in o || 'paymentReference' in o, false);
});

// ---------------------------------------------------------------------------
// Delivery (mirrors delivery_options and place_order_v3 in 20261030110000 / 20261030130000)
// ---------------------------------------------------------------------------
const ADDRESS = { line1: ' 12 Main Rd ', suburb: 'Sea Point', city: 'Cape Town', postalCode: '8005' };
const oneTee = (id = crypto.randomUUID()) => ({ id, items: [{ productId: '1', quantity: 1 }], customer });
const deliveryOrder = async (app: App, extra: Record<string, unknown>) => placeOrder(app, { ...oneTee(), ...extra });

Deno.test('delivery options: public, active only, in sort order', async () => {
  const db = createMemoryDb();
  const deps = await createMemoryDeps(isAdmin, true);
  const app = createApp(deps);
  const r = await app.request(`${P}/delivery-options`); // no auth header
  assertEquals(r.status, 200);
  assertEquals(await r.json(), [
    { id: 'door', name: 'Door delivery', price: 85 },
    { id: 'locker', name: 'Locker', price: 55 },
    { id: 'collect', name: 'Collect', price: 0 },
  ]);
  // An inactive option is hidden.
  db.deliveryOptions.get('locker')!.active = false;
  const hidden = createApp({ ...deps, deliveryOptions: memoryDeliveryOptions(db) });
  assertEquals(((await (await hidden.request(`${P}/delivery-options`)).json()) as { id: string }[]).map((o) => o.id), [
    'door',
    'collect',
  ]);
});

Deno.test('delivery: an order without delivery fields behaves as before', async () => {
  const app = await setup();
  const r = await placeOrder(app, oneTee());
  assertEquals(r.status, 201);
  const o = (await r.json()) as Order;
  assertEquals(o.status, 'pending');
  assertEquals(o.delivery, null);
  assertEquals(o.deliveryFee, 0);
  assertEquals(o.total, o.lines[0].subtotal);
});

Deno.test('delivery: the fee comes from the table, and the body cannot change it', async () => {
  const app = await setup();
  const r = await deliveryOrder(app, {
    delivery: { method: 'door', address: ADDRESS, fee: 0, price: 0, total: 1 },
    deliveryFee: 0,
    total: 1,
    fee: 0,
  });
  assertEquals(r.status, 201);
  const o = (await r.json()) as Order;
  assertEquals(o.deliveryFee, 85);
  assertEquals(o.total, o.lines[0].subtotal + 85);
  assertEquals(o.status, 'pending');
  assertEquals(o.delivery, { method: 'door', address: { ...ADDRESS, line1: '12 Main Rd' }, fee: 85 });

  const lk = (await (await deliveryOrder(app, { delivery: { method: 'locker', locker: ' PUDO Sea Point ' } })).json()) as Order;
  assertEquals(lk.delivery, { method: 'locker', locker: 'PUDO Sea Point', fee: 55 });
  assertEquals(lk.total, lk.lines[0].subtotal + 55);

  const col = (await (await deliveryOrder(app, { delivery: { method: 'collect', locker: 'ignored' } })).json()) as Order;
  assertEquals(col.delivery, { method: 'collect', fee: 0 });
  assertEquals(col.total, col.lines[0].subtotal);
});

Deno.test('delivery: bad delivery input gives 400 and takes no stock', async () => {
  const app = await setup();
  const before = await stockOf(app, '1');
  const bad: unknown[] = [
    { method: 'door' },
    { method: 'door', address: { ...ADDRESS, postalCode: '80' } },
    { method: 'door', address: { ...ADDRESS, city: '' } },
    { method: 'door', address: { ...ADDRESS, line1: 'x'.repeat(121) } },
    { method: 'locker' },
    { method: 'locker', locker: '   ' },
    { method: 'drone' },
    { method: 42 },
    'door',
  ];
  for (const delivery of bad) {
    assertEquals((await deliveryOrder(app, { delivery })).status, 400, JSON.stringify(delivery));
  }
  assertEquals((await deliveryOrder(app, { delivery: { method: 'collect' }, paymentMethod: 'cash' })).status, 400);
  assertEquals(await stockOf(app, '1'), before);
});

Deno.test('delivery: an option that is inactive in the store gives 400 Unknown delivery option', async () => {
  const db = createMemoryDb();
  const lock = createLock();
  const products = memoryProducts(db, lock);
  const categories = memoryCategories(db, lock);
  await seedCatalogue(categories, products);
  const orders = memoryOrders(db, lock);
  const app = createApp({
    products,
    categories,
    orders,
    events: memoryEvents(lock),
    community: memoryCommunity(),
    restock: memoryRestock(),
    listSends: memoryListSends(),
    deliveryOptions: memoryDeliveryOptions(db),
    customers: memoryCustomers(() => orders.list(), () => Promise.resolve([])),
    payments: null,
    mailer: null,
    siteUrl: null,
    isAdmin,
    uploadImage: () => Promise.resolve(''),
  });
  db.deliveryOptions.get('door')!.active = false;
  const before = (await products.get('1'))!.stock;
  const r = await placeOrder(app, { ...oneTee(), delivery: { method: 'door', address: ADDRESS } });
  assertEquals(r.status, 400);
  assertEquals(await r.json(), { error: 'Unknown delivery option' });
  assertEquals((await products.get('1'))!.stock, before);
});

Deno.test('delivery: a retried order id does not add the fee twice', async () => {
  const app = await setup();
  const body = { ...oneTee(), delivery: { method: 'door', address: ADDRESS } };
  const first = (await (await placeOrder(app, body)).json()) as Order;
  const again = await placeOrder(app, body);
  assertEquals(again.status, 200);
  const o = (await again.json()) as Order;
  assertEquals(o, first);
  assertEquals(o.total, o.lines[0].subtotal + 85);
  // A retry with a different delivery choice changes nothing either.
  const other = (await (await placeOrder(app, { ...body, delivery: { method: 'collect' } })).json()) as Order;
  assertEquals(other, first);
});

Deno.test('delivery: online payment needs an email and stores the order as awaiting_payment', async () => {
  const app = await setup(createFakeProvider(crypto.randomUUID()));
  assertEquals((await deliveryOrder(app, { paymentMethod: 'online' })).status, 400);
  assertEquals(
    (await deliveryOrder(app, { paymentMethod: 'online', customer: { ...customer, email: 'nope' } })).status,
    400,
  );
  const r = await deliveryOrder(app, { paymentMethod: 'online', customer: { ...customer, email: ' t@example.com ' } });
  assertEquals(r.status, 201);
  const o = (await r.json()) as Order;
  assertEquals(o.status, 'awaiting_payment');
  assertEquals(o.paymentMethod, 'online');
  assertEquals(o.customer.email, 't@example.com');
  const w = (await (await deliveryOrder(app, { paymentMethod: 'whatsapp' })).json()) as Order;
  assertEquals(w.status, 'pending');
  assertEquals(w.paymentMethod, 'whatsapp');
});

Deno.test('delivery: a stock failure with delivery changes nothing', async () => {
  const app = await setup();
  const p = await newProduct(app, 1);
  const r = await placeOrder(app, {
    id: crypto.randomUUID(),
    items: [{ productId: p.id, quantity: 2 }],
    customer,
    delivery: { method: 'door', address: ADDRESS },
  });
  assertEquals(r.status, 409);
  assertEquals(await stockOf(app, p.id), 1);
  assertEquals(((await (await app.request(`${P}/orders`, { headers: ADMIN })).json()) as Order[]).length, 0);
});

// ---------------------------------------------------------------------------
// Online payment through the fake provider (the Paystack provider is tested in payments.test.ts)
// ---------------------------------------------------------------------------
Deno.test('payments: no provider means an online order is refused with 503 before any stock is taken', async () => {
  const app = await setup();
  const before = await stockOf(app, '1');
  const r = await deliveryOrder(app, { paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } });
  assertEquals(r.status, 503);
  assertEquals(await r.json(), { error: 'Online payment is not available' });
  assertEquals(await stockOf(app, '1'), before);
  assertEquals(((await (await app.request(`${P}/orders`, { headers: ADMIN })).json()) as Order[]).length, 0);
  assertEquals((await deliveryOrder(app, { paymentMethod: 'whatsapp' })).status, 201);
});

Deno.test('payments: place online, pay, then a signed webhook marks the order paid once', async () => {
  const fake = createFakeProvider(crypto.randomUUID());
  const app = await setup(fake);
  const placed = await deliveryOrder(app, {
    paymentMethod: 'online',
    delivery: { method: 'collect' },
    customer: { ...customer, email: 't@example.com' },
  });
  assertEquals(placed.status, 201);
  const o = (await placed.json()) as Order;
  const started = await app.request(`${P}/orders/${o.id}/pay`, { method: 'POST', body: JSON.stringify({ amount: 1 }) });
  assertEquals(started.status, 200);
  assertEquals(await started.json(), { redirectUrl: `https://fake-pay.test/pay/${o.id}` });
  assertEquals(fake.starts.length, 1);
  assertEquals(fake.starts[0].amountCents, Math.round(o.total * 100));
  assertEquals([fake.starts[0].reference, fake.starts[0].email, fake.starts[0].currency], [o.id, 't@example.com', 'ZAR']);

  const hook = (h: Record<string, string>, body: string) =>
    app.request(`${P}/payments/webhook`, { method: 'POST', headers: h, body });
  const paid = await fake.pay(o.id);
  assertEquals((await hook({}, paid.body)).status, 401); // no signature
  assertEquals((await hook({ 'x-fake-signature': 'f'.repeat(128) }, paid.body)).status, 401);
  assertEquals((await hook(paid.headers, paid.body)).status, 200);
  const listed = (await (await app.request(`${P}/orders`, { headers: ADMIN })).json()) as Order[];
  const stored = listed.find((x) => x.id === o.id)!;
  assertEquals(stored.status, 'paid');
  assert(stored.paidAt);
  assertEquals((await hook(paid.headers, paid.body)).status, 200);
  const again = ((await (await app.request(`${P}/orders`, { headers: ADMIN })).json()) as Order[]).find((x) => x.id === o.id)!;
  assertEquals(again, stored);
  assertEquals((await app.request(`${P}/orders/${o.id}/pay`, { method: 'POST' })).status, 409);
});

// ---------------------------------------------------------------------------
// Abuse limits: per-address order limit, unit cap, order expiry, mark-paid (section 4)
// ---------------------------------------------------------------------------
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const TOO_MANY = 'Too many orders from this connection. Please try again in an hour or message us on WhatsApp.';

/** A shop with a clock the test moves, and a tee with plenty of stock. */
async function timed(payments: PaymentProvider | null = null) {
  let t = Date.parse('2026-06-01T10:00:00.000Z');
  const deps = await createMemoryDeps(isAdmin, true, payments, () => t);
  await deps.products.create({
    id: 'tee', name: 'Tee', category: 'pants', price: 10, description: '', images: [],
    sizes: ['M'], colors: ['Black'], stock: 100,
  });
  const app = createApp({ ...deps, uploadImage: () => Promise.resolve('') });
  const stock = async () => (await deps.products.get('tee'))!.stock;
  const orderBody = (extra: Record<string, unknown> = {}, quantity = 1) => ({
    id: crypto.randomUUID(),
    items: [{ productId: 'tee', quantity }],
    customer,
    ...extra,
  });
  const place = (body: unknown, headers: Record<string, string> = {}) =>
    app.request(`${P}/orders`, { method: 'POST', headers: { ...JSON_H, ...headers }, body: JSON.stringify(body) });
  const at = (ip: string) => ({ 'cf-connecting-ip': ip });
  const advance = (ms: number) => {
    t += ms;
  };
  const get = async (id: string) => (await deps.orders.list()).find((o) => o.id === id);
  const markPaid = (id: string, headers: Record<string, string> = ADMIN) =>
    app.request(`${P}/orders/${id}/mark-paid`, { method: 'POST', headers });
  return { app, deps, orders: deps.orders, stock, orderBody, place, at, advance, get, markPaid };
}

Deno.test('clientIp: only cf-connecting-ip, only when it looks like an address', () => {
  const ip = (h: Record<string, string>) => clientIp(new Headers(h));
  assertEquals(ip({ 'cf-connecting-ip': ' 203.0.113.9 ' }), '203.0.113.9');
  assertEquals(ip({ 'cf-connecting-ip': '2001:db8::1' }), '2001:db8::1');
  assertEquals(ip({}), null);
  assertEquals(ip({ 'x-forwarded-for': '203.0.113.9' }), null);
  assertEquals(ip({ 'x-forwarded-for': '1.1.1.1', 'cf-connecting-ip': '203.0.113.9' }), '203.0.113.9');
  for (const bad of ['', 'not an ip', '1.2.3.4, 5.6.7.8', '1.2.3.4;drop', 'g::1', '1'.repeat(46)]) {
    assertEquals(ip({ 'cf-connecting-ip': bad }), null, bad);
  }
});

Deno.test('rate limit: 5 orders per address per hour pass, the 6th gets 429 and keeps nothing', async () => {
  const w = await timed();
  for (let i = 0; i < 5; i++) assertEquals((await w.place(w.orderBody(), w.at('203.0.113.9'))).status, 201, `order ${i + 1}`);
  assertEquals(await w.stock(), 95);
  const sixth = w.orderBody({}, 3);
  const r = await w.place(sixth, w.at('203.0.113.9'));
  assertEquals(r.status, 429);
  assertEquals(r.headers.get('Retry-After'), '3600');
  assertEquals(await r.json(), { error: TOO_MANY });
  assertEquals(await w.stock(), 95); // its stock is back
  assertEquals(await w.get(sixth.id), undefined); // and there is no order row
  assertEquals((await w.orders.list()).length, 5);
});

Deno.test('rate limit: other addresses are independent; no or invalid cf-connecting-ip never blocks; x-forwarded-for is ignored', async () => {
  const w = await timed();
  for (let i = 0; i < 5; i++) await w.place(w.orderBody(), w.at('203.0.113.9'));
  assertEquals((await w.place(w.orderBody(), w.at('203.0.113.9'))).status, 429);
  assertEquals((await w.place(w.orderBody(), w.at('203.0.113.10'))).status, 201);
  assertEquals((await w.place(w.orderBody(), w.at('2001:db8::1'))).status, 201);
  // No header, or one that is not an address: no check, however many.
  for (let i = 0; i < 8; i++) assertEquals((await w.place(w.orderBody())).status, 201, `no header ${i}`);
  for (let i = 0; i < 8; i++) assertEquals((await w.place(w.orderBody(), w.at('nope, 1.2.3.4'))).status, 201, `bad header ${i}`);
  // x-forwarded-for is never read: it neither counts against the real address nor identifies one.
  for (let i = 0; i < 8; i++) {
    assertEquals((await w.place(w.orderBody(), { 'x-forwarded-for': '198.51.100.7' })).status, 201, `xff ${i}`);
  }
  const spoof = { 'x-forwarded-for': '198.51.100.7', ...w.at('203.0.113.77') };
  for (let i = 0; i < 5; i++) assertEquals((await w.place(w.orderBody(), spoof)).status, 201);
  assertEquals((await w.place(w.orderBody(), { 'x-forwarded-for': '203.0.113.77', ...w.at('203.0.113.78') })).status, 201);
  assertEquals((await w.place(w.orderBody(), spoof)).status, 429);
});

Deno.test('rate limit: the window rolls; a row older than an hour no longer counts', async () => {
  const w = await timed();
  const ip = w.at('203.0.113.9');
  for (let i = 0; i < 3; i++) await w.place(w.orderBody(), ip);
  w.advance(30 * MIN);
  for (let i = 0; i < 2; i++) await w.place(w.orderBody(), ip);
  assertEquals((await w.place(w.orderBody(), ip)).status, 429);
  w.advance(30 * MIN + 1); // the first three are now older than an hour; two remain
  for (let i = 0; i < 3; i++) assertEquals((await w.place(w.orderBody(), ip)).status, 201, `after the window ${i}`);
  assertEquals((await w.place(w.orderBody(), ip)).status, 429);
  w.advance(HOUR + 1);
  assertEquals((await w.place(w.orderBody(), ip)).status, 201);
});

Deno.test('rate limit: idempotent retries and stock rejections do not count', async () => {
  const w = await timed();
  const ip = w.at('203.0.113.9');
  const first = w.orderBody();
  assertEquals((await w.place(first, ip)).status, 201);
  for (let i = 0; i < 10; i++) assertEquals((await w.place(first, ip)).status, 200, `retry ${i}`);
  // Stock rejections (409) and unknown products (400) are answered before the limit and are not counted.
  await w.deps.products.create({
    id: 'scarce', name: 'Scarce', category: 'pants', price: 10, description: '', images: [],
    sizes: ['M'], colors: ['Black'], stock: 1,
  });
  const short = { ...w.orderBody(), items: [{ productId: 'scarce', quantity: 2 }] };
  for (let i = 0; i < 10; i++) assertEquals((await w.place(short, ip)).status, 409, `short ${i}`);
  const ghost = { ...w.orderBody(), items: [{ productId: 'ghost', quantity: 1 }] };
  for (let i = 0; i < 10; i++) assertEquals((await w.place(ghost, ip)).status, 400);
  // Four more real orders still fit: the first order is the only one counted so far.
  for (let i = 0; i < 4; i++) assertEquals((await w.place(w.orderBody(), ip)).status, 201, `order ${i + 2}`);
  assertEquals((await w.place(w.orderBody(), ip)).status, 429);
  // A retry of an order that exists is still answered once the address is at its limit.
  assertEquals((await w.place(first, ip)).status, 200);
});

Deno.test('rate limit: a stock rejection at the limit is a 409, not a 429', async () => {
  const w = await timed();
  const ip = w.at('203.0.113.9');
  for (let i = 0; i < 5; i++) await w.place(w.orderBody(), ip);
  await w.deps.products.update('tee', {}, undefined, [{ id: (await w.deps.products.get('tee'))!.variants[0].id, stock: 0 }]);
  assertEquals((await w.place(w.orderBody(), ip)).status, 409);
});

Deno.test('units: 11 across lines gives 400 too_many_units, exactly 10 passes, per-line limits are unchanged', async () => {
  const w = await timed();
  const eleven = await w.place({ ...w.orderBody(), items: [{ productId: 'tee', quantity: 6 }, { productId: 'tee', quantity: 5 }] });
  assertEquals(eleven.status, 400);
  assertEquals(await eleven.json(), { error: 'An order can hold up to 10 items in total', code: 'too_many_units' });
  assertEquals((await w.place(w.orderBody({}, 11))).status, 400);
  assertEquals(await w.stock(), 100);
  const ten = await w.place({ ...w.orderBody(), items: [{ productId: 'tee', quantity: 6 }, { productId: 'tee', quantity: 4 }] });
  assertEquals(ten.status, 201);
  assertEquals((await w.place(w.orderBody({}, 10))).status, 201);
  assertEquals(await w.stock(), 80);
  // Per-line errors keep their own message and carry no code.
  const line = await w.place(w.orderBody({}, 51));
  assertEquals(line.status, 400);
  assertEquals(await line.json(), { error: 'quantity must be an integer from 1 to 50' });
  assertEquals((await w.place(w.orderBody({}, 0))).status, 400);
});

Deno.test('expiry: due pending orders are cancelled, due awaiting_payment orders expire, stock returns once', async () => {
  const fake = createFakeProvider(crypto.randomUUID());
  const w = await timed(fake);
  const wa = (await (await w.place(w.orderBody({}, 2))).json()) as Order;
  const online = (await (await w.place(w.orderBody({ paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } }, 3))).json()) as Order;
  assertEquals(await w.stock(), 95);
  assertEquals(Date.parse(wa.expiresAt!) - Date.parse(wa.createdAt), 48 * HOUR);
  assertEquals(Date.parse(online.expiresAt!) - Date.parse(online.createdAt), 30 * MIN);

  // Not yet due: nothing happens.
  w.advance(29 * MIN);
  assertEquals(await w.orders.expireDue(), []);
  assertEquals(await w.stock(), 95);

  // 30 minutes: only the online order is due.
  w.advance(MIN);
  assertEquals(await w.orders.expireDue(), [online.id]);
  assertEquals((await w.get(online.id))!.status, 'expired');
  assertEquals((await w.get(wa.id))!.status, 'pending');
  assertEquals(await w.stock(), 98);
  assertEquals(await w.orders.expireDue(), []); // a second run does nothing

  // 48 hours: the WhatsApp order.
  w.advance(48 * HOUR - 30 * MIN);
  assertEquals(await w.orders.expireDue(), [wa.id]);
  assertEquals((await w.get(wa.id))!.status, 'cancelled');
  assertEquals(await w.stock(), 100);
  assertEquals(await w.orders.expireDue(), []);
  assertEquals(await w.stock(), 100);
});

Deno.test('expiry: an order with no expiry, a paid order and an order that is not due are left alone', async () => {
  const w = await timed();
  const mk = async (quantity: number) => ((await (await w.place(w.orderBody({}, quantity))).json()) as Order).id;
  const old = await mk(1); // stands in for an order from before the migration: expires_at NULL
  w.orders.patch(old, { expiresAt: null });
  const paid = await mk(2);
  assertEquals((await w.orders.setStatus(paid, 'paid', 'pending')).ok, true);
  const fresh = await mk(4);
  w.advance(47 * HOUR);
  const later = await mk(5); // placed 47 hours in: due 48 hours after that
  w.advance(10 * HOUR); // 57 hours after the start: fresh is due, later is not
  assertEquals(await w.orders.expireDue(), [fresh]);
  assertEquals((await w.get(old))!.status, 'pending');
  assertEquals((await w.get(paid))!.status, 'paid');
  assertEquals((await w.get(later))!.status, 'pending');
  assertEquals(await w.stock(), 100 - 1 - 2 - 5);
  w.advance(1000 * HOUR);
  assertEquals(await w.orders.expireDue(), [later]);
  assertEquals((await w.get(old))!.status, 'pending'); // NULL expires_at is never touched
  assertEquals((await w.get(paid))!.status, 'paid');
  assertEquals(await w.stock(), 100 - 1 - 2);
});

Deno.test('expiry: a payment after the order expired still goes through the late path', async () => {
  const fake = createFakeProvider(crypto.randomUUID());
  const w = await timed(fake);
  const placed = await w.place(w.orderBody({ paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } }, 2));
  const o = (await placed.json()) as Order;
  assertEquals((await w.app.request(`${P}/orders/${o.id}/pay`, { method: 'POST' })).status, 200);
  w.advance(31 * MIN);
  assertEquals(await w.orders.expireDue(), [o.id]);
  assertEquals((await w.get(o.id))!.status, 'expired');
  assertEquals(await w.stock(), 100);
  const paid = await fake.pay(o.id);
  const hook = await w.app.request(`${P}/payments/webhook`, { method: 'POST', headers: paid.headers, body: paid.body });
  assertEquals(hook.status, 200);
  const after = (await w.get(o.id))!;
  assertEquals([after.status, after.expiresAt, after.paymentFlag], ['paid', null, null]);
  assertEquals(await w.stock(), 98);
  assertEquals(await w.orders.expireDue(), []);
});

Deno.test('mark-paid: needs an admin', async () => {
  const w = await timed();
  const o = (await (await w.place(w.orderBody())).json()) as Order;
  assertEquals((await w.markPaid(o.id, {})).status, 401);
  assertEquals((await w.markPaid(o.id, { Authorization: 'Bearer user' })).status, 403);
  assertEquals((await w.get(o.id))!.status, 'pending');
});

Deno.test('mark-paid: pending becomes paid, expiresAt is cleared and the stock stays taken', async () => {
  const w = await timed();
  const o = (await (await w.place(w.orderBody({}, 3))).json()) as Order;
  assertEquals(await w.stock(), 97);
  const r = await w.markPaid(o.id);
  assertEquals(r.status, 200);
  const paid = (await r.json()) as Order;
  assertEquals([paid.status, paid.expiresAt], ['paid', null]);
  assert(paid.paidAt);
  assertEquals(await w.stock(), 97);
  // The expiry job leaves it alone, however late.
  w.advance(1000 * HOUR);
  assertEquals(await w.orders.expireDue(), []);
  assertEquals((await w.get(o.id))!.status, 'paid');
  assertEquals(await w.stock(), 97);
  // Marking it again is a 409: it is no longer pending.
  const again = await w.markPaid(o.id);
  assertEquals(again.status, 409);
  assertEquals(await again.json(), { error: 'Only pending orders can be marked paid', status: 'paid' });
});

Deno.test('mark-paid: awaiting_payment, cancelled and expired orders give 409; unknown and malformed ids give 404', async () => {
  const fake = createFakeProvider(crypto.randomUUID());
  const w = await timed(fake);
  const online = (await (await w.place(w.orderBody({ paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } }))).json()) as Order;
  const r = await w.markPaid(online.id);
  assertEquals(r.status, 409);
  assertEquals(await r.json(), { error: 'Only pending orders can be marked paid', status: 'awaiting_payment' });
  assertEquals((await w.get(online.id))!.status, 'awaiting_payment');

  const wa = (await (await w.place(w.orderBody())).json()) as Order;
  await w.orders.cancel(wa.id);
  const c = await w.markPaid(wa.id);
  assertEquals(c.status, 409);
  assertEquals((await c.json()).status, 'cancelled');

  w.advance(31 * MIN);
  await w.orders.expireDue();
  assertEquals((await (await w.markPaid(online.id)).json()).status, 'expired');

  assertEquals((await w.markPaid(crypto.randomUUID())).status, 404);
  assertEquals((await w.markPaid('not-a-uuid')).status, 404);
  assertEquals(await w.stock(), 100);
});

// ---------------------------------------------------------------------------
// Order fulfilment (20261031100000_order_fulfilment.sql): admin status, tracking and extend routes,
// the public order page and the public lookup.
// ---------------------------------------------------------------------------
const ZERO = '00000000-0000-4000-8000-000000000000';
const HOME_ADDRESS = { line1: '12 Long Street', line2: 'Flat 4', suburb: 'Gardens', city: 'Cape Town', postalCode: '8001' };
type Timed = Awaited<ReturnType<typeof timed>>;

const adminPost = (w: Timed, path: string, body?: unknown, headers: Record<string, string> = ADMIN) =>
  w.app.request(`${P}${path}`, { method: 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const setStatusVia = (w: Timed, id: string, status: unknown, headers?: Record<string, string>) =>
  adminPost(w, `/orders/${id}/status`, { status }, headers);
const trackVia = (w: Timed, id: string, body: unknown, headers?: Record<string, string>) =>
  adminPost(w, `/orders/${id}/tracking`, body, headers);
const extendVia = (w: Timed, id: string, headers?: Record<string, string>) => adminPost(w, `/orders/${id}/extend`, undefined, headers);

/** A pending WhatsApp order of 2 tees, taken to `status` through the real routes. */
async function orderAt(w: Timed, status: 'pending' | 'paid' | 'packed' | 'shipped' | 'delivered', extra: Record<string, unknown> = {}) {
  const o = (await (await w.place(w.orderBody(extra, 2))).json()) as Order;
  const steps = ['paid', 'packed', 'shipped', 'delivered'].slice(0, ['pending', 'paid', 'packed', 'shipped', 'delivered'].indexOf(status));
  for (const step of steps) {
    const r = step === 'paid' ? await w.markPaid(o.id) : await setStatusVia(w, o.id, step);
    assertEquals(r.status, 200, step);
  }
  return o.id;
}

Deno.test('fulfilment routes: every new admin route needs an admin (401 without a token, 403 for a non-admin)', async () => {
  const w = await timed();
  const id = await orderAt(w, 'packed');
  const none = { 'Content-Type': 'application/json' };
  const user = { Authorization: 'Bearer user', 'Content-Type': 'application/json' };
  for (const [path, body] of [
    [`/orders/${id}/status`, { status: 'shipped' }],
    [`/orders/${id}/tracking`, { number: 'T1' }],
    [`/orders/${id}/extend`, undefined],
    [`/orders/${ZERO}/status`, { status: 'shipped' }],
    [`/orders/not-a-uuid/extend`, undefined],
  ] as [string, unknown][]) {
    assertEquals((await adminPost(w, path, body, none)).status, 401, path);
    assertEquals((await adminPost(w, path, body, { Authorization: 'Bearer nope' })).status, 401, path);
    assertEquals((await adminPost(w, path, body, user)).status, 403, path);
  }
  const stored = (await w.get(id))!;
  assertEquals([stored.status, stored.tracking], ['packed', null]);
});

Deno.test('status route: paid -> packed -> shipped -> delivered -> refunded, each answered with the order, stock untouched', async () => {
  const w = await timed();
  const id = await orderAt(w, 'paid');
  assertEquals(await w.stock(), 98);
  for (const next of ['packed', 'shipped', 'delivered', 'refunded']) {
    const r = await setStatusVia(w, id, next);
    assertEquals(r.status, 200, next);
    const o = (await r.json()) as Order;
    assertEquals([o.id, o.status, o.expiresAt], [id, next, null], next);
    assertEquals((await w.get(id))!.status, next);
    assertEquals(await w.stock(), 98, next); // moving along, and refunding, never return stock
  }
  // Refunded is final.
  for (const next of ['packed', 'shipped', 'delivered']) {
    const r = await setStatusVia(w, id, next);
    assertEquals(r.status, 409, next);
    assertEquals((await r.json()).status, 'refunded');
  }
});

Deno.test('status route: a refund works from paid, packed, shipped, delivered and expired, and returns no stock', async () => {
  const w = await timed(createFakeProvider(crypto.randomUUID()));
  for (const at of ['paid', 'packed', 'shipped', 'delivered'] as const) {
    const id = await orderAt(w, at);
    const before = await w.stock();
    const r = await setStatusVia(w, id, 'refunded');
    assertEquals(r.status, 200, at);
    assertEquals(((await r.json()) as Order).status, 'refunded', at);
    assertEquals(await w.stock(), before, at);
  }
  // An online order that expired.
  const online = (await (await w.place(w.orderBody({ paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } }))).json()) as Order;
  w.advance(31 * MIN);
  await w.orders.expireDue();
  const before = await w.stock();
  assertEquals((await w.get(online.id))!.status, 'expired');
  assertEquals((await setStatusVia(w, online.id, 'refunded')).status, 200);
  assertEquals(await w.stock(), before);
});

Deno.test('status route: a move the table does not allow gives 409 with the current status and changes nothing', async () => {
  const w = await timed(createFakeProvider(crypto.randomUUID()));
  const pending = await orderAt(w, 'pending');
  const paid = await orderAt(w, 'paid');
  const packed = await orderAt(w, 'packed');
  const shipped = await orderAt(w, 'shipped');
  const delivered = await orderAt(w, 'delivered');
  const cancelled = await orderAt(w, 'pending');
  await w.orders.cancel(cancelled);
  const online = (await (await w.place(w.orderBody({ paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } }))).json()) as Order;
  const stock = await w.stock();

  const cases: [string, string, string][] = [
    [pending, 'packed', 'pending'], [pending, 'shipped', 'pending'], [pending, 'delivered', 'pending'], [pending, 'refunded', 'pending'],
    [online.id, 'packed', 'awaiting_payment'], [online.id, 'refunded', 'awaiting_payment'],
    [paid, 'shipped', 'paid'], [paid, 'delivered', 'paid'],
    [packed, 'packed', 'packed'], [packed, 'delivered', 'packed'], // a second click on the same button
    [shipped, 'packed', 'shipped'], [shipped, 'shipped', 'shipped'],
    [delivered, 'packed', 'delivered'], [delivered, 'shipped', 'delivered'], [delivered, 'delivered', 'delivered'],
    [cancelled, 'packed', 'cancelled'], [cancelled, 'refunded', 'cancelled'], // no refund_due flag
  ];
  for (const [id, to, now] of cases) {
    const r = await setStatusVia(w, id, to);
    assertEquals(r.status, 409, `${now} -> ${to}`);
    const body = await r.json();
    assertEquals(body.status, now, `${now} -> ${to}`);
    assert(typeof body.error === 'string' && body.error !== '');
    assertEquals((await w.get(id))!.status, now);
  }
  assertEquals(await w.stock(), stock);
});

Deno.test('status route: a forward move names the status it comes from, so a stale screen gets 409', async () => {
  const w = await timed();
  const id = await orderAt(w, 'paid');
  assertEquals((await setStatusVia(w, id, 'packed')).status, 200);
  // Another admin already moved it on; this one still sees "paid" and clicks Mark packed again.
  assertEquals((await setStatusVia(w, id, 'shipped')).status, 200);
  const stale = await setStatusVia(w, id, 'packed');
  assertEquals(stale.status, 409);
  assertEquals((await stale.json()).status, 'shipped');
  assertEquals((await w.get(id))!.status, 'shipped');
});

Deno.test('status route: a cancelled order is refunded only when it is flagged refund_due, which clears the flag', async () => {
  const w = await timed();
  const a = await orderAt(w, 'pending');
  const b = await orderAt(w, 'pending');
  const c = await orderAt(w, 'pending');
  for (const id of [a, b, c]) await w.orders.cancel(id);
  assertEquals(await w.stock(), 100); // cancelling returned it all
  w.orders.patch(a, { paymentFlag: 'refund_due' });
  w.orders.patch(b, { paymentFlag: 'amount_mismatch' });

  assertEquals((await setStatusVia(w, b, 'refunded')).status, 409);
  assertEquals((await setStatusVia(w, c, 'refunded')).status, 409);
  assertEquals((await w.get(b))!.status, 'cancelled');
  assertEquals((await w.get(b))!.paymentFlag, 'amount_mismatch');

  const r = await setStatusVia(w, a, 'refunded');
  assertEquals(r.status, 200);
  const o = (await r.json()) as Order;
  assertEquals([o.status, o.paymentFlag], ['refunded', null]);
  assertEquals((await w.get(a))!.paymentFlag, null);
  assertEquals(await w.stock(), 100); // a refund does not touch stock
  // The cancel route still leaves it alone, and a second refund is a no-op, not an error.
  assertEquals(((await (await adminPost(w, `/orders/${a}/cancel`)).json()) as Order).status, 'refunded');
  assertEquals((await setStatusVia(w, a, 'refunded')).status, 200);
  // The other statuses refuse to leave the flag: a paid order flagged and refunded loses a refund_due flag too.
  const d = await orderAt(w, 'paid');
  w.orders.patch(d, { paymentFlag: 'refund_due' });
  assertEquals(((await (await setStatusVia(w, d, 'refunded')).json()) as Order).paymentFlag, null);
});

Deno.test('status route: refund_due flows in through a late online payment and out through the refund', async () => {
  const fake = createFakeProvider(crypto.randomUUID());
  const w = await timed(fake);
  const o = (await (await w.place(w.orderBody({ paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } }, 2))).json()) as Order;
  assertEquals(await w.stock(), 98);
  assertEquals((await w.app.request(`${P}/orders/${o.id}/pay`, { method: 'POST' })).status, 200);
  assertEquals((await w.orders.cancel(o.id))?.status, 'cancelled');
  assertEquals(await w.stock(), 100);
  // The stock is sold or written off, then the customer's payment arrives.
  assert((await w.deps.products.update('tee', { stock: 0 })).ok);
  assertEquals(await w.stock(), 0);
  const late = await w.orders.recordPayment(o.id, Math.round(o.total * 100), 'ZAR');
  assert(late.ok && late.outcome === 'refund_due');
  const flagged = (await w.get(o.id))!;
  assertEquals([flagged.status, flagged.paymentFlag], ['cancelled', 'refund_due']);

  const r = await setStatusVia(w, o.id, 'refunded');
  assertEquals(r.status, 200);
  const done = (await r.json()) as Order;
  assertEquals([done.status, done.paymentFlag], ['refunded', null]);
  assertEquals(await w.stock(), 0);
});

Deno.test('status route: invalid statuses give 400, and cancelling stays on the cancel route', async () => {
  const w = await timed();
  const id = await orderAt(w, 'paid');
  const cancelled = await setStatusVia(w, id, 'cancelled');
  assertEquals(cancelled.status, 400);
  assert((await cancelled.json()).error.includes('cancel route'));
  for (const bad of ['bogus', '', 'PACKED', 'paid', 'pending', 'awaiting_payment', 'expired', 'toString', '__proto__', 'constructor', 7, null, true, ['packed'], {}, undefined]) {
    const r = await setStatusVia(w, id, bad);
    assertEquals(r.status, 400, JSON.stringify(bad));
    assert((await r.json()).error);
  }
  assertEquals((await adminPost(w, `/orders/${id}/status`, [])).status, 400);
  assertEquals((await adminPost(w, `/orders/${id}/status`, 'packed')).status, 400);
  assertEquals((await w.app.request(`${P}/orders/${id}/status`, { method: 'POST', headers: ADMIN, body: '{nope' })).status, 400);
  assertEquals((await w.app.request(`${P}/orders/${id}/status`, { method: 'POST', headers: ADMIN })).status, 400);
  assertEquals((await w.get(id))!.status, 'paid');
  // The 'pay' statuses cannot be reached through this route, so a payment cannot be skipped.
  const pending = await orderAt(w, 'pending');
  assertEquals((await setStatusVia(w, pending, 'paid')).status, 400);
  assertEquals((await w.get(pending))!.status, 'pending');
});

Deno.test('status route: an unknown or malformed order id gives 404', async () => {
  const w = await timed();
  for (const id of [ZERO, crypto.randomUUID(), 'not-a-uuid', '1']) {
    const r = await setStatusVia(w, id, 'packed');
    assertEquals(r.status, 404, id);
    assertEquals(await r.json(), { error: 'Order not found' });
  }
  // A well-formed id that is unknown is judged after the body: a bad status is still a 400.
  assertEquals((await setStatusVia(w, ZERO, 'bogus')).status, 400);
  assertEquals((await setStatusVia(w, ZERO, 'refunded')).status, 404);
});

Deno.test('tracking route: stores trimmed courier, number and https link on a packed or shipped order', async () => {
  const w = await timed();
  const id = await orderAt(w, 'packed');
  const r = await trackVia(w, id, { courier: '  The Courier Guy ', number: ' TCG123 ', url: ' https://track.example.com/TCG123 ', extra: 'ignored' });
  assertEquals(r.status, 200);
  const o = (await r.json()) as Order;
  assertEquals(o.tracking, { courier: 'The Courier Guy', number: 'TCG123', url: 'https://track.example.com/TCG123' });
  assertEquals(o.status, 'packed');
  assertEquals((await w.get(id))!.tracking, o.tracking);

  // A missing key keeps the value; an empty string or null clears it; all three cleared gives null.
  assertEquals(((await (await trackVia(w, id, { number: 'TCG999' })).json()) as Order).tracking, {
    courier: 'The Courier Guy', number: 'TCG999', url: 'https://track.example.com/TCG123',
  });
  assertEquals(((await (await trackVia(w, id, { courier: '', url: null })).json()) as Order).tracking, {
    courier: null, number: 'TCG999', url: null,
  });
  assertEquals(((await (await trackVia(w, id, { number: '   ' })).json()) as Order).tracking, null);

  // Still allowed once shipped, and the status is not changed by it.
  assertEquals((await setStatusVia(w, id, 'shipped')).status, 200);
  const shipped = (await (await trackVia(w, id, { courier: 'Aramex', url: 'https://aramex.example/1' })).json()) as Order;
  assertEquals([shipped.status, shipped.tracking?.courier], ['shipped', 'Aramex']);
  assertEquals((await w.get(id))!.status, 'shipped');
});

Deno.test('tracking route: other statuses give 409 with the status; unknown and malformed ids give 404', async () => {
  const w = await timed();
  const pending = await orderAt(w, 'pending');
  const paid = await orderAt(w, 'paid');
  const delivered = await orderAt(w, 'delivered');
  const cancelled = await orderAt(w, 'pending');
  await w.orders.cancel(cancelled);
  const refunded = await orderAt(w, 'paid');
  await setStatusVia(w, refunded, 'refunded');
  for (const [id, status] of [[pending, 'pending'], [paid, 'paid'], [delivered, 'delivered'], [cancelled, 'cancelled'], [refunded, 'refunded']]) {
    const r = await trackVia(w, id, { number: 'T1' });
    assertEquals(r.status, 409, status);
    assertEquals((await r.json()).status, status);
    assertEquals((await w.get(id))!.tracking, null, status);
  }
  assertEquals((await trackVia(w, ZERO, { number: 'T1' })).status, 404);
  assertEquals((await trackVia(w, 'not-a-uuid', { number: 'T1' })).status, 404);
});

Deno.test('tracking route: field limits (120 characters), https links only, at least one field', async () => {
  const w = await timed();
  const id = await orderAt(w, 'packed');
  const long = (n: number) => 'a'.repeat(n);
  assertEquals((await trackVia(w, id, { courier: long(120), number: long(120), url: `https://x.example/${long(102)}` })).status, 200);
  assertEquals((await trackVia(w, id, { courier: long(121) })).status, 400);
  assertEquals((await trackVia(w, id, { number: long(121) })).status, 400);
  assertEquals((await trackVia(w, id, { url: `https://x.example/${long(103)}` })).status, 400);
  assertEquals((await trackVia(w, id, { courier: `  ${long(120)}  ` })).status, 200); // trimmed first
  for (const url of ['http://track.example/1', 'HTTP://track.example/1', 'javascript:alert(1)', 'ftp://track.example/1', 'data:text/html,hi',
    '//track.example/1', 'track.example/1', 'https:track.example', 'https://', 'https://exa mple.com', 'mailto:a@b.co', '  http://x.example  ']) {
    const r = await trackVia(w, id, { url });
    assertEquals(r.status, 400, url);
  }
  assertEquals((await trackVia(w, id, { url: 'HTTPS://Track.Example/1' })).status, 200);
  for (const bad of [{}, { other: 'x' }, { courier: 5 }, { number: ['1'] }, { url: {} }, { courier: true }, [], 'x', null, 7]) {
    assertEquals((await trackVia(w, id, bad)).status, 400, JSON.stringify(bad));
  }
  assertEquals((await w.app.request(`${P}/orders/${id}/tracking`, { method: 'POST', headers: ADMIN, body: '{nope' })).status, 400);
  // The last good write is intact.
  assertEquals((await w.get(id))!.tracking?.url, 'HTTPS://Track.Example/1');
});

Deno.test('extend route: a pending order gets 48 hours more, from its expiry or from now if that has passed', async () => {
  const w = await timed();
  const o = (await (await w.place(w.orderBody())).json()) as Order;
  const start = Date.parse('2026-06-01T10:00:00.000Z');
  assertEquals(o.expiresAt, new Date(start + 48 * HOUR).toISOString());

  // Time left: the 48 hours are added to the expiry, and again on a second call.
  w.advance(10 * HOUR);
  const r = await extendVia(w, o.id);
  assertEquals(r.status, 200);
  const once = (await r.json()) as Order;
  assertEquals([once.status, once.expiresAt], ['pending', new Date(start + 96 * HOUR).toISOString()]);
  assertEquals((await w.get(o.id))!.expiresAt, once.expiresAt);
  assertEquals(((await (await extendVia(w, o.id)).json()) as Order).expiresAt, new Date(start + 144 * HOUR).toISOString());
  // Stock stays held, and the job leaves it alone at the old expiry.
  w.advance(40 * HOUR);
  assertEquals(await w.orders.expireDue(), []);
  assertEquals(await w.stock(), 99);

  // Time up but the job has not run: 48 hours from now, not from the old expiry.
  const late = (await (await w.place(w.orderBody())).json()) as Order;
  w.advance(60 * HOUR); // 12 hours past this order's expiry, the job has not run
  const nowMs = Date.parse('2026-06-01T10:00:00.000Z') + 110 * HOUR;
  assertEquals(((await (await extendVia(w, late.id)).json()) as Order).expiresAt, new Date(nowMs + 48 * HOUR).toISOString());
  assertEquals(await w.orders.expireDue(), []);
  assertEquals((await w.get(late.id))!.status, 'pending');
  // Left alone, it still expires at the new time.
  w.advance(48 * HOUR + 1);
  assert((await w.orders.expireDue()).includes(late.id));
  assertEquals((await w.get(late.id))!.status, 'cancelled');
  // And a cancelled order cannot be extended back.
  assertEquals((await extendVia(w, late.id)).status, 409);
});

Deno.test('extend route: anything but a pending order with an expiry gives 409 with the status, 404 for unknown ids', async () => {
  const w = await timed(createFakeProvider(crypto.randomUUID()));
  const paid = await orderAt(w, 'paid');
  const packed = await orderAt(w, 'packed');
  const cancelled = await orderAt(w, 'pending');
  await w.orders.cancel(cancelled);
  const online = (await (await w.place(w.orderBody({ paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } }))).json()) as Order;
  const noExpiry = await orderAt(w, 'pending');
  w.orders.patch(noExpiry, { expiresAt: null });
  const before = new Map<string, string | null | undefined>();
  for (const [id, status] of [[paid, 'paid'], [packed, 'packed'], [cancelled, 'cancelled'], [online.id, 'awaiting_payment'], [noExpiry, 'pending']]) {
    before.set(id, (await w.get(id))!.expiresAt);
    const r = await extendVia(w, id);
    assertEquals(r.status, 409, status);
    assertEquals((await r.json()).status, status);
    assertEquals((await w.get(id))!.expiresAt, before.get(id), status);
  }
  w.advance(31 * MIN);
  await w.orders.expireDue();
  assertEquals((await extendVia(w, online.id)).status, 409); // now expired
  assertEquals((await extendVia(w, ZERO)).status, 404);
  assertEquals((await extendVia(w, 'not-a-uuid')).status, 404);
});

// --- the public order page ---------------------------------------------------
const PRIVATE_VALUES = ['Thandi M', '82 123 4567', '0821234567', 'thandi@example.com', 'Leave at gate', '12 Long Street', 'Flat 4', 'Gardens', 'Cape Town', '8001'];

/** An online order with delivery to a door, a note and an email, with a stored payment link and a flag. */
async function fullOrder(w: Timed) {
  const body = w.orderBody({
    paymentMethod: 'online',
    delivery: { method: 'door', address: HOME_ADDRESS },
    customer: { ...customer, email: 'thandi@example.com' },
  }, 2);
  const o = (await (await w.place(body)).json()) as Order;
  const pay = await w.app.request(`${P}/orders/${o.id}/pay`, { method: 'POST' });
  assertEquals(pay.status, 200);
  const { redirectUrl } = (await pay.json()) as { redirectUrl: string };
  assert(redirectUrl);
  return { o, redirectUrl };
}

Deno.test('public order: only the listed fields, and every private field is absent, one by one', async () => {
  const fake = createFakeProvider(crypto.randomUUID());
  const w = await timed(fake);
  const { o, redirectUrl } = await fullOrder(w);
  w.orders.patch(o.id, { paymentFlag: 'refund_due', paidAt: '2026-06-01T10:05:00.000Z', tracking: { courier: 'Aramex', number: 'T1', url: 'https://t.example/1' } });
  const stored = (await w.get(o.id))!;
  // The admin view does hold the private data, so the test is not vacuous.
  assertEquals([stored.customer.phone, stored.customer.email, stored.customer.name, stored.customer.note], ['+27 82 123 4567', 'thandi@example.com', 'Thandi M', 'Leave at gate']);
  assertEquals(stored.delivery?.address, HOME_ADDRESS);
  assertEquals(stored.paymentFlag, 'refund_due');
  assert((await w.orders.paymentInfo(o.id))!.paymentUrl);

  const r = await w.app.request(`${P}/orders/${o.id}/public`); // no token at all
  assertEquals(r.status, 200);
  assertEquals(r.headers.get('Cache-Control'), 'no-store');
  const text = await r.text();
  const pub = JSON.parse(text);

  assertEquals(Object.keys(pub).sort(), [
    'createdAt', 'delivery', 'deliveryFee', 'expiresAt', 'id', 'lines', 'paymentMethod', 'ref', 'status', 'total', 'tracking',
  ]);
  assertEquals(pub.id, o.id);
  assertEquals(pub.ref, o.ref);
  assertEquals([pub.status, pub.deliveryFee, pub.total, pub.paymentMethod], ['awaiting_payment', 85, 105, 'online']);
  assertEquals(pub.delivery, { method: 'door' });
  assertEquals(pub.tracking, { courier: 'Aramex', number: 'T1', url: 'https://t.example/1' });
  assertEquals(pub.expiresAt, stored.expiresAt);
  assertEquals(pub.lines, [{ name: 'Tee', size: 'M', color: 'Black', quantity: 2, subtotal: 20 }]);

  // Field by field, at any depth.
  const keys = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        keys.add(k);
        walk(x);
      }
    }
  };
  walk(pub);
  // (A line's own "name" is allowed and checked below; a customer's name is covered by the values check.)
  for (const forbidden of ['customer', 'phone', 'email', 'note', 'address', 'line1', 'line2', 'suburb', 'city',
    'postalCode', 'paymentFlag', 'paymentUrl', 'payment_url', 'paymentReference', 'paidAt', 'productId', 'variantId', 'sku', 'price']) {
    assert(!keys.has(forbidden), `public order has key ${forbidden}`);
  }
  assertEquals(pub.lines.flatMap((l: Record<string, unknown>) => Object.keys(l)).filter((k: string) => !['name', 'size', 'color', 'quantity', 'subtotal'].includes(k)), []);
  assert(!('customer' in pub) && !('phone' in pub) && !('email' in pub) && !('note' in pub));
  assert(!('address' in pub) && !('address' in pub.delivery) && !('paymentFlag' in pub) && !('paymentUrl' in pub));
  // And none of the values, anywhere in the text.
  for (const v of [...PRIVATE_VALUES, redirectUrl, 'refund_due', 'amount_mismatch', stored.lines[0].variantId!, stored.lines[0].sku!]) {
    assert(!text.includes(v), `public order text contains ${v}`);
  }
});

Deno.test('public order: a locker shows its name, collection only the method, no delivery gives null; a plain WhatsApp order has no payment link', async () => {
  const w = await timed();
  const locker = (await (await w.place(w.orderBody({ delivery: { method: 'locker', locker: 'Pudo Cape Quarter' } }))).json()) as Order;
  const collect = (await (await w.place(w.orderBody({ delivery: { method: 'collect' } }))).json()) as Order;
  const none = (await (await w.place(w.orderBody())).json()) as Order;
  const get = async (id: string) => (await (await w.app.request(`${P}/orders/${id}/public`)).json());
  assertEquals((await get(locker.id)).delivery, { method: 'locker', locker: 'Pudo Cape Quarter' });
  assertEquals((await get(locker.id)).deliveryFee, 55);
  assertEquals((await get(collect.id)).delivery, { method: 'collect' });
  const plain = await get(none.id);
  assertEquals([plain.delivery, plain.tracking, plain.deliveryFee, plain.paymentMethod, plain.status], [null, null, 0, 'whatsapp', 'pending']);
  assertEquals(plain.expiresAt, none.expiresAt);
  // The same id in capitals works, as the UUID is the capability.
  assertEquals((await w.app.request(`${P}/orders/${none.id.toUpperCase()}/public`)).status, 200);
});

Deno.test('public order: unknown and malformed ids give the same 404, and toPublicOrder drops anything not listed', async () => {
  const w = await timed();
  for (const id of [ZERO, crypto.randomUUID(), 'not-a-uuid', '12345678', `${ZERO}x`]) {
    const r = await w.app.request(`${P}/orders/${id}/public`);
    assertEquals(r.status, 404, id);
    assertEquals(await r.json(), { error: 'Order not found' });
  }
  const o = (await (await w.place(w.orderBody({ customer: { ...customer, email: 'a@b.co' } }))).json()) as Order;
  const stored = (await w.get(o.id))!;
  const polluted = {
    ...stored,
    secret: 'x', paymentUrl: 'https://pay.example/1', paymentReference: 'ref', passport: '1',
    lines: stored.lines.map((l) => ({ ...l, internalCost: 3 })),
    delivery: { method: 'door', fee: 85, address: HOME_ADDRESS, locker: 'L1', extra: 'x' },
    tracking: { courier: 'C', number: null, url: null, secret: 'x' },
  } as unknown as Order;
  const pub = toPublicOrder(polluted);
  assertEquals(Object.keys(pub).sort(), ['createdAt', 'delivery', 'deliveryFee', 'expiresAt', 'id', 'lines', 'paymentMethod', 'ref', 'status', 'total', 'tracking']);
  assertEquals(pub.delivery, { method: 'door', locker: 'L1' });
  assertEquals(pub.tracking, { courier: 'C', number: null, url: null });
  assertEquals(Object.keys(pub.lines[0]).sort(), ['color', 'name', 'quantity', 'size', 'subtotal']);
  assert(!JSON.stringify(pub).includes('secret'));
  // An order from an older server, without the newer fields, is filled with the empty values.
  const old = toPublicOrder({ id: 'i', ref: 'R', createdAt: 'c', status: 'pending', lines: [], total: 5, customer: { name: 'N', phone: '1' } });
  assertEquals(old, { id: 'i', ref: 'R', createdAt: 'c', status: 'pending', lines: [], deliveryFee: 0, total: 5, delivery: null, tracking: null, expiresAt: null, paymentMethod: null });
});

// --- the public lookup -------------------------------------------------------
const lookupVia = (w: Timed, body: unknown, headers: Record<string, string> = {}) =>
  w.app.request(`${P}/orders/lookup`, { method: 'POST', headers: { ...JSON_H, ...headers }, body: JSON.stringify(body) });
const NO_ORDER = { error: 'No order found' };

Deno.test('lookup: the reference in any case with the phone in either format finds the order id; no token is needed', async () => {
  const w = await timed();
  const o = (await (await w.place(w.orderBody())).json()) as Order; // phone +27 82 123 4567
  assertEquals(o.ref.length, 8);
  for (const phone of ['0821234567', '+27821234567', '+27 82 123 4567', '27821234567', '082 123 4567', '(082) 123-4567', '821234567']) {
    for (const ref of [o.ref, o.ref.toLowerCase(), ` ${o.ref.toLowerCase()} `]) {
      const r = await lookupVia(w, { ref, phone });
      assertEquals(r.status, 200, `${ref} / ${phone}`);
      assertEquals(await r.json(), { id: o.id });
    }
  }
  // A phone saved in the local format is found with the international one.
  const local = (await (await w.place(w.orderBody({ customer: { name: 'Sipho', phone: '0731112222' } }))).json()) as Order;
  assertEquals(await (await lookupVia(w, { ref: local.ref, phone: '+27731112222' })).json(), { id: local.id });
  // The id found works on the public page.
  const page = await w.app.request(`${P}/orders/${o.id}/public`);
  assertEquals(page.status, 200);
});

Deno.test('lookup: a wrong ref and a wrong phone give the same 404, and so does every malformed input', async () => {
  const w = await timed();
  const o = (await (await w.place(w.orderBody())).json()) as Order;
  const wrongRef = await lookupVia(w, { ref: o.ref === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA', phone: '0821234567' });
  const wrongPhone = await lookupVia(w, { ref: o.ref, phone: '0821234568' });
  const bothWrong = await lookupVia(w, { ref: 'AAAAAAAA', phone: '0000000000' });
  const wrongRefText = await wrongRef.text();
  assertEquals([wrongRef.status, wrongPhone.status, bothWrong.status], [404, 404, 404]);
  assertEquals(JSON.parse(wrongRefText), NO_ORDER);
  assertEquals(await wrongPhone.text(), wrongRefText);
  assertEquals(await bothWrong.text(), wrongRefText);
  assertEquals(wrongRef.headers.get('content-type'), wrongPhone.headers.get('content-type'));
  for (const [ref, phone] of [['', ''], [o.ref.slice(0, 7), '0821234567'], [`${o.ref}0`, '0821234567'], [o.ref, ''], [o.ref, '1234'], [o.ref, 'abc'],
    [o.ref, '0731112222'], [o.ref, '1234567'], [o.ref, '21234567']]) {
    const r = await lookupVia(w, { ref, phone });
    assertEquals(r.status, 404, `${ref} / ${phone}`);
    assertEquals(await r.json(), NO_ORDER);
  }
  // An unreadable body is not a lookup at all.
  assertEquals((await lookupVia(w, { ref: o.ref })).status, 400);
  assertEquals((await lookupVia(w, { ref: 5, phone: 5 })).status, 400);
  assertEquals((await lookupVia(w, [])).status, 400);
  assertEquals((await lookupVia(w, { ref: o.ref, phone: '1'.repeat(41) })).status, 400);
  assertEquals((await w.app.request(`${P}/orders/lookup`, { method: 'POST', headers: JSON_H, body: '{nope' })).status, 400);
});

Deno.test('lookup: the same ref and phone twice finds the newest; other statuses are found too', async () => {
  const w = await timed();
  const o = (await (await w.place(w.orderBody())).json()) as Order;
  await w.orders.cancel(o.id);
  assertEquals(await (await lookupVia(w, { ref: o.ref, phone: '0821234567' })).json(), { id: o.id });
});

Deno.test('lookup: 10 per address per hour, the 11th gets 429 with Retry-After, found or not; other addresses are free', async () => {
  const w = await timed();
  const o = (await (await w.place(w.orderBody())).json()) as Order;
  const ip = w.at('203.0.113.50');
  for (let i = 0; i < 10; i++) {
    const r = await lookupVia(w, { ref: o.ref, phone: i % 2 ? '0000000000' : '0821234567' }, ip);
    assertEquals(r.status, i % 2 ? 404 : 200, `lookup ${i + 1}`);
  }
  const eleventh = await lookupVia(w, { ref: o.ref, phone: '0821234567' }, ip);
  assertEquals(eleventh.status, 429);
  assertEquals(eleventh.headers.get('Retry-After'), '3600');
  assert((await eleventh.json()).error);
  assertEquals((await lookupVia(w, { ref: o.ref, phone: '0821234567' }, ip)).status, 429);
  // Other addresses, v4 or v6, are independent.
  assertEquals((await lookupVia(w, { ref: o.ref, phone: '0821234567' }, w.at('203.0.113.51'))).status, 200);
  assertEquals((await lookupVia(w, { ref: o.ref, phone: '0821234567' }, w.at('2001:db8::5'))).status, 200);
  // Placing orders is a separate count: the same address can still order.
  assertEquals((await w.place(w.orderBody(), ip)).status, 201);
});

Deno.test('lookup: no address, or one that is not an address, is never limited; x-forwarded-for is not read', async () => {
  const w = await timed();
  const o = (await (await w.place(w.orderBody())).json()) as Order;
  const hit = { ref: o.ref, phone: '0821234567' };
  for (let i = 0; i < 15; i++) assertEquals((await lookupVia(w, hit)).status, 200, `no header ${i}`);
  for (let i = 0; i < 15; i++) assertEquals((await lookupVia(w, hit, w.at('nope, 1.2.3.4'))).status, 200, `bad header ${i}`);
  for (let i = 0; i < 15; i++) assertEquals((await lookupVia(w, hit, { 'x-forwarded-for': '198.51.100.7' })).status, 200, `xff ${i}`);
  // A spoofed x-forwarded-for neither shares nor escapes the real address's count.
  const spoof = (n: number) => ({ 'x-forwarded-for': `198.51.100.${n}`, ...w.at('203.0.113.60') });
  for (let i = 0; i < 10; i++) assertEquals((await lookupVia(w, hit, spoof(i))).status, 200);
  assertEquals((await lookupVia(w, hit, spoof(99))).status, 429);
});

Deno.test('lookup: the window rolls, and a refused lookup does not extend the wait', async () => {
  const w = await timed();
  const o = (await (await w.place(w.orderBody())).json()) as Order;
  const hit = { ref: o.ref, phone: '0821234567' };
  const ip = w.at('203.0.113.70');
  for (let i = 0; i < 4; i++) await lookupVia(w, hit, ip);
  w.advance(30 * MIN);
  for (let i = 0; i < 6; i++) assertEquals((await lookupVia(w, hit, ip)).status, 200);
  assertEquals((await lookupVia(w, hit, ip)).status, 429);
  w.advance(20 * MIN);
  assertEquals((await lookupVia(w, hit, ip)).status, 429); // refused ones were not logged
  w.advance(10 * MIN + 1); // the first four are now older than an hour; six remain
  for (let i = 0; i < 4; i++) assertEquals((await lookupVia(w, hit, ip)).status, 200, `after the window ${i}`);
  assertEquals((await lookupVia(w, hit, ip)).status, 429);
  w.advance(HOUR + 1);
  assertEquals((await lookupVia(w, hit, ip)).status, 200);
});

// ---------------------------------------------------------------------------
// Order emails, /config and the payment return URL
// ---------------------------------------------------------------------------
const SITE = 'https://shop.example.com';

async function mailShop(opts: { mailer?: Mailer | null; siteUrl?: string | null; payments?: PaymentProvider | null } = {}) {
  const fake = createFakeMailer();
  const payments = opts.payments ?? null;
  const deps = await createMemoryDeps(isAdmin, true, payments);
  const mailer = opts.mailer === undefined ? fake : opts.mailer;
  const siteUrl = opts.siteUrl === undefined ? SITE : opts.siteUrl;
  const app = createApp({ ...deps, mailer, siteUrl, uploadImage: () => Promise.resolve('') });
  return { app, fake };
}
const withEmail = { ...customer, email: 'thandi@example.com' };
const adminPostTo = (app: App, path: string, body?: unknown) =>
  app.request(`${P}${path}`, { method: 'POST', headers: ADMIN, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

Deno.test('email: order received is sent once to the customer, without the street address or phone', async () => {
  const { app, fake } = await mailShop();
  const body = { ...oneTee(), customer: withEmail, delivery: { method: 'door', address: ADDRESS } };
  const r = await placeOrder(app, body);
  assertEquals(r.status, 201);
  const o = (await r.json()) as Order;
  assertEquals(fake.sent.length, 1);
  const m = fake.sent[0];
  assertEquals(m.to, 'thandi@example.com');
  assert(m.subject.includes(o.ref));
  for (const part of ['4Nguru', o.ref, '1 x ', 'R85.00', `Total: R${o.total.toFixed(2)}`, `${SITE}/order/${o.id}`]) {
    assert(m.text.includes(part), part);
  }
  for (const secret of ['Main Rd', 'Sea Point', '8005', '82 123 4567', 'Leave at gate']) assert(!m.text.includes(secret), secret);
  // A retried POST (same id) is not announced twice.
  assertEquals((await placeOrder(app, body)).status, 200);
  assertEquals(fake.sent.length, 1);
});

Deno.test('email: no address on the order sends nothing; no siteUrl leaves out the link', async () => {
  const a = await mailShop();
  assertEquals((await placeOrder(a.app, oneTee())).status, 201);
  assertEquals(a.fake.sent.length, 0);
  const b = await mailShop({ siteUrl: null });
  assertEquals((await placeOrder(b.app, { ...oneTee(), customer: withEmail })).status, 201);
  assertEquals(b.fake.sent.length, 1);
  assert(!b.fake.sent[0].text.includes('/order/'));
});

Deno.test('email: payment received on the webhook, once; a repeat webhook sends nothing', async () => {
  const fake = createFakeProvider(crypto.randomUUID());
  const { app, fake: mail } = await mailShop({ payments: fake });
  const placed = await deliveryOrder(app, { paymentMethod: 'online', delivery: { method: 'collect' }, customer: withEmail });
  const o = (await placed.json()) as Order;
  assertEquals(mail.sent.length, 1); // order received
  assertEquals((await app.request(`${P}/orders/${o.id}/pay`, { method: 'POST' })).status, 200);
  const paid = await fake.pay(o.id);
  const hook = () => app.request(`${P}/payments/webhook`, { method: 'POST', headers: paid.headers, body: paid.body });
  assertEquals((await hook()).status, 200);
  assertEquals(mail.sent.length, 2);
  assertEquals(mail.sent[1].to, 'thandi@example.com');
  assert(mail.sent[1].subject.includes('payment received'));
  assert(mail.sent[1].text.includes(`${SITE}/order/${o.id}`));
  assertEquals((await hook()).status, 200);
  assertEquals(mail.sent.length, 2);
});

Deno.test('email: mark-paid sends payment received once; a second mark-paid sends nothing', async () => {
  const { app, fake } = await mailShop();
  const o = (await (await placeOrder(app, { ...oneTee(), customer: withEmail })).json()) as Order;
  assertEquals((await adminPostTo(app, `/orders/${o.id}/mark-paid`)).status, 200);
  assertEquals(fake.sent.length, 2);
  assert(fake.sent[1].subject.includes('payment received'));
  assertEquals((await adminPostTo(app, `/orders/${o.id}/mark-paid`)).status, 409);
  assertEquals(fake.sent.length, 2);
  // No email on the order: marking it paid sends nothing.
  const bare = (await (await placeOrder(app, oneTee())).json()) as Order;
  assertEquals((await adminPostTo(app, `/orders/${bare.id}/mark-paid`)).status, 200);
  assertEquals(fake.sent.length, 2);
});

Deno.test('email: shipped sends courier, number and link once; a no-op status sends nothing', async () => {
  const { app, fake } = await mailShop();
  const o = (await (await placeOrder(app, { ...oneTee(), customer: withEmail, delivery: { method: 'door', address: ADDRESS } })).json()) as Order;
  await adminPostTo(app, `/orders/${o.id}/mark-paid`);
  assertEquals((await adminPostTo(app, `/orders/${o.id}/status`, { status: 'packed' })).status, 200);
  assertEquals(fake.sent.length, 2); // packed sends nothing
  const t = await adminPostTo(app, `/orders/${o.id}/tracking`, { courier: 'The Courier Guy', number: 'TCG123', url: 'https://track.example.com/TCG123' });
  assertEquals(t.status, 200);
  assertEquals((await adminPostTo(app, `/orders/${o.id}/status`, { status: 'shipped' })).status, 200);
  assertEquals(fake.sent.length, 3);
  const m = fake.sent[2];
  assertEquals(m.to, 'thandi@example.com');
  for (const part of ['has shipped', 'The Courier Guy', 'TCG123', 'https://track.example.com/TCG123', `${SITE}/order/${o.id}`]) {
    assert((m.subject + m.text).includes(part), part);
  }
  assert(!m.text.includes('Main Rd'));
  const again = await adminPostTo(app, `/orders/${o.id}/status`, { status: 'shipped' });
  assertEquals(again.status, 409);
  assertEquals(fake.sent.length, 3);
});

Deno.test('email: a store that reports changed false (no-op status, mark-paid) sends nothing', async () => {
  const fake = createFakeMailer();
  const deps = await createMemoryDeps(isAdmin, true);
  const o = (await deps.orders.place(crypto.randomUUID(), [{ productId: '1', quantity: 1 }], withEmail)) as { order: Order };
  const orders = {
    ...deps.orders,
    setStatus: (id: string, status: OrderStatus, from?: OrderStatus) =>
      deps.orders.setStatus(id, status, from).then((r) => (r.ok ? { ...r, changed: false } : r)),
  };
  const app = createApp({ ...deps, orders, mailer: fake, siteUrl: SITE });
  assertEquals((await adminPostTo(app, `/orders/${o.order.id}/mark-paid`)).status, 200);
  assertEquals((await adminPostTo(app, `/orders/${o.order.id}/status`, { status: 'packed' })).status, 200);
  assertEquals(fake.sent.length, 0);
});

Deno.test('email: a mailer that throws changes neither the response nor the order, and logs no address', async () => {
  const boom: Mailer = {
    send: () => Promise.reject(new Error('down thandi@example.com')),
    sendBatch: () => Promise.reject(new Error('down thandi@example.com')),
  };
  const { app } = await mailShop({ mailer: boom, payments: createFakeProvider(crypto.randomUUID()) });
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(' '));
  try {
    const r = await placeOrder(app, { ...oneTee(), customer: withEmail });
    assertEquals(r.status, 201);
    const o = (await r.json()) as Order;
    const mp = await adminPostTo(app, `/orders/${o.id}/mark-paid`);
    assertEquals(mp.status, 200);
    assertEquals(((await mp.json()) as Order).status, 'paid');
    const listed = ((await (await app.request(`${P}/orders`, { headers: ADMIN })).json()) as Order[]).find((x) => x.id === o.id)!;
    assertEquals(listed.status, 'paid');
    assertEquals(logged.length, 2);
    assertEquals(logged[0], `email failed for order ${o.ref}`);
    assert(logged.every((l) => !l.includes('@') && !l.includes('down')));
  } finally {
    console.error = orig;
  }
});

Deno.test('email: without a mailer every route still works', async () => {
  const { app } = await mailShop({ mailer: null });
  const o = (await (await placeOrder(app, { ...oneTee(), customer: withEmail })).json()) as Order;
  assertEquals((await adminPostTo(app, `/orders/${o.id}/mark-paid`)).status, 200);
  assertEquals((await adminPostTo(app, `/orders/${o.id}/status`, { status: 'packed' })).status, 200);
});

Deno.test('config: onlinePayments follows the payment provider', async () => {
  const off = await setup();
  const r = await off.request(`${P}/config`);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { onlinePayments: false });
  const on = await setup(createFakeProvider(crypto.randomUUID()));
  assertEquals(await (await on.request(`${P}/config`)).json(), { onlinePayments: true });
});

Deno.test('pay: the return URL is passed only when siteUrl is set', async () => {
  for (const siteUrl of [SITE, null]) {
    const fake = createFakeProvider(crypto.randomUUID());
    const { app } = await mailShop({ payments: fake, siteUrl });
    const o = (await (await deliveryOrder(app, { paymentMethod: 'online', delivery: { method: 'collect' }, customer: withEmail })).json()) as Order;
    assertEquals((await app.request(`${P}/orders/${o.id}/pay`, { method: 'POST' })).status, 200);
    assertEquals(fake.starts[0].callbackUrl, siteUrl ? `${SITE}/order/${o.id}?paid=1` : undefined);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/orders: the owner enters an order (no unit cap, no address limit, online = a 48-hour payment link)
// ---------------------------------------------------------------------------
Deno.test('admin orders: needs an admin (401 without a token, 403 for a non-admin) and takes no stock when refused', async () => {
  const w = await timed();
  const body = w.orderBody();
  const send = (headers: Record<string, string>) =>
    w.app.request(`${P}/admin/orders`, { method: 'POST', headers, body: JSON.stringify(body) });
  assertEquals((await send(JSON_H)).status, 401);
  assertEquals((await send({ ...JSON_H, Authorization: 'Bearer user' })).status, 403);
  assertEquals(await w.stock(), 100);
  assertEquals((await w.orders.list()).length, 0);
});

const adminOrder = (w: Awaited<ReturnType<typeof timed>>, body: unknown, headers: Record<string, string> = {}) =>
  w.app.request(`${P}/admin/orders`, { method: 'POST', headers: { ...ADMIN, ...headers }, body: JSON.stringify(body) });

Deno.test('admin orders: 11 or more units are accepted where POST /orders refuses them; per-line limits stay', async () => {
  const w = await timed();
  assertEquals((await w.place(w.orderBody({}, 11))).status, 400); // the public route keeps its cap
  const big = await adminOrder(w, { ...w.orderBody(), items: [{ productId: 'tee', quantity: 40 }, { productId: 'tee', quantity: 30 }] });
  assertEquals(big.status, 201);
  const o = (await big.json()) as Order;
  assertEquals(o.status, 'pending');
  assertEquals(o.total, 700);
  assertEquals(await w.stock(), 30);
  // Still checked: one line over 50, an empty list, bad customer data.
  assertEquals((await adminOrder(w, w.orderBody({}, 51))).status, 400);
  assertEquals((await adminOrder(w, { ...w.orderBody(), items: [] })).status, 400);
  assertEquals((await adminOrder(w, { ...w.orderBody(), customer: { name: '', phone: '1' } })).status, 400);
  assertEquals((await adminOrder(w, w.orderBody({ delivery: { method: 'door' } }))).status, 400);
  const bad = await w.app.request(`${P}/admin/orders`, { method: 'POST', headers: ADMIN, body: '{nope' });
  assertEquals(bad.status, 400);
  assertEquals(await w.stock(), 30);
});

Deno.test('admin orders: prices, delivery fee and stock rules are the server\'s; a shortfall is 409 and takes nothing; unknown products and delivery are 400', async () => {
  const w = await timed();
  const withFee = await adminOrder(w, w.orderBody({ delivery: { method: 'locker', locker: 'PUDO Sea Point' }, price: 1, total: 1 }, 2));
  assertEquals(withFee.status, 201);
  const o = (await withFee.json()) as Order;
  assertEquals([o.deliveryFee, o.total], [55, 75]);
  assertEquals(o.delivery?.locker, 'PUDO Sea Point');
  assertEquals(await w.stock(), 98);

  const short = await adminOrder(w, { ...w.orderBody(), items: [{ productId: 'tee', quantity: 50 }, { productId: 'tee', quantity: 49 }] });
  assertEquals(short.status, 409);
  const sb = await short.json();
  assertEquals(sb.error, 'Insufficient stock');
  assertEquals(sb.short.length, 1);
  assertEquals([sb.short[0].productId, sb.short[0].requested, sb.short[0].available], ['tee', 99, 98]);
  assertEquals(await w.stock(), 98);
  assertEquals((await w.orders.list()).length, 1);

  const missing = await adminOrder(w, { ...w.orderBody(), items: [{ productId: 'nope', quantity: 1 }] });
  assertEquals(missing.status, 400);
  assertEquals((await missing.json()).missing, ['nope']);
  const noDelivery = await adminOrder(w, w.orderBody({ delivery: { method: 'collect' } }));
  assertEquals(noDelivery.status, 201);
});

Deno.test('admin orders: a retried id is one order (200, same body, stock taken once)', async () => {
  const w = await timed();
  const body = w.orderBody({}, 3);
  const first = await adminOrder(w, body);
  assertEquals(first.status, 201);
  const again = await adminOrder(w, body);
  assertEquals(again.status, 200);
  assertEquals(await again.json(), await first.json());
  assertEquals(await w.stock(), 97);
});

Deno.test('admin orders: no address limit, whatever cf-connecting-ip says; the public route is still limited', async () => {
  const w = await timed();
  const ip = w.at('203.0.113.50');
  for (let i = 0; i < 8; i++) assertEquals((await adminOrder(w, w.orderBody(), ip)).status, 201, `order ${i + 1}`);
  // Nothing was written to the address log: the public route still allows its own 5 from the same address.
  for (let i = 0; i < 5; i++) assertEquals((await w.place(w.orderBody(), ip)).status, 201, `public order ${i + 1}`);
  assertEquals((await w.place(w.orderBody(), ip)).status, 429);
  // And the admin route is still open for that address.
  assertEquals((await adminOrder(w, w.orderBody(), ip)).status, 201);
  assertEquals(await w.stock(), 100 - 8 - 5 - 1);
});

Deno.test('admin orders: online is refused with 503 before any stock is taken when there is no provider', async () => {
  const w = await timed();
  const r = await adminOrder(w, w.orderBody({ paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } }));
  assertEquals(r.status, 503);
  assertEquals(await r.json(), { error: 'Online payment is not available' });
  assertEquals(await w.stock(), 100);
  assertEquals((await w.orders.list()).length, 0);
  assertEquals((await adminOrder(w, w.orderBody({ paymentMethod: 'whatsapp' }))).status, 201);
});

Deno.test('admin orders: online needs an email (400) and an unknown payment method is 400', async () => {
  const w = await timed(createFakeProvider(crypto.randomUUID()));
  const noEmail = await adminOrder(w, w.orderBody({ paymentMethod: 'online' }));
  assertEquals(noEmail.status, 400);
  assertEquals(await noEmail.json(), { error: 'customer email is needed to pay online' });
  assertEquals((await adminOrder(w, w.orderBody({ paymentMethod: 'online', customer: { ...customer, email: 'nope' } }))).status, 400);
  assertEquals((await adminOrder(w, w.orderBody({ paymentMethod: 'cash' }))).status, 400);
  assertEquals(await w.stock(), 100);
});

Deno.test('admin orders: an online order is awaiting_payment with a 48-hour hold, set once; a retry does not extend it', async () => {
  const w = await timed(createFakeProvider(crypto.randomUUID()));
  const t0 = Date.parse('2026-06-01T10:00:00.000Z');
  const body = w.orderBody({ paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } }, 12);
  const first = await adminOrder(w, body);
  assertEquals(first.status, 201);
  const o = (await first.json()) as Order;
  assertEquals([o.status, o.paymentMethod], ['awaiting_payment', 'online']);
  assertEquals(o.expiresAt, new Date(t0 + 48 * HOUR).toISOString());
  assertEquals(await w.stock(), 88);

  // 47 hours later nothing has expired; a retry of the same id leaves the expiry where it was.
  w.advance(47 * HOUR);
  assertEquals(await w.orders.expireDue(), []);
  const retry = await adminOrder(w, body);
  assertEquals(retry.status, 200);
  assertEquals(((await retry.json()) as Order).expiresAt, o.expiresAt);
  assertEquals((await w.get(o.id))?.expiresAt, o.expiresAt);

  // Past the 48 hours it expires and the stock goes back.
  w.advance(HOUR + MIN);
  assertEquals(await w.orders.expireDue(), [o.id]);
  assertEquals((await w.get(o.id))?.status, 'expired');
  assertEquals(await w.stock(), 100);
});

Deno.test('admin orders: the public route keeps its 30-minute hold for online orders; a whatsapp order from the admin keeps 48 hours', async () => {
  const w = await timed(createFakeProvider(crypto.randomUUID()));
  const t0 = Date.parse('2026-06-01T10:00:00.000Z');
  const online = { paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } };
  const pub = (await (await w.place(w.orderBody(online))).json()) as Order;
  assertEquals(pub.expiresAt, new Date(t0 + 30 * MIN).toISOString());
  const wa = (await (await adminOrder(w, w.orderBody())).json()) as Order;
  assertEquals([wa.status, wa.expiresAt], ['pending', new Date(t0 + 48 * HOUR).toISOString()]);
});

Deno.test('admin orders: setPaymentWindow only touches an awaiting_payment order', async () => {
  const w = await timed(createFakeProvider(crypto.randomUUID()));
  const online = { paymentMethod: 'online', customer: { ...customer, email: 't@example.com' } };
  const pub = (await (await w.place(w.orderBody(online))).json()) as Order;
  const ok = await w.orders.setPaymentWindow(pub.id, 48);
  assertEquals(ok.ok && ok.order.expiresAt, new Date(Date.parse('2026-06-01T10:00:00.000Z') + 48 * HOUR).toISOString());
  const wa = (await (await adminOrder(w, w.orderBody())).json()) as Order;
  const before = (await w.get(wa.id))?.expiresAt;
  const refused = await w.orders.setPaymentWindow(wa.id, 1);
  assertEquals(refused.ok, false);
  assertEquals(!refused.ok && refused.reason, 'bad_status');
  assertEquals((await w.get(wa.id))?.expiresAt, before);
  assertEquals(await w.orders.setPaymentWindow(crypto.randomUUID(), 48), { ok: false, reason: 'not_found' });
});
