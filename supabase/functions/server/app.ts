import { type Context, Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import type { CartQuote, CartQuoteLine, Deps, Variant, VariantStockInput } from './types.ts';
import {
  CATEGORY_ID_RE,
  UUID_RE,
  validateCategoryBody,
  validateOrder,
  validateProductInput,
  validateQuote,
  validateVariantStocks,
} from './validation.ts';

const PREFIX = '/make-server-fbb8f0e1';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const deriveImage = (images: string[] | undefined): string => images?.find((u) => u !== '') ?? '';

/**
 * Picks the variant an order line would take, like place_order_v2: the exact size and
 * colour; a missing or '' size or colour matches any, and the variant with the most stock
 * wins. `variants` must be in size then colour order, so ties go to the first.
 */
export function resolveVariant(variants: Variant[], size?: string, color?: string): Variant | undefined {
  let best: Variant | undefined;
  for (const v of variants) {
    if (size && v.size !== size) continue;
    if (color && v.color !== color) continue;
    if (!best || v.stock > best.stock) best = v;
  }
  return best;
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();

  app.use('*', logger(console.log));
  app.use(
    '/*',
    cors({
      origin: '*',
      allowHeaders: ['Content-Type', 'Authorization', 'apikey', 'x-client-info'],
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
    const all = c.req.query('all') === '1';
    if (all) {
      const denied = await guard(c);
      if (denied) return denied;
    }
    return c.json(await deps.products.list(all));
  });

  app.get(`${PREFIX}/products/:id`, async (c) => {
    const p = await deps.products.get(c.req.param('id'));
    if (!p) return c.json({ error: 'Product not found' }, 404);
    // An inactive product is hidden from everyone but admins.
    if (!p.active && (await deps.isAdmin(c.req.header('Authorization') ?? null)) !== 'ok') {
      return c.json({ error: 'Product not found' }, 404);
    }
    return c.json(p);
  });

  app.post(`${PREFIX}/products`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateProductInput(parsed.body, false);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const { name, category, price, description, images, sizes, colors, stock, variants } = v.value;
    const r = await deps.products.create({
      id: crypto.randomUUID(),
      name: name!,
      category: category!,
      price: price!,
      description: description ?? '',
      images: images!,
      sizes: sizes!,
      colors: colors!,
      stock,
      variants,
    });
    if (!r.ok) return c.json({ error: 'Unknown category' }, 400);
    return c.json(r.product, 201);
  });

  app.put(`${PREFIX}/products/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateProductInput(parsed.body, true);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const body = parsed.body as Record<string, unknown>;
    const raw = body.expectedStock;
    let expectedStock: number | undefined;
    if (raw !== undefined) {
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
        return c.json({ error: 'expectedStock must be a whole number of 0 or more' }, 400);
      }
      expectedStock = raw;
    }
    let variants: VariantStockInput[] | undefined;
    if (body.variants !== undefined) {
      const vs = validateVariantStocks(body.variants);
      if (!vs.ok) return c.json({ error: vs.error }, 400);
      variants = vs.value;
    }
    const r = await deps.products.update(c.req.param('id'), v.value, expectedStock, variants);
    if (!r.ok) {
      if (r.reason === 'not_found') return c.json({ error: 'Product not found' }, 404);
      if (r.reason === 'unknown_category') return c.json({ error: 'Unknown category' }, 400);
      const out: { error: string; stock: number; variants?: { id: string; stock: number }[] } = {
        error: 'Stock changed',
        stock: r.stock,
      };
      if (variants) out.variants = r.variants;
      return c.json(out, 409);
    }
    return c.json(r.product);
  });

  app.delete(`${PREFIX}/products/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    if (!(await deps.products.remove(c.req.param('id')))) return c.json({ error: 'Product not found' }, 404);
    return c.body(null, 204);
  });

  app.get(`${PREFIX}/categories`, async (c) => {
    const all = c.req.query('all') === '1';
    if (all) {
      const denied = await guard(c);
      if (denied) return denied;
    }
    return c.json(await deps.categories.list(all));
  });

  app.put(`${PREFIX}/categories/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!CATEGORY_ID_RE.test(id)) {
      return c.json({ error: 'Category id must be lowercase letters, digits and hyphens, up to 40 characters' }, 400);
    }
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateCategoryBody(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    return c.json(await deps.categories.upsert({ id, ...v.value }));
  });

  app.delete(`${PREFIX}/categories/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!CATEGORY_ID_RE.test(id)) return c.json({ error: 'Category not found' }, 404);
    const r = await deps.categories.remove(id);
    if (!r.ok) return c.json({ error: 'Category in use', count: r.count }, 409);
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
      // Only an exact product id counts (a slug does not), like place_order_v2.
      const p = await deps.products.get(item.productId);
      const variant = p && p.id === item.productId && p.active
        ? resolveVariant(p.variants, item.size, item.color)
        : undefined;
      if (!p || !variant) {
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
        available: variant.stock,
        variantId: variant.id,
        sku: variant.sku,
      };
      if (item.size !== undefined) line.size = item.size;
      if (item.color !== undefined) line.color = item.color;
      lines.push(line);
    }
    const quote: CartQuote = { lines, total, missing };
    return c.json(quote);
  });

  app.post(`${PREFIX}/orders`, async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateOrder(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const r = await deps.orders.place(v.value.id, v.value.items, v.value.customer);
    if (!r.ok) {
      if (r.reason === 'missing') return c.json({ error: 'Unknown products', missing: r.missing }, 400);
      return c.json({ error: 'Insufficient stock', short: r.short }, 409);
    }
    return c.json(r.order, r.created ? 201 : 200);
  });

  app.get(`${PREFIX}/orders`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    return c.json(await deps.orders.list());
  });

  app.post(`${PREFIX}/orders/:id/cancel`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Order not found' }, 404);
    const order = await deps.orders.cancel(id);
    if (!order) return c.json({ error: 'Order not found' }, 404);
    return c.json(order);
  });

  return app;
}
