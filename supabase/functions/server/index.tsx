import { createClient } from 'jsr:@supabase/supabase-js@2.49.8';
import { createApp } from './app.ts';
import type {
  Category,
  CategoryStore,
  CreateProductResult,
  DeleteCategoryResult,
  Deps,
  Order,
  OrderStore,
  PlaceOrderResult,
  Product,
  ProductStore,
  UpdateProductResult,
} from './types.ts';

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const BUCKET = 'product-images';
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const client = () => createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));

// Everything below calls the Postgres functions in
// supabase/migrations/20261030000000_catalogue.sql (products, categories and
// stock per variant). The kv table is not used. Orders and stock changes lock
// the variant rows, so stock cannot be oversold. Nothing is seeded here: the
// migration copies the existing products over.
const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

const orders: OrderStore = {
  place: (id, items, customer) =>
    rpc<PlaceOrderResult>('place_order_v2', { p_id: id, p_items: items, p_customer: customer }),
  async list() {
    const { data, error } = await client().from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r): Order => ({
      id: r.id,
      ref: r.ref,
      createdAt: r.created_at,
      status: r.status,
      lines: r.lines,
      total: Number(r.total),
      customer: r.customer,
    }));
  },
  async cancel(id) {
    return (await rpc<Order | null>('cancel_order_v2', { p_id: id })) ?? null;
  },
};

// Admin product edits merge under the same variant row locks the order functions take,
// so stock changes are never overwritten.
const products: ProductStore = {
  list: (includeInactive = false) => rpc<Product[]>('list_products', { p_include_inactive: includeInactive }),
  async get(idOrSlug) {
    return (await rpc<Product | null>('get_product', { p_key: idOrSlug })) ?? null;
  },
  create({ id, createdAt: _ignored, ...input }) {
    return rpc<CreateProductResult>('create_product', { p_id: id, p_input: input });
  },
  update: (id, patch, expectedStock, variants) =>
    rpc<UpdateProductResult>('update_product_v2', {
      p_id: id,
      p_patch: patch,
      p_expected_stock: expectedStock ?? null,
      p_variants: variants ?? null,
    }),
  remove: (id) => rpc<boolean>('delete_product', { p_id: id }),
};

const categories: CategoryStore = {
  list: (includeInactive = false) => rpc<Category[]>('list_categories', { p_include_inactive: includeInactive }),
  upsert: (cat) =>
    rpc<Category>('upsert_category', {
      p_id: cat.id,
      p_name: cat.name,
      p_sort: cat.sort ?? null,
      p_active: cat.active ?? null,
    }),
  remove: (id) => rpc<DeleteCategoryResult>('delete_category', { p_id: id }),
};

const deps: Deps = {
  products,
  categories,
  orders,
  async isAdmin(authHeader) {
    const m = authHeader?.match(/^Bearer\s+(.+)$/i);
    if (!m) return 'unauthenticated';
    const { data, error } = await client().auth.getUser(m[1]);
    if (error || !data?.user) return 'unauthenticated';
    return data.user.app_metadata?.role === 'admin' ? 'ok' : 'forbidden';
  },
  async uploadImage(file) {
    const supabase = client();
    const ext = EXT[file.type] ?? 'bin';
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type });
    if (error) throw new Error(error.message);
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  },
};

Deno.serve(createApp(deps).fetch);
