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

export type OrderStatus = 'pending' | 'cancelled';

export interface Order {
  id: string;
  ref: string;
  createdAt: string;
  status: OrderStatus;
  lines: OrderLine[];
  total: number;
  customer: Customer;
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
  | { ok: false; reason: 'stock'; short: StockShortfall[] };

export interface OrderStore {
  place(id: string, items: OrderItemInput[], customer: Customer): Promise<PlaceOrderResult>;
  /** Newest first. */
  list(): Promise<Order[]>;
  /** null = not found. Already-cancelled returns the order unchanged and does not restore stock again. */
  cancel(id: string): Promise<Order | null>;
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

export interface Deps {
  products: ProductStore;
  categories: CategoryStore;
  orders: OrderStore;
  isAdmin(authHeader: string | null): Promise<'ok' | 'unauthenticated' | 'forbidden'>;
  uploadImage(file: File): Promise<string>;
}
