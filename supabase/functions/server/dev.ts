// Local dev server with no Supabase. Run with: deno run --allow-net dev.ts
// Admin token: "Bearer dev-admin". Data lives in memory and resets on restart.
// The stores below mirror the Postgres functions in
// supabase/migrations/20261030000000_catalogue.sql. When one changes, change the other.
import { createApp, deriveImage, resolveVariant } from './app.ts';
import { seedCatalogue } from './seed.ts';
import type {
  Category,
  CategoryStore,
  CreateProductResult,
  Customer,
  DeleteCategoryResult,
  Deps,
  Order,
  OrderItemInput,
  OrderLine,
  OrderStore,
  PlaceOrderResult,
  Product,
  ProductStore,
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
}

export const createMemoryDb = (): MemoryDb => ({ categories: new Map(), products: new Map() });

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

// In-memory orders that mirror place_order_v2 and cancel_order_v2. The shared lock
// serialises place and cancel, standing in for row locks.
export function memoryOrders(db: MemoryDb, lock: Lock = createLock()): OrderStore {
  const orders = new Map<string, Order>();

  function place(rawId: string, items: OrderItemInput[], customer: Customer): PlaceOrderResult {
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
      createdAt: new Date().toISOString(),
      status: 'pending',
      lines,
      total: lines.reduce((sum, l) => sum + l.subtotal, 0),
      customer,
    };
    orders.set(id, order);
    return { ok: true, created: true, order: structuredClone(order) };
  }

  function cancel(rawId: string): Order | null {
    const order = orders.get(rawId.toLowerCase());
    if (!order) return null;
    if (order.status === 'pending') {
      for (const l of order.lines) {
        const p = db.products.get(l.productId);
        if (!p) continue; // the product is gone
        // The line's variant if it still exists, else the exact size and colour, else the first variant.
        const v = p.variants.find((x) => x.id === l.variantId) ??
          p.variants.find((x) => x.size === (l.size ?? '') && x.color === (l.color ?? '')) ??
          ordered(p)[0];
        if (v) v.stock += l.quantity;
      }
      order.status = 'cancelled';
    }
    return structuredClone(order);
  }

  return {
    place: (id, items, customer) => lock(() => Promise.resolve(place(id, items, customer))),
    cancel: (id) => lock(() => Promise.resolve(cancel(id))),
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
): Promise<Deps> {
  const db = createMemoryDb();
  const lock = createLock();
  const deps: Deps = {
    products: memoryProducts(db, lock),
    categories: memoryCategories(db, lock),
    orders: memoryOrders(db, lock),
    isAdmin,
    uploadImage: () => Promise.resolve(`https://picsum.photos/seed/${crypto.randomUUID()}/800/800`),
  };
  if (seed) await seedCatalogue(deps.categories, deps.products);
  return deps;
}

if (import.meta.main) {
  const deps = await createMemoryDeps((h) => Promise.resolve(h === 'Bearer dev-admin' ? 'ok' : 'unauthenticated'), true);
  Deno.serve({ port: 8787 }, createApp(deps).fetch);
}
