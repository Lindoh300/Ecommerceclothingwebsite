import { createClient } from 'jsr:@supabase/supabase-js@2.49.8';
import { createApp } from './app.ts';
import { loadPaymentProvider } from './payments.ts';
import type {
  Category,
  CategoryStore,
  CreateProductResult,
  DeleteCategoryResult,
  DeliveryOption,
  DeliveryOptionStore,
  Deps,
  Order,
  OrderStore,
  PaymentInfo,
  PlaceOrderResult,
  Product,
  ProductStore,
  RecordPaymentResult,
  SetStatusResult,
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

// Everything below calls the Postgres functions in these migrations (supabase/migrations/):
//   20261030000000_catalogue.sql     products, categories and stock per variant
//   20261030100000_order_lifecycle.sql   order statuses
//   20261030110000_delivery.sql      delivery options
//   20261030120000_payments.sql      online payments (record_payment and friends)
//   20261030130000_place_order_v3.sql    place_order_v3 and order expiry (expire_due_orders)
//   20261030140000_order_expiry_cron.sql pg_cron job that runs expire_due_orders
// The kv table is not used. Orders and stock changes lock the variant rows, so
// stock cannot be oversold. Nothing is seeded here: the migration copies the
// existing products over.
const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

const orders: OrderStore = {
  place: (id, items, customer, opts) =>
    rpc<PlaceOrderResult>('place_order_v3', {
      p_id: id,
      p_items: items,
      p_customer: customer,
      p_opts: { delivery: opts?.delivery, paymentMethod: opts?.paymentMethod, ip: opts?.ip },
    }),
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
      // Same shape as order_json. payment_url and payment_reference are never exposed.
      deliveryFee: Number(r.delivery_fee ?? 0),
      delivery: r.delivery_method == null ? null : {
        method: r.delivery_method,
        ...(r.delivery_address == null ? {} : { address: r.delivery_address }),
        ...(r.delivery_locker == null ? {} : { locker: r.delivery_locker }),
        fee: Number(r.delivery_fee ?? 0),
      },
      paymentMethod: r.payment_method ?? null,
      paymentFlag: r.payment_flag ?? null,
      paidAt: r.paid_at ?? null,
      expiresAt: r.expires_at ?? null,
      tracking: r.tracking_courier == null && r.tracking_number == null && r.tracking_url == null ? null : {
        courier: r.tracking_courier ?? null,
        number: r.tracking_number ?? null,
        url: r.tracking_url ?? null,
      },
    }));
  },
  async cancel(id) {
    return (await rpc<Order | null>('cancel_order_v2', { p_id: id })) ?? null;
  },
  setStatus: (id, status, from) =>
    rpc<SetStatusResult>('set_order_status', { p_id: id, p_status: status, p_from: from ?? null }),
  async paymentInfo(id) {
    return (await rpc<PaymentInfo | null>('order_payment_info', { p_id: id })) ?? null;
  },
  attachPayment: (id, reference, url) =>
    rpc<boolean>('attach_payment', { p_id: id, p_reference: reference, p_url: url }),
  recordPayment: (reference, amountCents, currency) =>
    rpc<RecordPaymentResult>('record_payment', {
      p_reference: reference,
      p_amount_cents: amountCents,
      p_currency: currency,
    }),
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

const deliveryOptions: DeliveryOptionStore = {
  list: () => rpc<DeliveryOption[]>('list_delivery_options', {}),
};

const deps: Deps = {
  products,
  deliveryOptions,
  categories,
  orders,
  // null (online payment off) when PAYSTACK_SECRET_KEY is unset or blank. The only read of the key.
  payments: loadPaymentProvider(Deno.env.get('PAYSTACK_SECRET_KEY'), Deno.env.get('PAYSTACK_CALLBACK_URL')),
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
