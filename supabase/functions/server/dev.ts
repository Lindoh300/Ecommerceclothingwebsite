// Local dev server with no Supabase. Run with: deno run --allow-net dev.ts
// Admin token: "Bearer dev-admin". Data lives in memory and resets on restart.
// The stores below mirror the Postgres functions in
// supabase/migrations/20261030000000_catalogue.sql, 20261030100000_order_lifecycle.sql,
// 20261030110000_delivery.sql, 20261030120000_payments.sql and 20261030130000_place_order_v3.sql
// (which also holds the order expiry; 20261030140000_order_expiry_cron.sql only schedules it), and
// 20261031100000_order_fulfilment.sql (cancelled -> refunded, tracking, extend, lookup), and
// 20261031110000_payment_links.sql (set_payment_window), and 20261031120000_events.sql (events, ticket types,
// tickets: memoryEvents below), and 20261031130000_community.sql (gallery and mailing list: memoryCommunity), and
// 20261031150000_restock_alerts.sql (restock requests: memoryRestock; unsubscribing also removes them), and
// 20261031160000_list_sends.sql (sending to the mailing list: memoryListSends).
// When one changes, change the other.
import { createApp, deriveImage, resolveVariant } from './app.ts';
import { createFakeProvider } from './fake_payments.ts';
import type { PaymentProvider } from './payments.ts';
import { seedCatalogue } from './seed.ts';
import { normalisePhone } from './validation.ts';
import type {
  AdminEvent,
  AdminGalleryItem,
  CommunityStore,
  GalleryInput,
  ListSendRecipient,
  ListSendStore,
  ListSendSummary,
  RestockRequest,
  RestockResult,
  RestockStore,
  Subscriber,
  UpsertGalleryResult,
  AdminTicketType,
  Category,
  CategoryStore,
  CheckInResult,
  CreateProductResult,
  Customer,
  DeleteCategoryResult,
  DeliveryOption,
  DeliveryOptionStore,
  DeleteEventResult,
  Deps,
  EventInput,
  EventStore,
  ExtendResult,
  LookupResult,
  Order,
  OrderItemInput,
  OrderLine,
  OrderStatus,
  OrderStore,
  PlaceOptions,
  PaymentInfo,
  PlaceOrderResult,
  Product,
  PublicEvent,
  ProductStore,
  RecordPaymentResult,
  SetPaymentWindowResult,
  SetStatusResult,
  SetTrackingResult,
  StockShortfall,
  Ticket,
  TicketHolder,
  TicketTypeInput,
  TrackingInput,
  UpdateProductResult,
  UpsertEventResult,
  UpsertTicketTypeResult,
  Variant,
  VoidResult,
  IssueResult,
} from './types.ts';

export type Lock = <T>(fn: () => Promise<T>) => Promise<T>;

// A promise-chain mutex standing in for Postgres row locks. Share one between
// the stores so their operations serialise together.
export function createLock(): Lock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };
}

type StoredProduct = Omit<Product, 'stock' | 'image' | 'variants'> & { variants: Variant[] };

/** The tables. Share one between the stores. */
export interface MemoryDb {
  categories: Map<string, Category>;
  products: Map<string, StoredProduct>;
  deliveryOptions: Map<string, StoredDeliveryOption>;
}

type StoredDeliveryOption = DeliveryOption & { sort: number; active: boolean };

/** The rows delivery_options is seeded with (20261030110000_delivery.sql). */
const seedDeliveryOptions = (): Map<string, StoredDeliveryOption> =>
  new Map([
    ['door', { id: 'door', name: 'Door delivery', price: 85, sort: 1, active: true }],
    ['locker', { id: 'locker', name: 'Locker', price: 55, sort: 2, active: true }],
    ['collect', { id: 'collect', name: 'Collect', price: 0, sort: 3, active: true }],
  ]);

export const createMemoryDb = (): MemoryDb => ({
  categories: new Map(),
  products: new Map(),
  deliveryOptions: seedDeliveryOptions(),
});

/** Mirrors list_delivery_options: active options, in sort order. */
export function memoryDeliveryOptions(db: MemoryDb): DeliveryOptionStore {
  return {
    list: () =>
      Promise.resolve(
        [...db.deliveryOptions.values()]
          .filter((o) => o.active)
          .sort((a, b) => a.sort - b.sort || cmp(a.id, b.id))
          .map(({ id, name, price }) => ({ id, name, price })),
      ),
  };
}

// --- helpers mirroring the catalogue_* SQL functions -------------------------

const NOT_LISTED = 1_000_000;
const pos = (arr: string[], v: string) => {
  const i = arr.indexOf(v);
  return i < 0 ? NOT_LISTED : i + 1;
};
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** catalogue_list: strings only, no empty ones, no repeats, first appearance order. */
const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && s !== ''))] : [];

/** Variants in size then colour order (a copy of the array; the variants are shared). */
const ordered = (p: StoredProduct): Variant[] =>
  [...p.variants].sort((a, b) =>
    pos(p.sizes, a.size) - pos(p.sizes, b.size) || pos(p.colors, a.color) - pos(p.colors, b.color) || cmp(a.id, b.id)
  );

const totalStock = (p: StoredProduct) => p.variants.reduce((n, v) => n + v.stock, 0);

/** product_json */
function view(p: StoredProduct): Product {
  return structuredClone({
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    price: p.price,
    description: p.description,
    images: p.images,
    image: deriveImage(p.images),
    sizes: p.sizes,
    colors: p.colors,
    stock: totalStock(p),
    active: p.active,
    createdAt: p.createdAt,
    variants: ordered(p),
  });
}

/** catalogue_slug */
function makeSlug(db: MemoryDb, name: string, excludeId: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product';
  const taken = (s: string) => [...db.products.values()].some((p) => p.id !== excludeId && (p.slug === s || p.id === s));
  let slug = base;
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/** catalogue_sku */
function makeSku(db: MemoryDb, productId: string, size: string, color: string): string {
  const alnum = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');
  const base = `N${productId.replace(/-/g, '').slice(0, 8)}-${alnum(size)}-${alnum(color)}`.toUpperCase();
  const used = new Set([...db.products.values()].flatMap((p) => p.variants.map((v) => v.sku)));
  let sku = base;
  for (let n = 2; used.has(sku); n++) sku = `${base}-${n}`;
  return sku;
}

/** catalogue_add_stock: spread evenly, the remainder one each to the first variants. */
function addStock(p: StoredProduct, amount: number) {
  const vs = ordered(p);
  const n = vs.length;
  vs.forEach((v, i) => {
    v.stock += Math.floor(amount / n) + (i < amount % n ? 1 : 0);
  });
}

/** catalogue_remove_stock: level the highest variants down; never below zero. */
function removeStock(p: StoredProduct, amount: number) {
  if (amount <= 0) return;
  const cutTo = (m: number) => p.variants.reduce((n, v) => n + Math.max(v.stock - m, 0), 0);
  let lo = 0;
  let hi = Math.max(0, ...p.variants.map((v) => v.stock));
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cutTo(mid) <= amount) hi = mid;
    else lo = mid + 1;
  }
  const cut = cutTo(lo);
  for (const v of p.variants) v.stock = Math.min(v.stock, lo);
  const owed = amount - cut;
  if (owed > 0) {
    ordered(p).filter((v) => v.stock === lo && v.stock > 0).slice(0, owed).forEach((v) => v.stock--);
  }
}

/** catalogue_seed_variants: add the missing size x colour variants. */
function seedVariants(
  db: MemoryDb,
  p: StoredProduct,
  stock: number,
  given?: { size?: string; color?: string; stock: number }[],
) {
  const useGiven = Array.isArray(given) && given.length > 0;
  const sizes = p.sizes.length ? p.sizes : [''];
  const colors = p.colors.length ? p.colors : [''];
  for (const size of sizes) {
    for (const color of colors) {
      if (p.variants.some((v) => v.size === size && v.color === color)) continue;
      const own = useGiven
        ? Math.max(0, ...given!.filter((g) => (g.size ?? '') === size && (g.color ?? '') === color).map((g) => g.stock))
        : 0;
      p.variants.push({ id: crypto.randomUUID(), sku: makeSku(db, p.id, size, color), size, color, stock: own });
    }
  }
  if (!useGiven && stock > 0) addStock(p, stock);
}

// --- stores ------------------------------------------------------------------

