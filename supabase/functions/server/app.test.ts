import { assert, assertEquals } from '@std/assert';
import { createApp } from './app.ts';
import { createMemoryDeps } from './dev.ts';
import type { Category, Deps, Order, Product } from './types.ts';

const P = '/make-server-fbb8f0e1';
const ADMIN = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };

const isAdmin: Deps['isAdmin'] = (h) =>
  Promise.resolve(h === 'Bearer admin' ? 'ok' : h === 'Bearer user' ? 'forbidden' : 'unauthenticated');

// In-memory stores seeded with the five sample categories and products (dev.ts and tests only).
async function setup() {
  const deps = await createMemoryDeps(isAdmin, true);
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
