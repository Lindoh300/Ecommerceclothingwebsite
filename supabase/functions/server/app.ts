import { type Context, Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import type { CartQuote, CartQuoteLine, Deps, Product } from './types.ts';
import { validateProductInput, validateQuote } from './validation.ts';
import { ensureSeeded } from './seed.ts';

const PREFIX = '/make-server-fbb8f0e1';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const deriveImage = (images: string[] | undefined): string => images?.find((u) => u !== '') ?? '';

export function createApp(deps: Deps): Hono {
  const app = new Hono();
  const { kv } = deps;

  app.use('*', logger(console.log));
  app.use(
    '/*',
    cors({
      origin: '*',
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['Content-Length'],
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  // Returns an error Response if the caller is not an admin, otherwise null.
  const guard = async (c: Context) => {
    const r = await deps.isAdmin(c.req.header('Authorization') ?? null);
    if (r === 'unauthenticated') return c.json({ error: 'Unauthenticated' }, 401);
    if (r === 'forbidden') return c.json({ error: 'Forbidden' }, 403);
    return null;
  };

  const readJson = async (c: Context): Promise<{ ok: true; body: unknown } | { ok: false }> => {
    try {
      return { ok: true, body: await c.req.json() };
    } catch {
      return { ok: false };
    }
  };

  app.get(`${PREFIX}/health`, (c) => c.json({ status: 'ok' }));

  app.get(`${PREFIX}/products`, async (c) => {
    await ensureSeeded(kv);
    const list = (await kv.getByPrefix('product:')) as Product[];
    list.sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );
    return c.json(list);
  });

  app.get(`${PREFIX}/products/:id`, async (c) => {
    const p = await kv.get(`product:${c.req.param('id')}`);
    if (!p) return c.json({ error: 'Product not found' }, 404);
    return c.json(p);
  });

  app.post(`${PREFIX}/products`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateProductInput(parsed.body, false);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const input = v.value;
    const product = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      image: deriveImage(input.images),
    } as Product;
    await kv.set(`product:${product.id}`, product);
    return c.json(product, 201);
  });

  app.put(`${PREFIX}/products/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateProductInput(parsed.body, true);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const id = c.req.param('id');
    const existing = (await kv.get(`product:${id}`)) as Product | null;
    if (!existing) return c.json({ error: 'Product not found' }, 404);
    const merged: Product = { ...existing, ...v.value, id: existing.id, createdAt: existing.createdAt };
    merged.image = deriveImage(merged.images);
    await kv.set(`product:${id}`, merged);
    return c.json(merged);
  });

  app.delete(`${PREFIX}/products/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    const existing = await kv.get(`product:${id}`);
    if (!existing) return c.json({ error: 'Product not found' }, 404);
    await kv.del(`product:${id}`);
    return c.body(null, 204);
  });

  app.post(`${PREFIX}/images`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: 'Expected multipart form data' }, 400);
    }
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'Missing file field' }, 400);
    if (!IMAGE_TYPES.includes(file.type)) {
      return c.json({ error: 'File must be a jpeg, png, webp or gif image' }, 400);
    }
    if (file.size > MAX_IMAGE_BYTES) return c.json({ error: 'File exceeds 2 MB' }, 400);
    const url = await deps.uploadImage(file);
    return c.json({ url }, 201);
  });

  app.post(`${PREFIX}/cart/quote`, async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateQuote(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const lines: CartQuoteLine[] = [];
    const missing: string[] = [];
    let total = 0;
    for (const item of v.value.items) {
      const p = (await kv.get(`product:${item.productId}`)) as Product | null;
      if (!p) {
        missing.push(item.productId);
        continue;
      }
      const subtotal = p.price * item.quantity;
      total += subtotal;
      const line: CartQuoteLine = {
        productId: p.id,
        name: p.name,
        price: p.price,
        image: p.image,
        quantity: item.quantity,
        subtotal,
        available: p.stock,
      };
      if (item.size !== undefined) line.size = item.size;
      if (item.color !== undefined) line.color = item.color;
      lines.push(line);
    }
    const quote: CartQuote = { lines, total, missing };
    return c.json(quote);
  });

  return app;
}
