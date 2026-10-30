// Local dev server with no Supabase. Run with: deno run --allow-net dev.ts
// Admin token: "Bearer dev-admin". Data lives in memory and resets on restart.
import { createApp, deriveImage } from './app.ts';
import type {
  Customer,
  Deps,
  KvLike,
  Order,
  OrderItemInput,
  OrderLine,
  OrderStore,
  PlaceOrderResult,
  Product,
  ProductStore,
  StockShortfall,
} from './types.ts';

export function memoryKv(): KvLike {
  const m = new Map<string, unknown>();
  return {
    get: (k) => Promise.resolve(m.has(k) ? structuredClone(m.get(k)) : undefined),
    set: (k, v) => {
      m.set(k, structuredClone(v));
      return Promise.resolve();
    },
    del: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
    getByPrefix: (p) =>
      Promise.resolve([...m.entries()].filter(([k]) => k.startsWith(p)).map(([, v]) => structuredClone(v))),
  };
}

export type Lock = <T>(fn: () => Promise<T>) => Promise<T>;

// A promise-chain mutex standing in for Postgres row locks. Share one between
// memoryOrders and memoryProducts so their operations serialise together.
export function createLock(): Lock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };
}

// In-memory product updates that mirror the Postgres update_product function.
export function memoryProducts(kv: KvLike, lock: Lock = createLock()): ProductStore {
  return {
    update: (id, patch, expectedStock) =>
      lock(async () => {
        const existing = (await kv.get(`product:${id}`)) as Product | undefined | null;
        if (!existing) return { ok: false, reason: 'not_found' } as const;
        if ('stock' in patch && patch.stock !== undefined && expectedStock !== undefined && existing.stock !== expectedStock) {
          return { ok: false, reason: 'stock_changed', stock: existing.stock } as const;
        }
        const merged: Product = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
        merged.image = deriveImage(merged.images);
        await kv.set(`product:${id}`, merged);
        return { ok: true, product: structuredClone(merged) } as const;
      }),
  };
}

// In-memory orders that mirror the Postgres place_order/cancel_order functions.
// The shared lock serialises place and cancel, standing in for row locks.
export function memoryOrders(kv: KvLike, lock: Lock = createLock()): OrderStore {
  const orders = new Map<string, Order>();
  const locked = lock;
  const productKey = (id: string) => `product:${id}`;

  async function place(rawId: string, items: OrderItemInput[], customer: Customer): Promise<PlaceOrderResult> {
    const id = rawId.toLowerCase();
    const existing = orders.get(id);
    if (existing) return { ok: true, created: false, order: structuredClone(existing) };

    // Requested quantity per product across all sizes/colours, in first-seen order.
    const requested = new Map<string, number>();
    for (const it of items) requested.set(it.productId, (requested.get(it.productId) ?? 0) + it.quantity);

    const products = new Map<string, Product>();
    const missing: string[] = [];
    for (const pid of requested.keys()) {
      const p = (await kv.get(productKey(pid))) as Product | undefined | null;
      if (p) products.set(pid, p);
      else missing.push(pid);
    }
    if (missing.length > 0) return { ok: false, reason: 'missing', missing };

    const short: StockShortfall[] = [];
    for (const [pid, qty] of requested) {
      const p = products.get(pid)!;
      if (qty > p.stock) short.push({ productId: pid, name: p.name, requested: qty, available: p.stock });
    }
    if (short.length > 0) return { ok: false, reason: 'stock', short };

    const lines: OrderLine[] = items.map((it) => {
      const p = products.get(it.productId)!;
      const line: OrderLine = {
        productId: it.productId,
        name: p.name,
        price: p.price,
        quantity: it.quantity,
        subtotal: p.price * it.quantity,
      };
      if (it.size !== undefined) line.size = it.size;
      if (it.color !== undefined) line.color = it.color;
      return line;
    });
    for (const [pid, qty] of requested) {
      const p = products.get(pid)!;
      await kv.set(productKey(pid), { ...p, stock: p.stock - qty });
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

  async function cancel(rawId: string): Promise<Order | null> {
    const order = orders.get(rawId.toLowerCase());
    if (!order) return null;
    if (order.status === 'pending') {
      const back = new Map<string, number>();
      for (const l of order.lines) back.set(l.productId, (back.get(l.productId) ?? 0) + l.quantity);
      for (const [pid, qty] of back) {
        const p = (await kv.get(productKey(pid))) as Product | undefined | null;
        if (p) await kv.set(productKey(pid), { ...p, stock: p.stock + qty });
      }
      order.status = 'cancelled';
    }
    return structuredClone(order);
  }

  return {
    place: (id, items, customer) => locked(() => place(id, items, customer)),
    cancel: (id) => locked(() => cancel(id)),
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

if (import.meta.main) {
  const kv = memoryKv();
  const lock = createLock();
  const deps: Deps = {
    kv,
    orders: memoryOrders(kv, lock),
    products: memoryProducts(kv, lock),
    isAdmin: (h) => Promise.resolve(h === 'Bearer dev-admin' ? 'ok' : 'unauthenticated'),
    uploadImage: () => Promise.resolve(`https://picsum.photos/seed/${crypto.randomUUID()}/800/800`),
  };
  Deno.serve({ port: 8787 }, createApp(deps).fetch);
}
