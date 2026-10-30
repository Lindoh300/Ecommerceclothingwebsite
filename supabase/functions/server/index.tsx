import { createClient } from 'jsr:@supabase/supabase-js@2.49.8';
import * as kv from './kv_store.tsx';
import { createApp } from './app.ts';
import type { Deps, Order, OrderStore, PlaceOrderResult, ProductStore, UpdateProductResult } from './types.ts';

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

// Orders and stock changes are done by the place_order / cancel_order Postgres
// functions (see supabase/migrations/20261022000000_orders.sql), which lock the
// product rows so stock cannot be oversold.
const orders: OrderStore = {
  async place(id, items, customer) {
    const { data, error } = await client().rpc('place_order', {
      p_id: id,
      p_items: items,
      p_customer: customer,
    });
    if (error) throw new Error(error.message);
    return data as PlaceOrderResult;
  },
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
    const { data, error } = await client().rpc('cancel_order', { p_id: id });
    if (error) throw new Error(error.message);
    return (data as Order | null) ?? null;
  },
};

// Admin product edits go through update_product (see
// supabase/migrations/20261029000000_update_product.sql), which merges under the
// same row lock the order functions take, so stock changes are never overwritten.
const products: ProductStore = {
  async update(id, patch, expectedStock) {
    const { data, error } = await client().rpc('update_product', {
      p_id: id,
      p_patch: patch,
      p_expected_stock: expectedStock ?? null,
    });
    if (error) throw new Error(error.message);
    return data as UpdateProductResult;
  },
};

const deps: Deps = {
  kv,
  orders,
  products,
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
