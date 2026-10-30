import { assert, assertEquals } from '@std/assert';
import { createApp } from './app.ts';
import { createLock, memoryKv, memoryOrders, memoryProducts } from './dev.ts';
import type { Deps, Order, Product } from './types.ts';

const P = '/make-server-fbb8f0e1';
const ADMIN = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };

function setup() {
  const kv = memoryKv();
  const lock = createLock();
  const deps: Deps = {
    kv,
    orders: memoryOrders(kv, lock),
    products: memoryProducts(kv, lock),
    isAdmin: (h) =>
      Promise.resolve(
        h === 'Bearer admin' ? 'ok' : h === 'Bearer user' ? 'forbidden' : 'unauthenticated',
      ),
    uploadImage: () => Promise.resolve('https://example.com/img.png'),
  };
  return createApp(deps);
}

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

const post = (app: ReturnType<typeof setup>, body: unknown, headers: Record<string, string> = ADMIN) =>
  app.request(`${P}/products`, { method: 'POST', headers, body: JSON.stringify(body) });

Deno.test('health', async () => {
  const r = await setup().request(`${P}/health`);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { status: 'ok' });
});

Deno.test('cors preflight allows apikey', async () => {
  const r = await setup().request(`${P}/products`, {
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
  const app = setup();
  const a = (await (await app.request(`${P}/products`)).json()) as Product[];
  assertEquals(a.length, 5);
  assertEquals(a.map((p) => p.id), ['1', '2', '3', '4', '5']);
  const b = (await (await app.request(`${P}/products`)).json()) as Product[];
  assertEquals(b.length, 5);
});

Deno.test('get product 200 and 404', async () => {
  const app = setup();
  await app.request(`${P}/products`);
  const ok = await app.request(`${P}/products/2`);
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).name, 'Premium Sports Jersey');
  const nf = await app.request(`${P}/products/nope`);
  assertEquals(nf.status, 404);
  assert((await nf.json()).error);
});

Deno.test('create auth', async () => {
  const app = setup();
  assertEquals((await post(app, validBody, { 'Content-Type': 'application/json' })).status, 401);
  assertEquals(
    (await post(app, validBody, { Authorization: 'Bearer user', 'Content-Type': 'application/json' })).status,
    403,
  );
});

Deno.test('create validation', async () => {
  const app = setup();
  assertEquals((await post(app, { ...validBody, price: -1 })).status, 400);
  assertEquals((await post(app, { ...validBody, price: 'x' })).status, 400);
  assertEquals((await post(app, { ...validBody, images: ['data:image/png;base64,AAAA'] })).status, 400);
  const { name: _n, ...noName } = validBody;
  assertEquals((await post(app, noName)).status, 400);
  const bad = await app.request(`${P}/products`, { method: 'POST', headers: ADMIN, body: '{nope' });
  assertEquals(bad.status, 400);
});

Deno.test('create valid derives image', async () => {
  const app = setup();
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
  const app = setup();
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
  const app = setup();
  const created = (await (await post(app, validBody)).json()) as Product;
  const del = () => app.request(`${P}/products/${created.id}`, { method: 'DELETE', headers: ADMIN });
  assertEquals((await del()).status, 204);
  assertEquals((await del()).status, 404);
});

function upload(app: ReturnType<typeof setup>, file?: File) {
  const fd = new FormData();
  if (file) fd.set('file', file);
  return app.request(`${P}/images`, { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: fd });
}

Deno.test('images', async () => {
  const app = setup();
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
  const r = await setup().request(`${P}/images`, { method: 'POST', body: fd });
  assertEquals(r.status, 401);
});

Deno.test('cart quote', async () => {
  const app = setup();
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
  assertEquals(quote.lines[0].available, 50);
  assertEquals(quote.lines[0].size, 'M');
  assertEquals(quote.total, 70);
  assertEquals((await q({ items: [{ productId: '1', quantity: 0 }] })).status, 400);
  assertEquals((await q({ items: [{ productId: '1', quantity: 1.5 }] })).status, 400);
  assertEquals((await q({ items: [] })).status, 400);
});

