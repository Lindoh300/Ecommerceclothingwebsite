import type { Order, OrderStatus, Product } from "../api/types";

// Everything the admin dashboard shows, worked out in the browser from the order and product lists.
// Pure: the caller passes `now`, and days are the viewer's local days.

/** An unpaid order this close to its expiry (or past it, not yet swept) is worth a nudge. */
export const EXPIRING_WITHIN_HOURS = 12;
/** Variants at this many or fewer are "low". */
export const LOW_STOCK_AT = 3;
/** The sales summary covers this many calendar days, today included. */
export const SUMMARY_DAYS = 30;
/** The sales summary lists this many best-selling products. */
export const TOP_PRODUCTS = 5;

/** Orders that count as a sale: the money has been seen. */
const SALE_STATUSES: readonly OrderStatus[] = ["paid", "packed", "shipped", "delivered"];

const HOUR_MS = 60 * 60 * 1000;

export interface LowStockVariant {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  size: string;
  color: string;
  stock: number;
}

export interface SalesTotal {
  count: number;
  /** Sum of order totals, delivery fees included. */
  total: number;
}

export interface ProductSales {
  name: string;
  units: number;
  revenue: number;
}

export interface SalesSummary {
  /** Orders that count as a sale in the window. */
  count: number;
  /** Sum of order totals, delivery included. */
  total: number;
  /** total / count, 0 when count is 0. */
  average: number;
  /** Items sold. */
  units: number;
  /** By units sold, then revenue, then name. At most TOP_PRODUCTS. */
  topProducts: ProductSales[];
}

export interface DashboardOrders {
  /** Paid, waiting to be packed. Oldest payment first. */
  toPack: Order[];
  /** pending or awaiting_payment, expiring within EXPIRING_WITHIN_HOURS (or already past). Soonest first. */
  expiringSoon: Order[];
  /** A refund is due or the amount did not match. Refunded orders are done and left out. Newest first. */
  flagged: Order[];
  today: SalesTotal;
  week: SalesTotal;
}

/** When the sale counted: the payment time, else the order time. NaN when neither parses. */
export const saleTime = (o: Order): number => Date.parse(o.paidAt || o.createdAt);

/** Local midnight at the start of `now`'s day. */
export function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Local midnight of the Monday on or before `now`. */
export function startOfWeek(now: Date): Date {
  const day = startOfDay(now);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7));
}

export function dashboardOrders(orders: Order[], now: Date): DashboardOrders {
  const t = now.getTime();
  const dayStart = startOfDay(now).getTime();
  const weekStart = startOfWeek(now).getTime();

  const toPack = orders
    .filter((o) => o.status === "paid")
    .sort((a, b) => saleTime(a) - saleTime(b));

  const expiringSoon = orders
    .filter(
      (o) =>
        (o.status === "pending" || o.status === "awaiting_payment") &&
        !!o.expiresAt &&
        Date.parse(o.expiresAt) <= t + EXPIRING_WITHIN_HOURS * HOUR_MS,
    )
    .sort((a, b) => Date.parse(a.expiresAt!) - Date.parse(b.expiresAt!));

  const flagged = orders
    .filter((o) => !!o.paymentFlag && o.status !== "refunded")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const today: SalesTotal = { count: 0, total: 0 };
  const week: SalesTotal = { count: 0, total: 0 };
  for (const o of orders) {
    if (!SALE_STATUSES.includes(o.status)) continue;
    const when = saleTime(o);
    if (Number.isNaN(when)) continue;
    if (when >= weekStart) {
      week.count += 1;
      week.total += o.total;
    }
    if (when >= dayStart) {
      today.count += 1;
      today.total += o.total;
    }
  }
  return { toPack, expiringSoon, flagged, today, week };
}

/**
 * Sales over the last SUMMARY_DAYS calendar days, today included. Only paid-or-later orders count.
 * A line's revenue is its unit price times its quantity; lines of one product group together, whatever the size.
 */
export function salesSummary(orders: Order[], now: Date): SalesSummary {
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (SUMMARY_DAYS - 1)).getTime();
  let count = 0;
  let total = 0;
  let units = 0;
  const byProduct = new Map<string, ProductSales>();

  for (const o of orders) {
    if (!SALE_STATUSES.includes(o.status)) continue;
    const when = saleTime(o);
    if (Number.isNaN(when) || when < since) continue;
    count += 1;
    total += o.total;
    for (const l of o.lines) {
      const revenue = l.price * l.quantity;
      units += l.quantity;
      const key = l.productId || l.name;
      const row = byProduct.get(key);
      if (row) {
        row.units += l.quantity;
        row.revenue += revenue;
      } else {
        byProduct.set(key, { name: l.name, units: l.quantity, revenue });
      }
    }
  }

  const topProducts = [...byProduct.values()]
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.name.localeCompare(b.name))
    .slice(0, TOP_PRODUCTS);

  return { count, total, average: count === 0 ? 0 : total / count, units, topProducts };
}

/** Variants at LOW_STOCK_AT or fewer on active products, lowest first (then by name, size, colour). */
export function lowStockVariants(products: Product[]): LowStockVariant[] {
  const out: LowStockVariant[] = [];
  for (const p of products) {
    if (!p.active) continue;
    for (const v of p.variants) {
      if (v.stock > LOW_STOCK_AT) continue;
      out.push({
        productId: p.id,
        productName: p.name,
        variantId: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        stock: v.stock,
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.stock - b.stock ||
      a.productName.localeCompare(b.productName) ||
      a.size.localeCompare(b.size) ||
      a.color.localeCompare(b.color),
  );
}
