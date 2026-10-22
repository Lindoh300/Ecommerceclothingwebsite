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

export interface Deps {
  kv: KvLike;
  isAdmin(authHeader: string | null): Promise<'ok' | 'unauthenticated' | 'forbidden'>;
  uploadImage(file: File): Promise<string>;
}