export function memoryCategories(db: MemoryDb, lock: Lock = createLock()): CategoryStore {
  return {
    list: (includeInactive = false) =>
      lock(() =>
        Promise.resolve(
          [...db.categories.values()]
            .filter((c) => c.active || includeInactive)
            .sort((a, b) => a.sort - b.sort || cmp(a.name, b.name) || cmp(a.id, b.id))
            .map((c) => ({ ...c })),
        )
      ),
    upsert: (cat) =>
      lock(() => {
        const old = db.categories.get(cat.id);
        const next: Category = {
          id: cat.id,
          name: cat.name,
          sort: cat.sort ?? old?.sort ?? 0,
          active: cat.active ?? old?.active ?? true,
        };
        db.categories.set(cat.id, next);
        return Promise.resolve({ ...next });
      }),
    remove: (id) =>
      lock<DeleteCategoryResult>(() => {
        const count = [...db.products.values()].filter((p) => p.category === id).length;
        if (count > 0) return Promise.resolve({ ok: false, reason: 'in_use', count } as const);
        db.categories.delete(id);
        return Promise.resolve({ ok: true } as const);
      }),
  };
}

export function memoryProducts(db: MemoryDb, lock: Lock = createLock()): ProductStore {
  return {
    list: (includeInactive = false) =>
      lock(() =>
        Promise.resolve(
          [...db.products.values()]
            .filter((p) => p.active || includeInactive)
            .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id))
            .map(view),
        )
      ),
    get: (key) =>
      lock(() => {
        const p = db.products.get(key) ?? [...db.products.values()].find((x) => x.slug === key);
        return Promise.resolve(p ? view(p) : null);
      }),
    create: (input) =>
      lock<CreateProductResult>(() => {
        if (!db.categories.has(input.category)) return Promise.resolve({ ok: false, reason: 'unknown_category' } as const);
        if (db.products.has(input.id)) throw new Error('duplicate product id');
        const p: StoredProduct = {
          id: input.id,
          slug: makeSlug(db, input.name, input.id),
          name: input.name,
          category: input.category,
          price: input.price,
          description: input.description ?? '',
          images: [...(input.images ?? [])],
          sizes: cleanList(input.sizes),
          colors: cleanList(input.colors),
          active: true,
          createdAt: input.createdAt ?? new Date().toISOString(),
          variants: [],
        };
        db.products.set(p.id, p);
        seedVariants(db, p, input.stock ?? 0, input.variants);
        return Promise.resolve({ ok: true, product: view(p) } as const);
      }),
    update: (id, patch, expectedStock, variants) =>
      lock<UpdateProductResult>(() => {
        const p = db.products.get(id);
        if (!p) return Promise.resolve({ ok: false, reason: 'not_found' } as const);
        if (patch.category !== undefined && !db.categories.has(patch.category)) {
          return Promise.resolve({ ok: false, reason: 'unknown_category' } as const);
        }
        const total = totalStock(p);
        const stale = variants
          ? variants.some((e) => e.expectedStock !== undefined && p.variants.find((v) => v.id === e.id)?.stock !== e.expectedStock)
          : patch.stock !== undefined && expectedStock !== undefined && expectedStock !== total;
        if (stale) {
          return Promise.resolve(
            {
              ok: false,
              reason: 'stock_changed',
              stock: total,
              variants: ordered(p).map((v) => ({ id: v.id, stock: v.stock })),
            } as const,
          );
        }
        const requested = !variants && patch.stock !== undefined ? patch.stock : undefined;

        // Merge the fields. id, createdAt, image and slug are never changed.
        if (patch.name !== undefined) p.name = patch.name;
        if (patch.category !== undefined) p.category = patch.category;
        if (patch.price !== undefined) p.price = patch.price;
        if (patch.description !== undefined) p.description = patch.description;
        if (patch.images !== undefined) p.images = [...patch.images];
        if (patch.sizes !== undefined) p.sizes = cleanList(patch.sizes);
        if (patch.colors !== undefined) p.colors = cleanList(patch.colors);
        if (patch.active !== undefined) p.active = patch.active;

        // Per-variant stock, before the reconcile so stock on a dropped variant is moved, not lost.
        if (variants) {
          for (const e of variants) {
            const v = p.variants.find((x) => x.id === e.id);
            if (v) v.stock = e.stock;
          }
        }

        // Reconcile the variants with the new sizes and colours.
        if (patch.sizes !== undefined || patch.colors !== undefined) {
          const sizes = p.sizes.length ? p.sizes : [''];
          const colors = p.colors.length ? p.colors : [''];
          seedVariants(db, p, 0);
          const keep = (v: Variant) => sizes.includes(v.size) && colors.includes(v.color);
          // Keep at least one variant: only remove when some variant would remain.
          if (p.variants.some(keep)) {
            const moved = p.variants.filter((v) => !keep(v)).reduce((n, v) => n + v.stock, 0);
            p.variants = p.variants.filter(keep);
            if (moved > 0) addStock(p, moved);
          }
        }

        // A new total (old admin).
        if (requested !== undefined) {
          if (requested > total) addStock(p, requested - total);
          else if (requested < total) removeStock(p, total - requested);
        }
        return Promise.resolve({ ok: true, product: view(p) } as const);
      }),
    remove: (id) => lock(() => Promise.resolve(db.products.delete(id))),
  };
}

/** The in-memory order store, plus two test seams:
 *  `patch` overwrites fields of a stored order with no rules and no stock effects, like an UPDATE in SQL.
 *  Lets tests reach a status the API cannot yet.
 *  `expireDue` runs what the pg_cron job runs (expire_due_orders): due pending orders are cancelled, due
 *  awaiting_payment orders expire, stock goes back, and old rate-limit rows are dropped. Resolves to the ids
 *  of the orders it changed. */
export type MemoryOrderStore = OrderStore & {
  patch(id: string, fields: Partial<Order>): void;
  expireDue(): Promise<string[]>;
};

/** How long an order may wait: pending (paid on WhatsApp) 48 hours, awaiting_payment 30 minutes. */
const PENDING_TTL_MS = 48 * 60 * 60 * 1000;
const AWAITING_PAYMENT_TTL_MS = 30 * 60 * 1000;
/** At most this many orders per client address in a rolling hour. */
const ORDERS_PER_IP = 5;
/** At most this many order lookups per client address in a rolling hour. */
const LOOKUPS_PER_IP = 10;
/** How long extend adds to a pending order. */
const EXTEND_MS = 48 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Allowed order status moves (from -> to), the table in set_order_status.
 *  `pending -> expired` is not allowed: the expiry job cancels due pending orders.
 *  `cancelled -> refunded` is listed but ALSO needs payment_flag = 'refund_due' (checked in setStatus). */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['paid', 'cancelled'],
  awaiting_payment: ['paid', 'cancelled', 'expired'],
  paid: ['packed', 'refunded'],
  packed: ['shipped', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  expired: ['refunded'],
  cancelled: ['refunded'],
  refunded: [],
};

