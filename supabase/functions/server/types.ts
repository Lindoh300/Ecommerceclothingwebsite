export type Category = 'tshirts' | 'jerseys' | 'shorts' | 'pants' | 'accessories';

export interface Product {
  id: string;
  name: string;
  category: Category;
  price: number;
  description: string;
  image: string;
  images: string[];
  sizes: string[];
  colors: string[];
  stock: number;
  createdAt: string;
}

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'image'>;

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
  available: number;
}

export interface CartQuote {
  lines: CartQuoteLine[];
  total: number;
  missing: string[];
}

export interface KvLike {
  // deno-lint-ignore no-explicit-any
  get(k: string): Promise<any>;
  // deno-lint-ignore no-explicit-any
  set(k: string, v: any): Promise<void>;
  del(k: string): Promise<void>;
  // deno-lint-ignore no-explicit-any
  getByPrefix(p: string): Promise<any[]>;
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

export type UpdateProductResult =
  | { ok: true; product: Product }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'stock_changed'; stock: number };

export interface ProductStore {
  /** Merge `patch` into the stored product under a row lock. Stock is only changed when `patch.stock` is set;
   *  then, if `expectedStock` is given and differs from the stored stock, nothing is written and 'stock_changed' is returned. */
  update(id: string, patch: Partial<ProductInput>, expectedStock?: number): Promise<UpdateProductResult>;
}

export interface Deps {
  kv: KvLike;
  orders: OrderStore;
  products: ProductStore;
  isAdmin(authHeader: string | null): Promise<'ok' | 'unauthenticated' | 'forbidden'>;
  uploadImage(file: File): Promise<string>;
}
