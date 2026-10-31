import type { PaymentProvider } from './payments.ts';

export interface Variant {
  id: string;
  sku: string;
  size: string;
  color: string;
  stock: number;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  /** A category id (slug). The store decides whether it exists. */
  category: string;
  price: number;
  description: string;
  image: string;
  images: string[];
  sizes: string[];
  colors: string[];
  /** The sum of the variants' stock. */
  stock: number;
  active: boolean;
  createdAt: string;
  /** In size then colour order. */
  variants: Variant[];
}

export interface Category {
  id: string;
  name: string;
  sort: number;
  active: boolean;
}

/** The fields an admin edits. `stock` is a total, spread over the variants by the store. */
export interface ProductInput {
  name: string;
  category: string;
  price: number;
  description: string;
  images: string[];
  sizes: string[];
  colors: string[];
  stock: number;
  active: boolean;
}

/** {size, color} may be missing or '' for "no such dimension". */
export interface VariantInput {
  size?: string;
  color?: string;
  stock: number;
}

export interface NewProduct extends Omit<ProductInput, 'stock' | 'active'> {
  id: string;
  /** Total, split evenly over all variants. Ignored when `variants` is given. Default 0. */
  stock?: number;
  /** Each listed size x colour gets that stock, the other combinations get 0. */
  variants?: VariantInput[];
  /** In-memory stores only (seeding). The database function always uses now(). */
  createdAt?: string;
}

/** Sets one variant's stock. With `expectedStock`, a different stored value means nothing is written. */
export interface VariantStockInput {
  id: string;
  stock: number;
  expectedStock?: number;
}

export interface CartQuoteRequest {
  items: { productId: string; size?: string; color?: string; quantity: number }[];
}

export interface CartQuoteLine {
  productId: string;
  name: string;
  price: number;
  image: string;
  size?: string;
  color?: string;
  quantity: number;
  subtotal: number;
  /** Stock of the matched variant. */
  available: number;
  variantId: string;
  sku: string;
}

export interface CartQuote {
  lines: CartQuoteLine[];
  total: number;
  missing: string[];
}

export interface OrderItemInput {
  productId: string;
  size?: string;
  color?: string;
  quantity: number;
}

export interface Customer {
  name: string;
  phone: string;
  note?: string;
  /** Needed for online payment. */
  email?: string;
}

export type DeliveryMethod = 'door' | 'locker' | 'collect';

export interface DeliveryAddress {
  line1: string;
  line2?: string;
  suburb: string;
  city: string;
  postalCode: string;
}

/** What the customer chooses. The fee is never part of it: the server reads it from delivery_options. */
export interface DeliveryInput {
  method: DeliveryMethod;
  address?: DeliveryAddress;
  locker?: string;
}

export type PaymentMethod = 'whatsapp' | 'online';

export interface PlaceOptions {
  delivery?: DeliveryInput;
  paymentMethod?: PaymentMethod;
  /** The client address (Cloudflare's cf-connecting-ip). Only used for the per-address order limit. No ip, no limit. */
  ip?: string;
}

export interface DeliveryOption {
  id: string;
  name: string;
  price: number;
}

export interface OrderLine {
  productId: string;
  name: string;
  price: number;
  size?: string;
  color?: string;
  quantity: number;
  subtotal: number;
  /** Missing on orders placed before the catalogue migration. */
  variantId?: string;
  sku?: string;
}

/** `pending` means the customer pays on WhatsApp. */
export type OrderStatus =
  | 'pending'
  | 'cancelled'
  | 'awaiting_payment'
  | 'paid'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'expired'
  | 'refunded';

export interface OrderDelivery {
  method: string;
  /** Left out when there is none. */
  address?: unknown;
  locker?: string;
  fee: number;
}

export interface OrderTracking {
  courier: string | null;
  number: string | null;
  url: string | null;
}

export interface Order {
  id: string;
  ref: string;
  createdAt: string;
  status: OrderStatus;
  lines: OrderLine[];
  /** Includes `deliveryFee`. */
  total: number;
  customer: Customer;
  /** The fields below are missing from orders read by an older edge function; null when empty. */
  deliveryFee?: number;
  delivery?: OrderDelivery | null;
  paymentMethod?: 'whatsapp' | 'online' | null;
  paymentFlag?: 'amount_mismatch' | 'refund_due' | null;
  paidAt?: string | null;
  expiresAt?: string | null;
  tracking?: OrderTracking | null;
}

export interface StockShortfall {
  productId: string;
  name: string;
  /** The variant that is short. '' when the product has no such dimension. */
  size: string;
  color: string;
  requested: number;
  available: number;
}

