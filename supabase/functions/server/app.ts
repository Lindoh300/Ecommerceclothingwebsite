import { type Context, Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import { registerCommunityRoutes } from './community_routes.ts';
import { registerListSendRoutes } from './list_send_routes.ts';
import { registerCustomerRoutes } from './customers_routes.ts';
import { registerDeliveryRoutes } from './delivery_routes.ts';
import { registerDiscountRoutes } from './discount_routes.ts';
import { registerRestockRoutes } from './restock_routes.ts';
import { registerEventRoutes } from './events_routes.ts';
import { type EmailMessage, type Mailer, orderReceivedEmail, orderShippedEmail, paymentReceivedEmail } from './mailer.ts';
import type {
  CartQuote,
  CartQuoteDiscount,
  CartQuoteLine,
  Deps,
  Order,
  PlaceOrderResult,
  PublicOrder,
  Variant,
  VariantStockInput,
} from './types.ts';
import {
  CATEGORY_ID_RE,
  DISCOUNT_CODE_RE,
  UUID_RE,
  validateCategoryBody,
  validateLookup,
  validateOrder,
  validateProductInput,
  validateQuote,
  validateStatusBody,
  validateTracking,
  validateVariantStocks,
} from './validation.ts';

const PREFIX = '/make-server-fbb8f0e1';
const ONLINE_UNAVAILABLE = 'Online payment is not available';
/** How long a payment link the admin creates keeps its stock (checkout holds an online order for 30 minutes). */
const PAYMENT_LINK_HOURS = 48;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * The caller's address. Only Cloudflare's cf-connecting-ip is trusted: Cloudflare sets it itself and refuses a
 * request that tries to supply its own. x-forwarded-for can be written by the caller, so it is never read.
 * Returns the trimmed value if it looks like an IPv4 or IPv6 address, else null (and null never blocks).
 */
export function clientIp(headers: Headers): string | null {
  const v = headers.get('cf-connecting-ip')?.trim();
  return v && v.length <= 45 && /^[0-9a-fA-F:.]+$/.test(v) ? v : null;
}

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

/**
 * What the public tracking page may see of an order. Built field by field from an allow-list, so a field added
 * to Order later stays private until it is listed here. Never copied from the order: no customer (name, phone,
 * email, note), no delivery address, no paymentFlag, no paymentUrl, no paidAt, no variant ids or SKUs.
 */
export function toPublicOrder(o: Order): PublicOrder {
  return {
    id: o.id,
    ref: o.ref,
    createdAt: o.createdAt,
    status: o.status,
    lines: o.lines.map((l) => ({
      name: l.name,
      ...(l.size ? { size: l.size } : {}),
      ...(l.color ? { color: l.color } : {}),
      quantity: l.quantity,
      subtotal: l.subtotal,
    })),
    deliveryFee: o.deliveryFee ?? 0,
    total: o.total,
    delivery: o.delivery
      ? { method: o.delivery.method, ...(o.delivery.locker ? { locker: o.delivery.locker } : {}) }
      : null,
    tracking: o.tracking
      ? { courier: o.tracking.courier ?? null, number: o.tracking.number ?? null, url: o.tracking.url ?? null }
      : null,
    expiresAt: o.expiresAt ?? null,
    paymentMethod: o.paymentMethod ?? null,
    discountCode: o.discountCode ?? null,
    discountAmount: o.discountAmount ?? 0,
  };
}

/** Rand for a message: whole amounts without decimals (R500), others with two (R99.50). */
const randText = (n: number) => `R${Number.isInteger(n) ? n : n.toFixed(2)}`;

const DISCOUNT_INVALID_ERROR = "This code isn't valid";

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

  /**
   * Sends one email and never lets it matter: every error is swallowed and only the order reference is logged,
   * never the address or the text. Awaited (an edge function may stop after the response); the mailer's own
   * 10 second timeout bounds it. Does nothing when no mailer is configured.
   */
  const notify = async (ref: string, fn: (mailer: Mailer) => Promise<EmailMessage | null>) => {
    const mailer = deps.mailer;
    if (!mailer) return;
    try {
      const msg = await fn(mailer);
      if (msg) await mailer.send(msg);
    } catch {
      console.error(`email failed for order ${ref}`);
    }
  };

  const readJson = async (c: Context): Promise<{ ok: true; body: unknown } | { ok: false }> => {
    try {
      return { ok: true, body: await c.req.json() };
    } catch {
      return { ok: false };
    }
  };

  /** The error response for a failed deps.orders.place, shared by POST /orders and POST /admin/orders. */
  const placeFailure = (c: Context, r: Extract<PlaceOrderResult, { ok: false }>) => {
    if (r.reason === 'rate_limited') {
      c.header('Retry-After', '3600');
      return c.json({
        error: 'Too many orders from this connection. Please try again in an hour or message us on WhatsApp.',
      }, 429);
    }
    if (r.reason === 'unknown_delivery') return c.json({ error: 'Unknown delivery option' }, 400);
    if (r.reason === 'missing') return c.json({ error: 'Unknown products', missing: r.missing }, 400);
    if (r.reason === 'discount_invalid') {
      return c.json({ error: DISCOUNT_INVALID_ERROR, code: 'discount_invalid' }, 409);
    }
    if (r.reason === 'discount_minimum') {
      return c.json({
        error: `Spend at least ${randText(r.minSpend)} to use this code`,
        code: 'discount_minimum',
        minSpend: r.minSpend,
      }, 409);
    }
    return c.json({ error: 'Insufficient stock', short: r.short }, 409);
  };

  /** The `discount` part of a quote. A malformed code never reaches the store (and is not counted against the limit). */
  const quoteDiscount = async (code: string, goods: number, ip: string | null): Promise<CartQuoteDiscount> => {
    if (!DISCOUNT_CODE_RE.test(code)) return { error: DISCOUNT_INVALID_ERROR, code: 'discount_invalid' };
    const r = await deps.discounts.check(code, goods, ip ?? undefined);
    if (r.ok) return { code: r.code, amount: r.amount };
    if (r.reason === 'rate_limited') {
      return { error: 'Too many tries. Please wait a while and try again.', code: 'rate_limited' };
    }
    if (r.reason === 'discount_minimum') {
      return { error: `Spend at least ${randText(r.minSpend)} to use this code`, code: 'discount_minimum' };
    }
    return { error: DISCOUNT_INVALID_ERROR, code: 'discount_invalid' };
  };

  // Events and tickets (Phase E): events_routes.ts.
  registerEventRoutes(app, deps, guard);

  // Community (Phase F): the gallery and the mailing list, community_routes.ts.
  registerCommunityRoutes(app, deps, guard);

  // Restock alerts (Phase F): customers ask to be told, the owner sees who waits, restock_routes.ts.
  registerRestockRoutes(app, deps, guard);

  // Delivery options (admin read and edit of rates), delivery_routes.ts.
  registerDeliveryRoutes(app, deps, guard);

  // Discount codes (admin list and edit), discount_routes.ts.
  registerDiscountRoutes(app, deps, guard);

  // Customer list (admin, read-only, built from orders), customers_routes.ts.
  registerCustomerRoutes(app, deps, guard);

  // Sending to the mailing list (Phase F): the owner writes an email and sends it in batches, list_send_routes.ts.
  registerListSendRoutes(app, deps, guard);

  app.get(`${PREFIX}/health`, (c) => c.json({ status: 'ok' }));

  // Public: lets the shop decide whether to offer online payment.
  app.get(`${PREFIX}/config`, (c) => c.json({ onlinePayments: deps.payments !== null }));

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
    // A code sent with the quote is answered beside the total, never in it: `total` is the lines, as before.
    // The store is only asked when every line was found, because the goods amount would otherwise be wrong.
    if (v.value.discountCode && missing.length === 0) {
      quote.discount = await quoteDiscount(v.value.discountCode, Math.round(total * 100) / 100, clientIp(c.req.raw.headers));
    }
    return c.json(quote);
  });

  // Public: the shop shows these before checkout. Inactive options are not listed.
  app.get(`${PREFIX}/delivery-options`, async (c) => c.json(await deps.deliveryOptions.list()));

  app.post(`${PREFIX}/orders`, async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateOrder(parsed.body);
    if (!v.ok) return c.json(v.code ? { error: v.error, code: v.code } : { error: v.error }, 400);
    const { delivery, paymentMethod, discountCode } = v.value;
    // Before any stock is taken: an online order that could never be paid must not hold stock.
    if (paymentMethod === 'online' && !deps.payments) return c.json({ error: ONLINE_UNAVAILABLE }, 503);
    const ip = clientIp(c.req.raw.headers);
    const r = await deps.orders.place(v.value.id, v.value.items, v.value.customer, {
      delivery,
      paymentMethod,
      ...(ip ? { ip } : {}),
      ...(discountCode ? { discountCode } : {}),
    });
    if (!r.ok) return placeFailure(c, r);
    // Only a new order sends mail: a retried id (created false) has already been announced.
    if (r.created) await notify(r.order.ref, () => Promise.resolve(orderReceivedEmail(r.order, deps.siteUrl)));
    return c.json(r.order, r.created ? 201 : 200);
  });

  // Admin: an order the owner enters for a customer (a WhatsApp sale, an event table, a payment link). The body and
  // the checks are POST /orders', except there is no 10-unit cap. Prices, stock and the delivery fee are still the
  // server's (deps.orders.place). No address is passed, so the per-address order limit never applies.
  // Online means a payment link: it needs a provider and an email, and keeps its stock 48 hours, not 30 minutes.
  app.post(`${PREFIX}/admin/orders`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateOrder(parsed.body, { maxUnits: false });
    if (!v.ok) return c.json(v.code ? { error: v.error, code: v.code } : { error: v.error }, 400);
    const { delivery, paymentMethod, discountCode } = v.value;
    if (paymentMethod === 'online' && !deps.payments) return c.json({ error: ONLINE_UNAVAILABLE }, 503);
    const r = await deps.orders.place(v.value.id, v.value.items, v.value.customer, {
      delivery,
      paymentMethod,
      ...(discountCode ? { discountCode } : {}),
    });
    if (!r.ok) return placeFailure(c, r);
    let order = r.order;
    // Only a new order gets the longer window: a retried id (created false) keeps the one it has.
    if (r.created && paymentMethod === 'online') {
      const w = await deps.orders.setPaymentWindow(order.id, PAYMENT_LINK_HOURS);
      if (w.ok) order = w.order;
    }
    return c.json(order, r.created ? 201 : 200);
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

  // Only a pending order (the customer pays on WhatsApp) can be marked paid by hand, after the owner has seen the money.
  // Stock is not touched: the order already holds it. An awaiting_payment order waits for its payment provider instead.
  app.post(`${PREFIX}/orders/:id/mark-paid`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Order not found' }, 404);
    const r = await deps.orders.setStatus(id, 'paid', 'pending');
    if (!r.ok) {
      if (r.reason === 'not_found') return c.json({ error: 'Order not found' }, 404);
      return c.json({ error: 'Only pending orders can be marked paid', status: r.order.status }, 409);
    }
    if (r.changed) await notify(r.order.ref, () => Promise.resolve(paymentReceivedEmail(r.order, deps.siteUrl)));
    return c.json(r.order);
  });

  // Admin: move an order along its lifecycle. Only packed, shipped, delivered and refunded can be set here:
  // cancelling and marking paid have their own routes, and no status here can skip a payment. A forward move
  // names the status it must come from, so a stale screen gets a 409 instead of a surprise.
  app.post(`${PREFIX}/orders/:id/status`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Order not found' }, 404);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateStatusBody(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const r = await deps.orders.setStatus(id, v.value.status, v.value.from ?? undefined);
    if (!r.ok) {
      if (r.reason === 'not_found') return c.json({ error: 'Order not found' }, 404);
      return c.json({ error: `An order that is ${r.order.status} cannot be set to ${v.value.status}`, status: r.order.status }, 409);
    }
    if (r.changed && v.value.status === 'shipped') {
      await notify(r.order.ref, () => Promise.resolve(orderShippedEmail(r.order, deps.siteUrl)));
    }
    return c.json(r.order);
  });

  // Admin: courier, tracking number and tracking link, for a packed or shipped order.
  app.post(`${PREFIX}/orders/:id/tracking`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Order not found' }, 404);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateTracking(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const r = await deps.orders.setTracking(id, v.value);
    if (!r.ok) {
      if (r.reason === 'not_found') return c.json({ error: 'Order not found' }, 404);
      return c.json({ error: 'Tracking can only be added to packed or shipped orders', status: r.order.status }, 409);
    }
    return c.json(r.order);
  });

  // Admin: 48 more hours for a pending order that is still waiting for its payment. The body is not read.
  app.post(`${PREFIX}/orders/:id/extend`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Order not found' }, 404);
    const r = await deps.orders.extend(id);
    if (!r.ok) {
      if (r.reason === 'not_found') return c.json({ error: 'Order not found' }, 404);
      return c.json({ error: 'Only a pending order that has an expiry can be extended', status: r.order.status }, 409);
    }
    return c.json(r.order);
  });

  // Public: a customer finds their order id from the reference and phone. Every failure to find one is the
  // same 404, so the answer says nothing about which of the two was wrong. 10 lookups per address per hour.
  app.post(`${PREFIX}/orders/lookup`, async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateLookup(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const ip = clientIp(c.req.raw.headers);
    const r = await deps.orders.lookup(v.value.ref, v.value.phone, ip ?? undefined);
    if (!r.ok) {
      if (r.reason === 'rate_limited') {
        c.header('Retry-After', '3600');
        return c.json({ error: 'Too many lookups from this connection. Please try again in an hour.' }, 429);
      }
      return c.json({ error: 'No order found' }, 404);
    }
    return c.json({ id: r.id });
  });

  // Public: the order UUID is the capability. Returns the allow-listed fields only (toPublicOrder). An unknown
  // or malformed id is the same 404.
  app.get(`${PREFIX}/orders/:id/public`, async (c) => {
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Order not found' }, 404);
    const order = await deps.orders.get(id);
    if (!order) return c.json({ error: 'Order not found' }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json(toPublicOrder(order));
  });

  // Public: the order UUID is the capability. The body is not read: the amount, currency, reference and
  // email all come from the stored order, never from the request.
  app.post(`${PREFIX}/orders/:id/pay`, async (c) => {
    const payments = deps.payments;
    if (!payments) return c.json({ error: ONLINE_UNAVAILABLE }, 503);
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Order not found' }, 404);
    const info = await deps.orders.paymentInfo(id);
    if (!info) return c.json({ error: 'Order not found' }, 404);
    if (info.status !== 'awaiting_payment') {
      return c.json({ error: 'This order can no longer be paid online', status: info.status }, 409);
    }
    if (info.paymentUrl) return c.json({ redirectUrl: info.paymentUrl });
    if (!info.email) return c.json({ error: 'This order has no email address to pay with' }, 400);
    let redirectUrl: string;
    try {
      // The order id is the reference: one payment per order, and the webhook finds the order by it.
      ({ redirectUrl } = await payments.start({
        reference: info.id,
        amountCents: Math.round(info.total * 100),
        currency: 'ZAR',
        email: info.email,
        orderRef: info.ref,
        ...(deps.siteUrl ? { callbackUrl: `${deps.siteUrl}/order/${info.id}?paid=1` } : {}),
      }));
    } catch (e) {
      console.error('payment start failed for order', info.ref, e instanceof Error ? e.message : 'unknown error');
      return c.json({ error: 'Could not start payment' }, 502);
    }
    if (!(await deps.orders.attachPayment(info.id, info.id, redirectUrl))) {
      // Lost a race: another call stored its URL first, or the order left awaiting_payment meanwhile.
      const now = await deps.orders.paymentInfo(info.id);
      if (now?.status === 'awaiting_payment' && now.paymentUrl) return c.json({ redirectUrl: now.paymentUrl });
      return c.json({ error: 'This order can no longer be paid online', status: now?.status ?? info.status }, 409);
    }
    return c.json({ redirectUrl });
  });

  // Called by the payment provider. The signature proves who sent it, but the body's figures are never
  // used: we ask the provider (verify) and record what it says.
  app.post(`${PREFIX}/payments/webhook`, async (c) => {
    const payments = deps.payments;
    if (!payments) return c.json({ error: ONLINE_UNAVAILABLE }, 503);
    const rawBody = await c.req.text();
    const event = await payments.parseWebhook(rawBody, c.req.raw.headers);
    if (!event) return c.json({ error: 'Invalid signature' }, 401);
    if (event.type !== 'payment_success') return c.json({ received: true });
    let verified;
    try {
      verified = await payments.verify(event.reference);
    } catch (e) {
      // 502 makes the provider try again later.
      console.error('payment verify failed for', event.reference, e instanceof Error ? e.message : 'unknown error');
      return c.json({ error: 'Could not verify payment' }, 502);
    }
    if (verified.status !== 'success') return c.json({ received: true });
    const r = await deps.orders.recordPayment(verified.reference, verified.amountCents, verified.currency);
    if (!r.ok) console.warn(`payment ${r.reason} for reference ${verified.reference}`);
    else if (r.outcome === 'refund_due') console.warn(`payment for reference ${verified.reference} needs a refund`);
    else if (r.outcome === 'paid' || r.outcome === 'paid_late') {
      // The reference is the order id. 'already' (a repeat webhook) sends nothing. Logged by id: the ref is not known yet.
      await notify(verified.reference, async () => {
        const order = await deps.orders.get(verified.reference);
        return order ? paymentReceivedEmail(order, deps.siteUrl) : null;
      });
    }
    return c.json({ received: true });
  });

  return app;
}