Deno.test('internal errors give 500', async () => {
  const deps: Deps = {
    kv: { ...memoryKv(), get: () => Promise.reject(new Error('boom')) },
    orders: memoryOrders(memoryKv()),
    products: memoryProducts(memoryKv()),
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
  const app = setup();
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

const placeOrder = (app: ReturnType<typeof setup>, body: unknown) =>
  app.request(`${P}/orders`, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) });

const stockOf = async (app: ReturnType<typeof setup>, id: string) =>
  ((await (await app.request(`${P}/products/${id}`)).json()) as Product).stock;

const newProduct = async (app: ReturnType<typeof setup>, stock: number) =>
  ((await (await post(app, { ...validBody, stock })).json()) as Product);

Deno.test('order: placed with server prices and decrements stock', async () => {
  const app = setup();
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
  const app = setup();
  const p = await newProduct(app, 5);
  const r = await placeOrder(app, {
    id: crypto.randomUUID(),
    items: [
      { productId: p.id, size: 'M', quantity: 3 },
      { productId: p.id, size: 'L', quantity: 3 },
    ],
    customer,
  });
  assertEquals(r.status, 409);
  const body = await r.json();
  assertEquals(body.error, 'Insufficient stock');
  assertEquals(body.short, [{ productId: p.id, name: 'Hoodie', requested: 6, available: 5 }]);
  assertEquals(await stockOf(app, p.id), 5);
});

Deno.test('order: unknown product gives 400 with missing', async () => {
  const app = setup();
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
  const app = setup();
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
  const app = setup();
  const p = await newProduct(app, 1);
  const mk = () => placeOrder(app, { id: crypto.randomUUID(), items: [{ productId: p.id, quantity: 1 }], customer });
  const results = await Promise.all([mk(), mk()]);
  assertEquals(results.map((r) => r.status).sort(), [201, 409]);
  assertEquals(await stockOf(app, p.id), 0);
});

Deno.test('order: validation', async () => {
  const app = setup();
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
  const app = setup();
  const id = crypto.randomUUID();
  const none = { 'Content-Type': 'application/json' };
  const user = { Authorization: 'Bearer user' };
  assertEquals((await app.request(`${P}/orders`, { headers: none })).status, 401);
  assertEquals((await app.request(`${P}/orders`, { headers: user })).status, 403);
  assertEquals((await app.request(`${P}/orders/${id}/cancel`, { method: 'POST', headers: none })).status, 401);
  assertEquals((await app.request(`${P}/orders/${id}/cancel`, { method: 'POST', headers: user })).status, 403);
});

Deno.test('orders: admin lists newest first, cancel restores stock once', async () => {
  const app = setup();
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
const putProduct = (app: ReturnType<typeof setup>, id: string, body: unknown) =>
  app.request(`${P}/products/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify(body) });

const orderOne = (app: ReturnType<typeof setup>, productId: string, quantity: number) =>
  placeOrder(app, { id: crypto.randomUUID(), items: [{ productId, quantity }], customer });

Deno.test('update: price edit after an order keeps the decremented stock', async () => {
  const app = setup();
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
  const app = setup();
  await app.request(`${P}/products`);
  await orderOne(app, '1', 2);
  const before = (await (await app.request(`${P}/products/1`)).json()) as Product;
  const r = await putProduct(app, '1', { stock: 10, expectedStock: 50 });
  assertEquals(r.status, 409);
  assertEquals(await r.json(), { error: 'Stock changed', stock: 48 });
  assertEquals((await (await app.request(`${P}/products/1`)).json()) as Product, before);
});

Deno.test('update: expectedStock match sets stock', async () => {
  const app = setup();
  await app.request(`${P}/products`);
  await orderOne(app, '1', 2);
  const r = await putProduct(app, '1', { stock: 10, expectedStock: 48 });
  assertEquals(r.status, 200);
  assertEquals(((await r.json()) as Product).stock, 10);
  assertEquals(await stockOf(app, '1'), 10);
});

Deno.test('update: explicit stock without expectedStock is still allowed', async () => {
  const app = setup();
  await app.request(`${P}/products`);
  await orderOne(app, '1', 2);
  const r = await putProduct(app, '1', { stock: 10 });
  assertEquals(r.status, 200);
  assertEquals(await stockOf(app, '1'), 10);
});

Deno.test('update: invalid expectedStock gives 400', async () => {
  const app = setup();
  await app.request(`${P}/products`);
  for (const bad of [-1, 'x', 1.5, null]) {
    const r = await putProduct(app, '1', { stock: 10, expectedStock: bad });
    assertEquals(r.status, 400);
    assertEquals(await r.json(), { error: 'expectedStock must be a whole number of 0 or more' });
  }
  assertEquals(await stockOf(app, '1'), 50);
});

Deno.test('update: concurrent order and edit lose neither change', async () => {
  const app = setup();
  await app.request(`${P}/products`);
  const [o, u] = await Promise.all([orderOne(app, '1', 1), putProduct(app, '1', { name: 'Renamed' })]);
  assertEquals(o.status, 201);
  assertEquals(u.status, 200);
  const p = (await (await app.request(`${P}/products/1`)).json()) as Product;
  assertEquals(p.stock, 49);
  assertEquals(p.name, 'Renamed');
});

Deno.test('update: unknown id gives 404', async () => {
  const app = setup();
  const r = await putProduct(app, 'missing', { price: 1, expectedStock: 3, stock: 2 });
  assertEquals(r.status, 404);
  assertEquals(await r.json(), { error: 'Product not found' });
});