// In-memory orders that mirror place_order_v2, set_order_status, cancel_order_v2 and the payment functions
// (order_payment_info, attach_payment, record_payment), plus the expiry and per-address limit of place_order_v3
// and expire_due_orders. The shared lock serialises them, standing in for row locks.
// `now` is the clock (milliseconds), so tests can jump time; every timestamp and expiry comes from it.
export function memoryOrders(db: MemoryDb, lock: Lock = createLock(), now: () => number = Date.now): MemoryOrderStore {
  const orders = new Map<string, Order>();
  // order_ip_log: when each order from an address was placed. SQL keeps a salted hash instead of the address;
  // this is memory in a dev process, so the address itself is the key.
  const ipLog = new Map<string, number[]>();
  // order_lookup_log: the same, for lookups.
  const lookupLog = new Map<string, number[]>();
  const iso = (ms: number = now()) => new Date(ms).toISOString();
  // payment_reference and payment_url: stored on the order row in SQL, never part of the Order JSON.
  const payments = new Map<string, { reference: string; url: string }>();

  /** place_order_v3: place_order_v2 below, then the delivery fee and payment method on the new order. */
  function place(rawId: string, items: OrderItemInput[], customer: Customer, opts?: PlaceOptions): PlaceOrderResult {
    // Early: an unknown or inactive delivery method. The fee is read from the table, never from the caller.
    const option = opts?.delivery ? db.deliveryOptions.get(opts.delivery.method) : undefined;
    if (opts?.delivery && !option?.active) return { ok: false, reason: 'unknown_delivery' };
    const r = placeV2(rawId, items, customer);
    if (!r.ok || !r.created) return r;
    const order = orders.get(rawId.toLowerCase())!;
    if (!opts) return r; // a bare store call (no opts at all) leaves the v2 result alone, expiry included; the route always passes opts
    if (opts.delivery && option) {
      const fee = option.price;
      order.deliveryFee = fee;
      order.total += fee;
      order.delivery = {
        method: option.id,
        ...(opts.delivery.address ? { address: structuredClone(opts.delivery.address) } : {}),
        ...(opts.delivery.locker ? { locker: opts.delivery.locker } : {}),
        fee,
      };
    }
    order.paymentMethod = opts.paymentMethod ?? 'whatsapp';
    if (order.paymentMethod === 'online') order.status = 'awaiting_payment';
    order.expiresAt = iso(now() + (order.paymentMethod === 'online' ? AWAITING_PAYMENT_TTL_MS : PENDING_TTL_MS));

    // The rate limit is the last step, like in SQL, so a replay or a stock rejection (returned above) never counts.
    // Over the limit, the order and its stock are undone, as the rolled-back block does in SQL.
    if (opts.ip) {
      const recent = (ipLog.get(opts.ip) ?? []).filter((t) => t > now() - HOUR_MS);
      if (recent.length >= ORDERS_PER_IP) {
        ipLog.set(opts.ip, recent);
        returnStock(order.lines);
        orders.delete(order.id);
        return { ok: false, reason: 'rate_limited' };
      }
      ipLog.set(opts.ip, [...recent, now()]);
    }
    return { ok: true, created: true, order: structuredClone(order) };
  }

  /** place_order_v2. */
  function placeV2(rawId: string, items: OrderItemInput[], customer: Customer): PlaceOrderResult {
    const id = rawId.toLowerCase();
    const existing = orders.get(id);
    if (existing) return { ok: true, created: false, order: structuredClone(existing) };

    // Resolve each item to one variant (a missing size or colour matches any; most stock wins).
    const resolved = items.map((it) => {
      const stored = db.products.get(it.productId);
      const p = stored?.active ? view(stored) : undefined;
      return { it, p, v: p ? resolveVariant(p.variants, it.size, it.color) : undefined };
    });
    const missing = [...new Set(resolved.filter((r) => !r.v).map((r) => r.it.productId))];
    if (missing.length > 0) return { ok: false, reason: 'missing', missing };

    // Lines on the same variant are counted together.
    const want = new Map<string, { qty: number; p: Product; v: Variant }>();
    for (const { it, p, v } of resolved) {
      const w = want.get(v!.id) ?? { qty: 0, p: p!, v: v! };
      w.qty += it.quantity;
      want.set(v!.id, w);
    }
    const short: StockShortfall[] = [...want.values()]
      .filter((w) => w.qty > w.v.stock)
      .map((w) => ({
        productId: w.p.id,
        name: w.p.name,
        size: w.v.size,
        color: w.v.color,
        requested: w.qty,
        available: w.v.stock,
      }));
    if (short.length > 0) return { ok: false, reason: 'stock', short };

    const lines: OrderLine[] = resolved.map(({ it, p, v }) => {
      const line: OrderLine = {
        productId: p!.id,
        name: p!.name,
        price: p!.price,
        quantity: it.quantity,
        subtotal: p!.price * it.quantity,
        variantId: v!.id,
        sku: v!.sku,
      };
      if (v!.size !== '') line.size = v!.size;
      if (v!.color !== '') line.color = v!.color;
      return line;
    });
    for (const w of want.values()) {
      db.products.get(w.p.id)!.variants.find((x) => x.id === w.v.id)!.stock -= w.qty;
    }
    const order: Order = {
      id,
      ref: id.slice(0, 8).toUpperCase(),
      createdAt: iso(),
      status: 'pending',
      lines,
      total: lines.reduce((sum, l) => sum + l.subtotal, 0),
      customer,
      deliveryFee: 0,
      delivery: null,
      paymentMethod: null,
      paymentFlag: null,
      paidAt: null,
      expiresAt: null,
      tracking: null,
    };
    orders.set(id, order);
    return { ok: true, created: true, order: structuredClone(order) };
  }

  /** order_return_stock: put each line's stock back. */
  function returnStock(lines: OrderLine[]) {
    for (const l of lines) {
      const p = db.products.get(l.productId);
      if (!p) continue; // the product is gone
      // The line's variant if it still exists, else the exact size and colour, else the first variant.
      const v = p.variants.find((x) => x.id === l.variantId) ??
        p.variants.find((x) => x.size === (l.size ?? '') && x.color === (l.color ?? '')) ??
        ordered(p)[0];
      if (v) v.stock += l.quantity;
    }
  }

  /** set_order_status. Refunding never returns stock: the goods may have shipped, so the owner adjusts it by hand. */
  function setStatus(rawId: string, status: OrderStatus, from?: OrderStatus): SetStatusResult {
    const order = orders.get(rawId.toLowerCase());
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status === status && (from === undefined || from === order.status)) {
      return { ok: true, changed: false, order: structuredClone(order) };
    }
    // cancelled -> refunded needs the refund_due flag: only a cancelled order that was paid after the fact.
    const allowed = ORDER_TRANSITIONS[order.status]?.includes(status) &&
      !(order.status === 'cancelled' && order.paymentFlag !== 'refund_due');
    if ((from !== undefined && from !== order.status) || !allowed) {
      return { ok: false, reason: 'bad_transition', from: order.status, to: status, order: structuredClone(order) };
    }
    if (status === 'cancelled' || status === 'expired') returnStock(order.lines);
    if (status === 'paid') order.paidAt = order.paidAt ?? iso();
    if (['paid', 'packed', 'shipped', 'delivered', 'refunded'].includes(status)) order.expiresAt = null;
    if (status === 'refunded' && order.paymentFlag === 'refund_due') order.paymentFlag = null;
    order.status = status;
    return { ok: true, changed: true, order: structuredClone(order) };
  }

  /** get_order */
  function get(rawId: string): Order | null {
    const o = orders.get(rawId.toLowerCase());
    return o ? structuredClone(o) : null;
  }

  /** set_order_tracking: a missing key keeps the stored value, a string is trimmed, empty or null clears it. */
  function setTracking(rawId: string, t: TrackingInput): SetTrackingResult {
    const order = orders.get(rawId.toLowerCase());
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status !== 'packed' && order.status !== 'shipped') {
      return { ok: false, reason: 'bad_status', order: structuredClone(order) };
    }
    const next = { courier: null, number: null, url: null, ...order.tracking } as {
      courier: string | null;
      number: string | null;
      url: string | null;
    };
    for (const k of ['courier', 'number', 'url'] as const) {
      if (t[k] !== undefined) next[k] = t[k]?.trim() || null;
    }
    order.tracking = next.courier === null && next.number === null && next.url === null ? null : next;
    return { ok: true, order: structuredClone(order) };
  }

  /** extend_order: expires_at = greatest(expires_at, now) + 48 hours, for a pending order that has an expiry. */
  function extend(rawId: string): ExtendResult {
    const order = orders.get(rawId.toLowerCase());
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status !== 'pending' || !order.expiresAt) {
      return { ok: false, reason: 'not_extendable', order: structuredClone(order) };
    }
    order.expiresAt = iso(Math.max(Date.parse(order.expiresAt), now()) + EXTEND_MS);
    return { ok: true, order: structuredClone(order) };
  }

  /** set_payment_window: an awaiting_payment order only; expires_at = now + hours. */
  function setPaymentWindow(rawId: string, hours: number): SetPaymentWindowResult {
    const order = orders.get(rawId.toLowerCase());
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status !== 'awaiting_payment') return { ok: false, reason: 'bad_status', order: structuredClone(order) };
    order.expiresAt = iso(now() + hours * HOUR_MS);
    return { ok: true, order: structuredClone(order) };
  }

  /** lookup_order: the per-address count comes first and every lookup counts; a refused one is not logged. */
  function lookup(ref: string, phone: string, ip?: string): LookupResult {
    if (ip) {
      const recent = (lookupLog.get(ip) ?? []).filter((t) => t > now() - HOUR_MS);
      if (recent.length >= LOOKUPS_PER_IP) {
        lookupLog.set(ip, recent);
        return { ok: false, reason: 'rate_limited' };
      }
      lookupLog.set(ip, [...recent, now()]);
    }
    const wantRef = ref.trim().toUpperCase();
    const digits = (s: string) => s.replace(/\D/g, '');
    const wantPhone = digits(phone);
    if (wantRef.length !== 8 || wantPhone.length < 7) return { ok: false, reason: 'not_found' };
    const found = [...orders.values()]
      .filter((o) => o.ref.toUpperCase() === wantRef && digits(o.customer.phone ?? '').slice(-9) === wantPhone.slice(-9))
      .sort((a, b) => cmp(b.createdAt, a.createdAt) || cmp(a.id, b.id))[0];
    return found ? { ok: true, id: found.id } : { ok: false, reason: 'not_found' };
  }

  /** cancel_order_v2: the order, unchanged when it cannot be cancelled; null when unknown. */
  function cancel(rawId: string): Order | null {
    const r = setStatus(rawId, 'cancelled');
    return r.ok || r.reason === 'bad_transition' ? r.order : null;
  }

  /** expire_one_order: recheck under the lock, then cancel (pending) or expire (awaiting_payment). Returns the
   *  new status, or 'skipped'. An order with no expiry is never touched. */
  function expireOne(id: string): string {
    const o = orders.get(id);
    if (!o || !o.expiresAt || Date.parse(o.expiresAt) > now()) return 'skipped';
    if (o.status !== 'pending' && o.status !== 'awaiting_payment') return 'skipped';
    const r = setStatus(id, o.status === 'pending' ? 'cancelled' : 'expired', o.status);
    return r.ok ? r.order.status : 'skipped';
  }

  /** expire_due_orders: the due ids are collected first, then each is handled on its own; one that throws is
   *  logged and the rest still run. */
  function expireDue(): string[] {
    const due = [...orders.values()]
      .filter((o) => (o.status === 'pending' || o.status === 'awaiting_payment') && o.expiresAt && Date.parse(o.expiresAt) <= now())
      .sort((a, b) => cmp(a.expiresAt!, b.expiresAt!) || cmp(a.id, b.id))
      .map((o) => o.id);
    const changed: string[] = [];
    for (const id of due) {
      try {
        if (expireOne(id) !== 'skipped') changed.push(id);
      } catch (e) {
        console.warn(`expire_due_orders: order ${id} failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
    for (const [ip, times] of ipLog) {
      const recent = times.filter((t) => t >= now() - HOUR_MS);
      if (recent.length === 0) ipLog.delete(ip);
      else ipLog.set(ip, recent);
    }
    return changed;
  }

  /** order_payment_info */
  function paymentInfo(rawId: string): PaymentInfo | null {
    const id = rawId.toLowerCase();
    const o = orders.get(id);
    if (!o) return null;
    return {
      id: o.id,
      ref: o.ref,
      status: o.status,
      total: o.total,
      email: o.customer.email || null,
      paymentUrl: payments.get(id)?.url ?? null,
    };
  }

  /** attach_payment: the first reference and URL win, and only while the order is awaiting_payment. */
  function attachPayment(rawId: string, reference: string, url: string): boolean {
    const id = rawId.toLowerCase();
    const o = orders.get(id);
    if (!reference || !url || !o || o.status !== 'awaiting_payment') return false;
    const stored = payments.get(id);
    if (stored) return stored.reference === reference && stored.url === url;
    if ([...payments.values()].some((p) => p.reference === reference)) throw new Error('duplicate payment reference');
    payments.set(id, { reference, url });
    return true;
  }

  /** record_payment: see the migration for the outcomes. The late path (expired or cancelled) bypasses
   *  ORDER_TRANSITIONS on purpose, and uses only each line's exact variant. */
  function recordPayment(reference: string, amountCents: number, currency: string): RecordPaymentResult {
    const found = [...payments.entries()].find(([, p]) => p.reference === reference && reference !== '');
    const order = found ? orders.get(found[0]) : undefined;
    if (!order) return { ok: false, reason: 'not_found' };
    if (amountCents !== Math.round(order.total * 100) || currency !== 'ZAR') {
      order.paymentFlag ??= 'amount_mismatch';
      return { ok: false, reason: 'amount_mismatch' };
    }
    if (['paid', 'packed', 'shipped', 'delivered', 'refunded'].includes(order.status) || order.paymentFlag === 'refund_due') {
      return { ok: true, changed: false, outcome: 'already' };
    }
    if (order.status === 'awaiting_payment' || order.status === 'pending') {
      setStatus(order.id, 'paid');
      if (order.paymentFlag === 'amount_mismatch') order.paymentFlag = null; // the verified payment is correct
      return { ok: true, changed: true, outcome: 'paid' };
    }
    // Late: expired or cancelled. Every line's exact variant must still exist with enough stock, summed per variant.
    const want = new Map<string, number>();
    for (const l of order.lines) want.set(l.variantId ?? '', (want.get(l.variantId ?? '') ?? 0) + l.quantity);
    const variants = new Map(
      [...db.products.values()].flatMap((p) => p.variants).map((v) => [v.id, v] as const),
    );
    const canServe = [...want].every(([vid, qty]) => (variants.get(vid)?.stock ?? -1) >= qty);
    order.paidAt ??= iso();
    if (canServe) {
      for (const [vid, qty] of want) variants.get(vid)!.stock -= qty;
      order.status = 'paid';
      order.expiresAt = null;
      order.paymentFlag = null;
      return { ok: true, changed: true, outcome: 'paid_late' };
    }
    order.paymentFlag = 'refund_due';
    return { ok: true, changed: true, outcome: 'refund_due' };
  }

  return {
    place: (id, items, customer, opts) => lock(() => Promise.resolve(place(id, items, customer, opts))),
    paymentInfo: (id) => lock(() => Promise.resolve(paymentInfo(id))),
    attachPayment: (id, reference, url) => lock(() => Promise.resolve(attachPayment(id, reference, url))),
    recordPayment: (reference, cents, currency) => lock(() => Promise.resolve(recordPayment(reference, cents, currency))),
    cancel: (id) => lock(() => Promise.resolve(cancel(id))),
    expireDue: () => lock(() => Promise.resolve(expireDue())),
    setStatus: (id, status, from) => lock(() => Promise.resolve(setStatus(id, status, from))),
    get: (id) => lock(() => Promise.resolve(get(id))),
    setTracking: (id, t) => lock(() => Promise.resolve(setTracking(id, t))),
    extend: (id) => lock(() => Promise.resolve(extend(id))),
    setPaymentWindow: (id, hours) => lock(() => Promise.resolve(setPaymentWindow(id, hours))),
    lookup: (ref, phone, ip) => lock(() => Promise.resolve(lookup(ref, phone, ip))),
    patch: (id, fields) => {
      const order = orders.get(id.toLowerCase());
      if (!order) throw new Error('no such order');
      Object.assign(order, fields);
    },
    list: () =>
      Promise.resolve(
        [...orders.values()]
          .map((o) => structuredClone(o))
          // Newest first; later insertion wins when timestamps tie.
          .reverse()
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
      ),
  };
}

// --- Events and tickets: mirrors 20261031120000_events.sql ------------------------------------------------------

type StoredEvent = Omit<AdminEvent, 'ticketTypes'>;
type StoredTicketType = Omit<AdminTicketType, 'available' | 'onSale'>;

/** Most RSVP requests per client address in a rolling hour. */
const RSVPS_PER_IP = 5;
const SIX_HOURS_MS = 6 * HOUR_MS;
const DAY_MS = 24 * HOUR_MS;

/** 16 random bytes as 32 lowercase hex characters: the same 128 bits as gen_random_bytes(16) in SQL. */
const newTicketCode = (): string =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * In-memory events, ticket types and tickets that mirror the functions in 20261031120000_events.sql: the same
 * results, reasons and rules. The shared lock stands in for the ticket_types row lock. `now` is the clock
 * (milliseconds), so tests can jump time. The address limit keys on the address itself (SQL keeps a salted hash).
 */
export function memoryEvents(lock: Lock = createLock(), now: () => number = Date.now): EventStore {
  const events = new Map<string, StoredEvent>();
  const types = new Map<string, StoredTicketType>();
  const tickets = new Map<string, Ticket>();
  const rsvpLog = new Map<string, number[]>();
  const iso = (ms: number = now()) => new Date(ms).toISOString();
  const ms = (s: string) => Date.parse(s);

  /** event_ended */
  const ended = (e: StoredEvent) => (e.endsAt ? ms(e.endsAt) : ms(e.startsAt) + SIX_HOURS_MS) < now();

  /** ticket_type_json */
  function typeView(t: StoredTicketType, admin: boolean): AdminTicketType | PublicEvent['ticketTypes'][number] {
    const e = events.get(t.eventId)!;
    const onSale = t.active &&
      (t.saleStartsAt === null || ms(t.saleStartsAt) <= now()) &&
      (t.saleEndsAt === null || ms(t.saleEndsAt) > now()) &&
      !ended(e);
    const base = { id: t.id, name: t.name, price: t.price, available: Math.max(t.capacity - t.sold, 0), onSale };
    return structuredClone(admin ? { ...base, ...t, price: t.price } : base);
  }

  /** event_json */
  function eventView(e: StoredEvent, admin: true): AdminEvent;
  function eventView(e: StoredEvent, admin: false): PublicEvent;
  function eventView(e: StoredEvent, admin: boolean): AdminEvent | PublicEvent {
    const ts = [...types.values()]
      .filter((t) => t.eventId === e.id && (admin || t.active))
      .sort((a, b) => a.sort - b.sort || cmp(a.name, b.name) || cmp(a.id, b.id))
      .map((t) => typeView(t, admin));
    const { status, createdAt, ...pub } = e;
    return structuredClone(
      admin ? { ...pub, status, createdAt, ticketTypes: ts } : { ...pub, ticketTypes: ts },
    ) as AdminEvent | PublicEvent;
  }

  /** group_tickets_json: the first-issued ticket first, then by creation time and code. */
  const group = (groupId: string): Ticket[] =>
    [...tickets.values()]
      .filter((t) => t.groupId === groupId)
      .sort((a, b) =>
        Number(a.id !== a.groupId) - Number(b.id !== b.groupId) || cmp(a.createdAt, b.createdAt) || cmp(a.code, b.code)
      )
      .map((t) => structuredClone(t));

  /** issue_tickets, in two steps: `plan` is everything up to the capacity check, `commit` takes the seats. */
  type Plan = { ok: true; type: StoredTicketType; event: StoredEvent } | Extract<IssueResult, { ok: false }>;
  function plan(groupId: string, eventId: string | null, typeId: string, qty: number, source: 'rsvp' | 'issued'): Plan {
    if ([...tickets.values()].some((t) => t.groupId === groupId)) return { ok: false, reason: 'id_taken' };
    const type = types.get(typeId);
    if (!type || (eventId !== null && type.eventId !== eventId)) return { ok: false, reason: 'not_found' };
    const event = events.get(type.eventId)!;
    if (source === 'rsvp') {
      if (type.price !== 0) return { ok: false, reason: 'paid_type' };
      if (ended(event)) return { ok: false, reason: 'event_ended' };
      if (
        !type.active || (type.saleStartsAt !== null && ms(type.saleStartsAt) > now()) ||
        (type.saleEndsAt !== null && ms(type.saleEndsAt) <= now())
      ) return { ok: false, reason: 'not_on_sale' };
    } else if (event.status === 'cancelled') {
      return { ok: false, reason: 'event_cancelled' };
    }
    if (type.sold + qty > type.capacity) {
      return { ok: false, reason: 'sold_out', available: Math.max(type.capacity - type.sold, 0) };
    }
    return { ok: true, type, event };
  }
  function commit(p: Extract<Plan, { ok: true }>, groupId: string, qty: number, holder: TicketHolder, source: 'rsvp' | 'issued') {
    p.type.sold += qty;
    for (let i = 0; i < qty; i++) {
      const id = i === 0 ? groupId : crypto.randomUUID();
      tickets.set(id, {
        id,
        code: newTicketCode(),
        groupId,
        eventId: p.event.id,
        eventTitle: p.event.title,
        eventSlug: p.event.slug,
        startsAt: p.event.startsAt,
        venue: p.event.venue,
        city: p.event.city,
        ticketTypeId: p.type.id,
        ticketTypeName: p.type.name,
        holderName: holder.name.trim(),
        holderPhone: holder.phone.trim(),
        holderEmail: holder.email?.trim() || null,
        source,
        checkedInAt: null,
        voidedAt: null,
        createdAt: iso(),
      });
    }
  }
  /** The ticket fields that come from its event and type, read fresh like ticket_json's join. */
  const fresh = (t: Ticket): Ticket => {
    const e = events.get(t.eventId)!;
    const tt = types.get(t.ticketTypeId)!;
    return structuredClone({
      ...t,
      eventTitle: e.title,
      eventSlug: e.slug,
      startsAt: e.startsAt,
      venue: e.venue,
      city: e.city,
      ticketTypeName: tt.name,
    });
  };
  const byCode = (code: string) => {
    const c = code.trim().toLowerCase();
    return [...tickets.values()].find((t) => t.code === c);
  };

  function rsvp(id: string, slug: string, typeId: string, qty: number, holder: TicketHolder, ip?: string): IssueResult {
    if (!Number.isInteger(qty) || qty < 1 || qty > 4) return { ok: false, reason: 'bad_quantity' };
    const existing = group(id);
    if (existing.length > 0 && existing[0].source === 'rsvp' && existing[0].eventSlug === slug) {
      return { ok: true, created: false, tickets: existing.map(fresh) };
    }
    const event = [...events.values()].find((e) => e.slug === slug && e.status === 'published');
    if (!event) return { ok: false, reason: 'not_found' };
    const p = plan(id, event.id, typeId, qty, 'rsvp');
    if (!p.ok) return p;
    // The address limit, last: over it, nothing is kept.
    if (ip) {
      const recent = (rsvpLog.get(ip) ?? []).filter((t) => t > now() - HOUR_MS);
      if (recent.length >= RSVPS_PER_IP) {
        rsvpLog.set(ip, recent);
        return { ok: false, reason: 'rate_limited' };
      }
      rsvpLog.set(ip, [...recent, now()]);
    }
    commit(p, id, qty, holder, 'rsvp');
    return { ok: true, created: true, tickets: group(id) };
  }

  function issue(id: string, typeId: string, qty: number, holder: TicketHolder): IssueResult {
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return { ok: false, reason: 'bad_quantity' };
    const existing = group(id);
    if (existing.length > 0 && existing[0].source === 'issued') return { ok: true, created: false, tickets: existing };
    const p = plan(id, null, typeId, qty, 'issued');
    if (!p.ok) return p;
    commit(p, id, qty, holder, 'issued');
    return { ok: true, created: true, tickets: group(id) };
  }

  /** upsert_event */
  function upsertEvent(id: string, input: EventInput): UpsertEventResult {
    const ex = events.get(id);
    const starts = input.startsAt !== undefined ? input.startsAt : (ex?.startsAt ?? null);
    const ends = input.endsAt !== undefined ? input.endsAt : (ex?.endsAt ?? null);
    if (ends !== null && starts !== null && ms(ends) < ms(starts)) return { ok: false, reason: 'bad_dates' };
    if (!ex && (!input.title?.trim() || starts === null)) return { ok: false, reason: 'missing_fields' };
    let slug: string;
    if (input.slug) {
      if ([...events.values()].some((e) => e.slug === input.slug && e.id !== id)) return { ok: false, reason: 'slug_taken' };
      slug = input.slug;
    } else if (ex) {
      slug = ex.slug;
    } else {
      const base = (input.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';
      slug = base.slice(0, 60);
      for (let n = 2; [...events.values()].some((e) => e.slug === slug); n++) slug = `${base.slice(0, 60)}-${n}`;
    }
    if (!ex) {
      const e: StoredEvent = {
        id,
        slug,
        title: input.title!.trim(),
        description: input.description ?? '',
        startsAt: starts!,
        endsAt: ends,
        venue: input.venue ?? '',
        city: input.city ?? '',
        image: input.image ?? '',
        status: input.status ?? 'draft',
        createdAt: iso(),
      };
      events.set(id, e);
      return { ok: true, created: true, event: eventView(e, true) };
    }
    ex.slug = slug;
    ex.title = input.title?.trim() || ex.title;
    ex.description = input.description ?? ex.description;
    ex.startsAt = starts!;
    ex.endsAt = ends;
    ex.venue = input.venue ?? ex.venue;
    ex.city = input.city ?? ex.city;
    ex.image = input.image ?? ex.image;
    ex.status = input.status ?? ex.status;
    return { ok: true, created: false, event: eventView(ex, true) };
  }

  /** delete_event */
  function deleteEvent(id: string): DeleteEventResult {
    if (!events.has(id)) return { ok: false, reason: 'not_found' };
    if ([...tickets.values()].some((t) => t.eventId === id)) return { ok: false, reason: 'has_tickets' };
    for (const t of [...types.values()]) if (t.eventId === id) types.delete(t.id);
    events.delete(id);
    return { ok: true };
  }

  /** upsert_ticket_type */
  function upsertTicketType(id: string, input: TicketTypeInput): UpsertTicketTypeResult {
    const ex = types.get(id);
    const capacity = input.capacity !== undefined ? input.capacity : ex?.capacity;
    const from = input.saleStartsAt !== undefined ? input.saleStartsAt : (ex?.saleStartsAt ?? null);
    const to = input.saleEndsAt !== undefined ? input.saleEndsAt : (ex?.saleEndsAt ?? null);
    if (from !== null && to !== null && ms(to) < ms(from)) return { ok: false, reason: 'bad_dates' };
    if (!ex) {
      if (!input.eventId || !events.has(input.eventId)) return { ok: false, reason: 'event_not_found' };
      if (!input.name?.trim()) return { ok: false, reason: 'missing_fields' };
      const t: StoredTicketType = {
        id,
        eventId: input.eventId,
        name: input.name.trim(),
        price: input.price ?? 0,
        capacity: capacity ?? 0,
        sold: 0,
        saleStartsAt: from,
        saleEndsAt: to,
        active: input.active ?? true,
        sort: input.sort ?? 0,
      };
      types.set(id, t);
      return { ok: true, created: true, ticketType: typeView(t, true) as AdminTicketType };
    }
    if ((capacity ?? 0) < ex.sold) return { ok: false, reason: 'capacity_below_sold', sold: ex.sold };
    ex.name = input.name?.trim() || ex.name;
    ex.price = input.price ?? ex.price;
    ex.capacity = capacity!;
    ex.saleStartsAt = from;
    ex.saleEndsAt = to;
    ex.active = input.active ?? ex.active;
    ex.sort = input.sort ?? ex.sort;
    return { ok: true, created: false, ticketType: typeView(ex, true) as AdminTicketType };
  }

  /** delete_ticket_type */
  function deleteTicketType(id: string): DeleteEventResult {
    const t = types.get(id);
    if (!t) return { ok: false, reason: 'not_found' };
    if (t.sold > 0 || [...tickets.values()].some((k) => k.ticketTypeId === id)) return { ok: false, reason: 'has_tickets' };
    types.delete(id);
    return { ok: true };
  }

  /** check_in_ticket: the first call wins; an offline scan time is kept only within the past 24 hours. */
  function checkIn(code: string, at?: string, eventId?: string): CheckInResult {
    const t = byCode(code);
    if (!t) return { result: 'not_found' };
    if (eventId && t.eventId !== eventId) return { result: 'wrong_event', ticket: fresh(t), checkedInAt: t.checkedInAt };
    if (t.checkedInAt === null && t.voidedAt === null) {
      const when = at !== undefined ? ms(at) : NaN;
      t.checkedInAt = !Number.isNaN(when) && when <= now() && when >= now() - DAY_MS ? iso(when) : iso();
      return { result: 'ok', ticket: fresh(t), checkedInAt: t.checkedInAt };
    }
    return { result: t.voidedAt !== null ? 'void' : 'already', ticket: fresh(t), checkedInAt: t.checkedInAt };
  }

  /** void_ticket: the seat goes back once; a used ticket cannot be voided. */
  function voidTicket(code: string): VoidResult {
    const t = byCode(code);
    if (!t) return { ok: false, reason: 'not_found' };
    if (t.checkedInAt !== null) return { ok: false, reason: 'used', ticket: fresh(t) };
    if (t.voidedAt !== null) return { ok: true, changed: false, ticket: fresh(t) };
    t.voidedAt = iso();
    types.get(t.ticketTypeId)!.sold -= 1;
    return { ok: true, changed: true, ticket: fresh(t) };
  }

  const published = () => [...events.values()].filter((e) => e.status === 'published');

  return {
    listPublic: (past = false) =>
      lock(() =>
        Promise.resolve(
          published()
            .filter((e) => ended(e) === past)
            .sort((a, b) => (past ? -1 : 1) * (ms(a.startsAt) - ms(b.startsAt)) || cmp(a.id, b.id))
            .map((e) => eventView(e, false)),
        )
      ),
    getPublic: (slug) =>
      lock(() => {
        const e = published().find((k) => k.slug === slug);
        return Promise.resolve(e ? eventView(e, false) : null);
      }),
    rsvp: (id, slug, typeId, qty, holder, ip) => lock(() => Promise.resolve(rsvp(id, slug, typeId, qty, holder, ip))),
    getTicket: (code) =>
      lock(() => {
        const t = byCode(code);
        return Promise.resolve(t ? fresh(t) : null);
      }),
    listAdmin: () =>
      lock(() =>
        Promise.resolve(
          [...events.values()]
            .sort((a, b) => ms(b.startsAt) - ms(a.startsAt) || cmp(a.id, b.id))
            .map((e) => eventView(e, true)),
        )
      ),
    upsertEvent: (id, input) => lock(() => Promise.resolve(upsertEvent(id, input))),
    deleteEvent: (id) => lock(() => Promise.resolve(deleteEvent(id))),
    upsertTicketType: (id, input) => lock(() => Promise.resolve(upsertTicketType(id, input))),
    deleteTicketType: (id) => lock(() => Promise.resolve(deleteTicketType(id))),
    issue: (id, typeId, qty, holder) => lock(() => Promise.resolve(issue(id, typeId, qty, holder))),
    listTickets: (eventId) =>
      lock(() =>
        Promise.resolve(
          events.has(eventId)
            ? [...tickets.values()]
              .filter((t) => t.eventId === eventId)
              .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.holderName, b.holderName) || cmp(a.id, b.id))
              .map(fresh)
            : null,
        )
      ),
    checkIn: (code, at, eventId) => lock(() => Promise.resolve(checkIn(code, at, eventId))),
    voidTicket: (code) => lock(() => Promise.resolve(voidTicket(code))),
  };
}

// --- Community: mirrors 20261031130000_community.sql ------------------------------------------------------------

/** Most sign-ups and unsubscribes together per client address in a rolling hour. */
const SIGNUPS_PER_IP = 5;

type StoredSubscriber = Subscriber & { consentText: string };

/**
 * The address limit, shared by sign-ups, unsubscribes and restock requests (one log, like subscribe_ip_log). Returns
 * `takeSlot`: true when the address may go ahead (and the use is recorded), false when it is over the limit (nothing
 * recorded). No address, no limit. Share ONE between memoryCommunity and memoryRestock, as SQL shares the one table.
 */
export function createSignupLimit(now: () => number = Date.now): (ip: string | undefined) => boolean {
  const log = new Map<string, number[]>();
  return (ip) => {
    if (!ip) return true;
    const recent = (log.get(ip) ?? []).filter((t) => t > now() - HOUR_MS);
    if (recent.length >= SIGNUPS_PER_IP) {
      log.set(ip, recent);
      return false;
    }
    log.set(ip, [...recent, now()]);
    return true;
  };
}

/**
 * In-memory gallery and mailing list that mirror the functions in 20261031130000_community.sql: the same results,
 * reasons and rules. It has its own lock (not the shared one): `eventExists` reads the events store, which takes
 * the shared lock, so sharing it would deadlock. `eventExists` stands in for the foreign key to events (a link to an event that is gone reads
 * as no link, like on delete set null). `now` is the clock (milliseconds). The sign-up limit keys on the address
 * itself (SQL keeps a salted hash); pass `takeSlot` from createSignupLimit to share it with memoryRestock.
 * `onOptOut` is called for an unsubscribe with a phone or email, after the limit, to remove the restock requests of
 * that contact (SQL does it in the same update branch).
 */
export function memoryCommunity(
  lock: Lock = createLock(),
  now: () => number = Date.now,
  eventExists: (id: string) => Promise<boolean> = () => Promise.resolve(false),
  takeSlot: (ip: string | undefined) => boolean = createSignupLimit(now),
  onOptOut: (contact: { pn: string | null; email: string | undefined }) => Promise<void> = () => Promise.resolve(),
): CommunityStore {
  const gallery = new Map<string, AdminGalleryItem>();
  const subscribers = new Map<string, StoredSubscriber>();
  const iso = () => new Date(now()).toISOString();
  // created_at ties (same millisecond) keep insertion order the way a serial clock would: a later row is "newer".
  let seq = 0;
  const order = new Map<string, number>();

  const sortedGallery = async (activeOnly: boolean): Promise<AdminGalleryItem[]> => {
    const items = [...gallery.values()]
      .filter((g) => !activeOnly || g.active)
      .sort((a, b) => a.sort - b.sort || (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0));
    return await Promise.all(
      items.map(async (g) => ({ ...g, eventId: g.eventId && (await eventExists(g.eventId)) ? g.eventId : null })),
    );
  };

  const view = (s: StoredSubscriber): Subscriber => {
    const { consentText: _text, ...rest } = s;
    return { ...rest };
  };

  return {
    listGalleryPublic: () =>
      lock(async () =>
        (await sortedGallery(true)).map(({ id, image, caption, eventId }) => ({ id, image, caption, eventId }))
      ),
    listGalleryAdmin: () => lock(() => sortedGallery(false)),
    upsertGalleryItem: (id: string, input: GalleryInput) =>
      lock(async (): Promise<UpsertGalleryResult> => {
        const ex = gallery.get(id);
        let eventId = ex?.eventId ?? null;
        if (input.eventId !== undefined) {
          if (input.eventId !== null && !(await eventExists(input.eventId))) return { ok: false, reason: 'event_not_found' };
          eventId = input.eventId;
        }
        if (!ex) {
          if (!input.image) return { ok: false, reason: 'missing_fields' };
          const item: AdminGalleryItem = {
            id,
            image: input.image,
            caption: input.caption ?? '',
            eventId,
            sort: input.sort ?? 0,
            active: input.active ?? true,
            createdAt: iso(),
          };
          gallery.set(id, item);
          order.set(id, ++seq);
          return { ok: true, created: true, item };
        }
        const item: AdminGalleryItem = {
          ...ex,
          image: input.image || ex.image,
          caption: input.caption ?? ex.caption,
          eventId,
          sort: input.sort ?? ex.sort,
          active: input.active ?? ex.active,
        };
        gallery.set(id, item);
        return { ok: true, created: false, item };
      }),
    deleteGalleryItem: (id: string) => lock(() => Promise.resolve(gallery.delete(id))),
    subscribe: (input, consentText, ip) =>
      lock((): Promise<Awaited<ReturnType<CommunityStore['subscribe']>>> => {
        if (!takeSlot(ip)) return Promise.resolve({ ok: false as const, reason: 'rate_limited' as const });
        const pn = input.phone ? normalisePhone(input.phone) : null;
        const email = input.email?.toLowerCase();
        const all = [...subscribers.values()];
        const byPhone = pn ? all.find((s) => s.phone && normalisePhone(s.phone) === pn) : undefined;
        const byEmail = email ? all.find((s) => s.email && s.email.toLowerCase() === email) : undefined;
        const ex = byPhone ?? byEmail;
        if (!ex) {
          const id = crypto.randomUUID();
          subscribers.set(id, {
            id,
            name: input.name ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            source: input.source,
            consentAt: iso(),
            unsubscribedAt: null,
            createdAt: iso(),
            consentText,
          });
          order.set(id, ++seq);
        } else {
          ex.name = input.name ?? ex.name;
          if (!ex.phone && !byPhone) ex.phone = input.phone ?? null;
          if (!ex.email && !byEmail) ex.email = input.email ?? null;
          ex.consentText = consentText;
          ex.consentAt = iso();
          ex.unsubscribedAt = null;
        }
        return Promise.resolve({ ok: true as const });
      }),
    unsubscribeContact: (input, ip) =>
      lock(async (): Promise<Awaited<ReturnType<CommunityStore['unsubscribeContact']>>> => {
        if (!takeSlot(ip)) return { ok: false as const, reason: 'rate_limited' as const };
        const pn = input.phone ? normalisePhone(input.phone) : null;
        const email = input.email?.toLowerCase();
        for (const s of subscribers.values()) {
          const hit = (pn && s.phone && normalisePhone(s.phone) === pn) || (email && s.email && s.email.toLowerCase() === email);
          if (hit) s.unsubscribedAt ??= iso();
        }
        if (pn || email) await onOptOut({ pn, email });
        return { ok: true as const };
      }),
    listSubscribers: () =>
      lock(() =>
        Promise.resolve(
          [...subscribers.values()]
            .sort((a, b) => (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0))
            .map(view),
        )
      ),
    unsubscribe: (id) =>
      lock(() => {
        const s = subscribers.get(id);
        if (!s) return Promise.resolve(null);
        s.unsubscribedAt ??= iso();
        return Promise.resolve(view(s));
      }),
  };
}

// --- Restock alerts: mirrors 20261031150000_restock_alerts.sql ---------------------------------------------------

/** Requests older than this are deleted, at most RESTOCK_PURGE_BATCH per call. */
const RESTOCK_KEEP_MS = 180 * DAY_MS;
const RESTOCK_PURGE_BATCH = 200;

/** The in-memory restock store, plus what memoryCommunity's `onOptOut` needs. */
export type MemoryRestockStore = RestockStore & {
  /** What unsubscribe_contact does to restock_requests: delete every request whose normalised phone or lower-cased
   *  email matches. `pn` is the normalised phone, `email` the lower-cased address. */
  removeContact(contact: { pn: string | null; email: string | undefined }): Promise<void>;
};

type StoredRestock = { id: string; productId: string; variantId: string; phone: string | null; email: string | null; at: number; seq: number };

/**
 * In-memory restock requests that mirror the functions in 20261031150000_restock_alerts.sql: the same results,
 * reasons and rules. `getProduct` looks a product up by id (it stands in for the joins and the foreign keys: a
 * request whose product or variant is gone is dropped, like on delete cascade). `takeSlot` is the address limit
 * from createSignupLimit, the same one memoryCommunity uses. It has its own lock, so it never waits on the
 * community store's.
 */
export function memoryRestock(
  lock: Lock = createLock(),
  now: () => number = Date.now,
  takeSlot: (ip: string | undefined) => boolean = createSignupLimit(now),
  getProduct: (id: string) => Promise<Product | null> = () => Promise.resolve(null),
): MemoryRestockStore {
  const rows = new Map<string, StoredRestock>();
  let seq = 0;
  const iso = (ms: number) => new Date(ms).toISOString();

  const lookup = async (productId: string, variantId: string) => {
    const p = await getProduct(productId);
    if (!p || p.id !== productId) return null;
    const v = p.variants.find((x) => x.id === variantId);
    return v ? { p, v } : null;
  };

  // on delete cascade: a request goes with its product or variant.
  const dropOrphans = async () => {
    for (const r of [...rows.values()]) if (!(await lookup(r.productId, r.variantId))) rows.delete(r.id);
  };

  const sameContact = (r: StoredRestock, pn: string | null, email: string | undefined) =>
    Boolean((pn && r.phone && normalisePhone(r.phone) === pn) || (email && r.email && r.email.toLowerCase() === email));

  return {
    request: (input, ip) =>
      lock(async (): Promise<RestockResult> => {
        if (!takeSlot(ip)) return { ok: false, reason: 'rate_limited' };
        await dropOrphans();
        // Personal data must not linger: requests past 180 days go, oldest first, at most 200 per call.
        const old = [...rows.values()].filter((r) => r.at <= now() - RESTOCK_KEEP_MS).sort((a, b) => a.at - b.at || a.seq - b.seq);
        for (const r of old.slice(0, RESTOCK_PURGE_BATCH)) rows.delete(r.id);
        const hit = await lookup(input.productId, input.variantId);
        if (!hit || !hit.p.active) return { ok: false, reason: 'not_found' };
        if (hit.v.stock > 0) return { ok: false, reason: 'in_stock' };
        const pn = input.phone ? normalisePhone(input.phone) : null;
        const email = input.email?.toLowerCase();
        const repeat = [...rows.values()].some((r) => r.variantId === input.variantId && sameContact(r, pn, email));
        if (!repeat) {
          const id = crypto.randomUUID();
          rows.set(id, {
            id,
            productId: input.productId,
            variantId: input.variantId,
            phone: input.phone ?? null,
            email: input.email ?? null,
            at: now(),
            seq: ++seq,
          });
        }
        return { ok: true };
      }),
    list: () =>
      lock(async (): Promise<RestockRequest[]> => {
        await dropOrphans();
        const out: RestockRequest[] = [];
        for (const r of [...rows.values()].sort((a, b) => a.at - b.at || a.seq - b.seq)) {
          const hit = await lookup(r.productId, r.variantId);
          if (!hit) continue;
          out.push({
            id: r.id,
            productId: r.productId,
            productName: hit.p.name,
            productSlug: hit.p.slug,
            variantId: r.variantId,
            size: hit.v.size,
            color: hit.v.color,
            stock: hit.v.stock,
            phone: r.phone,
            email: r.email,
            createdAt: iso(r.at),
          });
        }
        return out;
      }),
    remove: (id) =>
      lock(async () => {
        await dropOrphans();
        return rows.delete(id);
      }),
    removeContact: ({ pn, email }) =>
      lock(() => {
        for (const r of [...rows.values()]) if (sameContact(r, pn, email)) rows.delete(r.id);
        return Promise.resolve();
      }),
  };
}

// --- Sending to the mailing list: mirrors 20261031160000_list_sends.sql ----------------------------------------

type ListSendState = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
type StoredListSend = {
  id: string;
  subject: string;
  body: string;
  createdAt: number;
  seq: number;
  finishedAt: number | null;
  /** Keyed by subscriber id, like the primary key (send_id, subscriber_id). */
  recipients: Map<string, { state: ListSendState; attempts: number }>;
};

/** A recipient is tried this many times before it is 'failed'. */
const LIST_SEND_MAX_ATTEMPTS = 3;

/**
 * In-memory list sends that mirror the functions in 20261031160000_list_sends.sql: the same snapshot, claim and finish
 * rules and the same summary. `listSubscribers` stands in for the subscribers table: it is read when a send is created
 * (the snapshot) and again when a batch is claimed (the address and the opt-out), as SQL joins subscribers at claim time.
 * Like the SQL, a row left 'sending' is never claimed again.
 */
export function memoryListSends(
  lock: Lock = createLock(),
  now: () => number = Date.now,
  listSubscribers: () => Promise<Subscriber[]> = () => Promise.resolve([]),
): ListSendStore {
  const all = new Map<string, StoredListSend>();
  let seq = 0;
  const iso = (ms: number) => new Date(ms).toISOString();

  const summary = (s: StoredListSend): ListSendSummary => {
    const n = (state: ListSendState) => [...s.recipients.values()].filter((r) => r.state === state).length;
    return {
      id: s.id,
      subject: s.subject,
      body: s.body,
      total: s.recipients.size,
      pending: n('pending'),
      sending: n('sending'),
      sent: n('sent'),
      failed: n('failed'),
      skipped: n('skipped'),
      createdAt: iso(s.createdAt),
      finishedAt: s.finishedAt === null ? null : iso(s.finishedAt),
    };
  };
  // list_send_close_if_done
  const closeIfDone = (s: StoredListSend) => {
    if (s.finishedAt === null && ![...s.recipients.values()].some((r) => r.state === 'pending' || r.state === 'sending')) {
      s.finishedAt = now();
    }
  };

  return {
    create: (id, input) =>
      lock(async () => {
        const existing = all.get(id);
        if (existing) return { created: false, send: summary(existing) };
        // The table checks: 1 to 150 and 1 to 10000 characters after trimming.
        if (input.subject.trim().length < 1 || input.subject.trim().length > 150) throw new Error('subject check violated');
        if (input.body.trim().length < 1 || input.body.trim().length > 10000) throw new Error('body check violated');
        const subscribers = await listSubscribers();
        const s: StoredListSend = {
          id,
          subject: input.subject,
          body: input.body,
          createdAt: now(),
          seq: ++seq,
          finishedAt: null,
          recipients: new Map(),
        };
        for (const sub of subscribers) {
          if (sub.unsubscribedAt === null && sub.email !== null) s.recipients.set(sub.id, { state: 'pending', attempts: 0 });
        }
        all.set(id, s);
        closeIfDone(s);
        return { created: true, send: summary(s) };
      }),
    claimBatch: (id, limit = 100) =>
      lock(async () => {
        const s = all.get(id);
        if (!s) return null;
        const byId = new Map((await listSubscribers()).map((x) => [x.id, x]));
        const recipients: ListSendRecipient[] = [];
        for (const subscriberId of [...s.recipients.keys()].sort()) {
          if (recipients.length >= Math.max(limit, 0)) break;
          const r = s.recipients.get(subscriberId)!;
          if (r.state !== 'pending') continue;
          const sub = byId.get(subscriberId);
          if (!sub || sub.unsubscribedAt !== null || sub.email === null) {
            r.state = 'skipped';
          } else {
            r.state = 'sending';
            r.attempts++;
            recipients.push({ subscriberId, email: sub.email });
          }
        }
        closeIfDone(s);
        return { recipients, summary: summary(s) };
      }),
    finishBatch: (id, subscriberIds, ok) =>
      lock(() => {
        const s = all.get(id);
        if (!s) return Promise.resolve(null);
        for (const subscriberId of new Set(subscriberIds)) {
          const r = s.recipients.get(subscriberId);
          if (!r || r.state !== 'sending') continue;
          r.state = ok ? 'sent' : r.attempts < LIST_SEND_MAX_ATTEMPTS ? 'pending' : 'failed';
        }
        closeIfDone(s);
        return Promise.resolve(summary(s));
      }),
    listAdmin: () =>
      lock(() =>
        Promise.resolve(
          [...all.values()].sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq).slice(0, 50).map(summary),
        )
      ),
  };
}

/** Dev only: two sample gallery photos (placeholder images) so /community has something to show. Never called by
 *  tests or by index.tsx: live data is never seeded. */
export async function seedSampleGallery(community: CommunityStore): Promise<void> {
  await community.upsertGalleryItem(crypto.randomUUID(), {
    image: 'https://picsum.photos/seed/4nguru-gallery-1/800/800',
    caption: 'Sample photo for local development',
    sort: 1,
  });
  await community.upsertGalleryItem(crypto.randomUUID(), {
    image: 'https://picsum.photos/seed/4nguru-gallery-2/800/800',
    caption: 'Another sample photo',
    sort: 2,
  });
}

/** One published sample event with a free and a paid ticket type, for `deno task dev` only. Never called by tests
 *  or by index.tsx: live data is never seeded. */
export async function seedSampleEvent(events: EventStore): Promise<void> {
  const eventId = crypto.randomUUID();
  const startsAt = new Date(Date.now() + 14 * DAY_MS);
  startsAt.setUTCHours(16, 0, 0, 0);
  await events.upsertEvent(eventId, {
    title: 'Sample Sunday Market',
    description: 'A sample event for local development. Free RSVP tickets and a paid table.',
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 5 * HOUR_MS).toISOString(),
    venue: 'The Yard',
    city: 'Johannesburg',
    status: 'published',
  });
  await events.upsertTicketType(crypto.randomUUID(), { eventId, name: 'Free RSVP', price: 0, capacity: 50, sort: 1 });
  await events.upsertTicketType(crypto.randomUUID(), { eventId, name: 'VIP table', price: 250, capacity: 10, sort: 2 });
}

/** Empty in-memory deps. Pass `seed: true` to add the sample categories and products. */
export async function createMemoryDeps(
  isAdmin: Deps['isAdmin'],
  seed = false,
  payments: PaymentProvider | null = null,
  now: () => number = Date.now,
): Promise<Deps & { orders: MemoryOrderStore }> {
  const db = createMemoryDb();
  const lock = createLock();
  const events = memoryEvents(lock, now);
  const products = memoryProducts(db, lock);
  // One address limit for sign-ups, unsubscribes and restock requests, like subscribe_ip_log.
  const takeSlot = createSignupLimit(now);
  const restock = memoryRestock(createLock(), now, takeSlot, (id) => products.get(id));
  const community = memoryCommunity(
    createLock(),
    now,
    async (id) => (await events.listAdmin()).some((e) => e.id === id),
    takeSlot,
    (contact) => restock.removeContact(contact),
  );
  const deps: Deps & { orders: MemoryOrderStore } = {
    products,
    categories: memoryCategories(db, lock),
    deliveryOptions: memoryDeliveryOptions(db),
    orders: memoryOrders(db, lock, now),
    events,
    community,
    restock,
    listSends: memoryListSends(createLock(), now, () => community.listSubscribers()),
    payments,
    mailer: null,
    siteUrl: null,
    isAdmin,
    uploadImage: () => Promise.resolve(`https://picsum.photos/seed/${crypto.randomUUID()}/800/800`),
  };
  if (seed) await seedCatalogue(deps.categories, deps.products);
  return deps;
}

if (import.meta.main) {
  // Online payment runs against the fake provider. Its secret is random and thrown away, so nothing outside
  // this process can sign a webhook.
  const deps = await createMemoryDeps(
    (h) => Promise.resolve(h === 'Bearer dev-admin' ? 'ok' : 'unauthenticated'),
    true,
    createFakeProvider(crypto.randomUUID()),
  );
  // Dev only: one published sample event. Tests and production never seed events.
  await seedSampleEvent(deps.events);
  // Dev only: two sample gallery photos.
  await seedSampleGallery(deps.community);
  // What pg_cron does in production: every five minutes, expire the orders that waited too long.
  setInterval(() => void deps.orders.expireDue(), 5 * 60 * 1000);
  Deno.serve({ port: 8787 }, createApp(deps).fetch);
}
