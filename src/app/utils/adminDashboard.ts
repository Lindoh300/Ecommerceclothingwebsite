import type { Order, OrderStatus, Product } from "../api/types";

// Everything the admin dashboard shows, worked out in the browser from the order and product lists.
// Pure: the caller passes `now`, and days are the viewer's local days.

/** An unpaid order this close to its expiry (or past it, not yet swept) is worth a nudge. */
export const EXPIRING_WITHIN_HOURS = 12;
/** Variants at this many or fewer are "low". */
export const LOW_STOCK_AT = 3;

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