export type PlaceOrderResult =
  | { ok: true; created: boolean; order: Order }
  | { ok: false; reason: 'missing'; missing: string[] }
  | { ok: false; reason: 'stock'; short: StockShortfall[] }
  | { ok: false; reason: 'unknown_delivery' }
  /** 5 orders per address in a rolling hour. Nothing was kept: no order, stock untouched. */
  | { ok: false; reason: 'rate_limited' };

export type SetStatusResult =
  | { ok: true; changed: boolean; order: Order }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'bad_transition'; from: OrderStatus; to: string; order: Order };

/** What the pay route needs about an order. `paymentUrl` is never part of `Order`. */
export interface PaymentInfo {
  id: string;
  ref: string;
  status: OrderStatus;
  total: number;
  email: string | null;
  paymentUrl: string | null;
}

export type RecordPaymentResult =
  | { ok: true; changed: boolean; outcome: 'paid' | 'paid_late' | 'refund_due' | 'already' }
  | { ok: false; reason: 'not_found' | 'amount_mismatch' };

export interface OrderStore {
  /** With `opts.delivery` the fee comes from the delivery option, never from the caller; total = lines + fee.
   *  `paymentMethod: 'online'` stores the order as awaiting_payment. A retried id returns the order unchanged. */
  place(id: string, items: OrderItemInput[], customer: Customer, opts?: PlaceOptions): Promise<PlaceOrderResult>;
  /** Newest first. */
  list(): Promise<Order[]>;
  /** null = not found. Already-cancelled returns the order unchanged and does not restore stock again. */
  cancel(id: string): Promise<Order | null>;
  /** Move an order along its lifecycle (see ORDER_TRANSITIONS in dev.ts and set_order_status in SQL).
   *  With `from`, the order must be in that status or nothing changes ('bad_transition').
   *  The requested status already holding is a no-op ({ok:true, changed:false}). */
  setStatus(id: string, status: OrderStatus, from?: OrderStatus): Promise<SetStatusResult>;
  /** null = not found. */
  paymentInfo(id: string): Promise<PaymentInfo | null>;
  /** Stores the provider reference and checkout URL while the order is awaiting_payment. true = stored (or
   *  already stored with the same values); false = not awaiting_payment, unknown, or other values stored. */
  attachPayment(id: string, reference: string, url: string): Promise<boolean>;
  /** A payment the provider VERIFIED: amount (cents) and currency come from the provider, never the webhook body.
   *  See record_payment in 20261030120000_payments.sql for the outcomes. */
  recordPayment(reference: string, amountCents: number, currency: string): Promise<RecordPaymentResult>;
}

export type CreateProductResult =
  | { ok: true; product: Product }
  | { ok: false; reason: 'unknown_category' };

export type UpdateProductResult =
  | { ok: true; product: Product }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'unknown_category' }
  | { ok: false; reason: 'stock_changed'; stock: number; variants: { id: string; stock: number }[] };

export interface ProductStore {
  /** Oldest first, id as the tie-break. Inactive products only with `includeInactive`. */
  list(includeInactive?: boolean): Promise<Product[]>;
  /** By id or slug (an id match wins). Inactive products are returned too; the caller checks `active`. */
  get(idOrSlug: string): Promise<Product | null>;
  create(input: NewProduct): Promise<CreateProductResult>;
  /** Merge `patch` under a row lock. Stock changes only by `variants` (per variant) or, without `variants`,
   *  when `patch.stock` is set (a new total). A stale expectedStock gives 'stock_changed' and writes nothing. */
  update(
    id: string,
    patch: Partial<ProductInput>,
    expectedStock?: number,
    variants?: VariantStockInput[],
  ): Promise<UpdateProductResult>;
  /** false = no such product. */
  remove(id: string): Promise<boolean>;
}

export type DeleteCategoryResult = { ok: true } | { ok: false; reason: 'in_use'; count: number };

export interface CategoryStore {
  /** Ordered by sort, then name. Inactive ones only with `includeInactive`. */
  list(includeInactive?: boolean): Promise<Category[]>;
  /** Insert or update by id. A missing `sort` or `active` keeps the stored value (0 and true for a new row). */
  upsert(cat: { id: string; name: string; sort?: number; active?: boolean }): Promise<Category>;
  remove(id: string): Promise<DeleteCategoryResult>;
}

export interface DeliveryOptionStore {
  /** Active options only, in sort order. */
  list(): Promise<DeliveryOption[]>;
}

export interface Deps {
  products: ProductStore;
  deliveryOptions: DeliveryOptionStore;
  categories: CategoryStore;
  orders: OrderStore;
  /** null when no payment key is configured: online payment is then off. */
  payments: PaymentProvider | null;
  isAdmin(authHeader: string | null): Promise<'ok' | 'unauthenticated' | 'forbidden'>;
  uploadImage(file: File): Promise<string>;
}
