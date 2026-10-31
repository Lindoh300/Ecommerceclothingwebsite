// Local dev server with no Supabase. Run with: deno run --allow-net dev.ts
// Admin token: "Bearer dev-admin". Data lives in memory and resets on restart.
// The stores below mirror the Postgres functions in
// supabase/migrations/20261030000000_catalogue.sql, 20261030100000_order_lifecycle.sql,
// 20261030110000_delivery.sql, 20261030120000_payments.sql and 20261030130000_place_order_v3.sql
// (which also holds the order expiry; 20261030140000_order_expiry_cron.sql only schedules it).
// When one changes, change the other.
import { createApp, deriveImage, resolveVariant } from './app.ts';
import { createFakeProvider } from './fake_payments.ts';
import type { PaymentProvider } from './payments.ts';
import { seedCatalogue } from './seed.ts';
import type {
  Category,
  CategoryStore,
  CreateProductResult,
  Customer,
  DeleteCategoryResult,
  DeliveryOption,
  DeliveryOptionStore,
  Deps,
  Order,
  OrderItemInput,
  OrderLine,
  OrderStatus,
  OrderStore,
  PlaceOptions,
  PaymentInfo,
  PlaceOrderResult,
  Product,
  ProductStore,
  RecordPaymentResult,
  SetStatusResult,
  StockShortfall,
  UpdateProductResult,
  Variant,
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
const HOUR_MS = 60 * 60 * 1000;

/** Allowed order status moves (from -> to), the table in set_order_status.
 *  `pending -> expired` is not allowed: the expiry job cancels due pending orders. */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['paid', 'cancelled'],
  awaiting_payment: ['paid', 'cancelled', 'expired'],
  paid: ['packed', 'refunded'],
  packed: ['shipped', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  expired: ['refunded'],
  cancelled: [],
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
    if ((from !== undefined && from !== order.status) || !ORDER_TRANSITIONS[order.status]?.includes(status)) {
      return { ok: false, reason: 'bad_transition', from: order.status, to: status, order: structuredClone(order) };
    }
    if (status === 'cancelled' || status === 'expired') returnStock(order.lines);
    if (status === 'paid') order.paidAt = order.paidAt ?? iso();
    if (['paid', 'packed', 'shipped', 'delivered', 'refunded'].includes(status)) order.expiresAt = null;
    order.status = status;
    return { ok: true, changed: true, order: structuredClone(order) };
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

/** Empty in-memory deps. Pass `seed: true` to add the sample categories and products. */
export async function createMemoryDeps(
  isAdmin: Deps['isAdmin'],
  seed = false,
  payments: PaymentProvider | null = null,
  now: () => number = Date.now,
): Promise<Deps & { orders: MemoryOrderStore }> {
  const db = createMemoryDb();
  const lock = createLock();
  const deps: Deps & { orders: MemoryOrderStore } = {
    products: memoryProducts(db, lock),
    categories: memoryCategories(db, lock),
    deliveryOptions: memoryDeliveryOptions(db),
    orders: memoryOrders(db, lock, now),
    payments,
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
  // What pg_cron does in production: every five minutes, expire the orders that waited too long.
  setInterval(() => void deps.orders.expireDue(), 5 * 60 * 1000);
  Deno.serve({ port: 8787 }, createApp(deps).fetch);
}
