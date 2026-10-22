import { assert, assertEquals } from '@std/assert';
import { createApp } from './app.ts';
import { memoryKv } from './dev.ts';
import type { Deps, Product } from './types.ts';

const P = '/make-server-fbb8f0e1';
const ADMIN = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };

function setup() {
  const deps: Deps = {
    kv: memoryKv(),
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
