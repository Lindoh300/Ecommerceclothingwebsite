import { createClient } from 'jsr:@supabase/supabase-js@2.49.8';
import { createApp } from './app.ts';
import { loadMailer } from './mailer.ts';
import { loadPaymentProvider } from './payments.ts';
import type {
  Category,
  AdminEvent,
  AdminGalleryItem,
  CommunityStore,
  CategoryStore,
  CheckInResult,
  CreateProductResult,
  DeleteCategoryResult,
  DeliveryOption,
  DeleteEventResult,
  DeliveryOptionStore,
  Deps,
  EventStore,
  ListSendRecipient,
  ListSendStore,
  ListSendSummary,
  PublicGalleryItem,
  RestockRequest,
  RestockResult,
  RestockStore,
  Subscriber,
  UpsertGalleryResult,
  ExtendResult,
  LookupResult,
  IssueResult,
  Order,
  OrderStore,
  PaymentInfo,
  PlaceOrderResult,
  Product,
  ProductStore,
  PublicEvent,
  RecordPaymentResult,
  SetPaymentWindowResult,
  SetStatusResult,
  SetTrackingResult,
  Ticket,
  UpdateProductResult,
  UpsertEventResult,
  UpsertTicketTypeResult,
  VoidResult,
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
//   20261031100000_order_fulfilment.sql  cancelled -> refunded, set_order_tracking, extend_order, lookup_order
//   20261031110000_payment_links.sql     set_payment_window (48-hour hold for a payment link)
//   20261031120000_events.sql            events, ticket types, tickets (rsvp_tickets, check_in_ticket and friends)
//   20261031130000_community.sql         gallery items and the mailing list (subscribe and friends)
//   20261031140000_unsubscribe.sql       unsubscribe_contact (self-service opt-out, shares the sign-up limit)
//   20261031150000_restock_alerts.sql    restock_requests, request_restock_alert and friends; unsubscribe_contact also removes them
//   20261031160000_list_sends.sql        list_sends and list_send_recipients, create_list_send and friends (sending to the list)
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
  async get(id) {
    return (await rpc<Order | null>('get_order', { p_id: id })) ?? null;
  },
  setTracking: (id, tracking) => rpc<SetTrackingResult>('set_order_tracking', { p_id: id, p_tracking: tracking }),
  extend: (id) => rpc<ExtendResult>('extend_order', { p_id: id }),
  setPaymentWindow: (id, hours) =>
    rpc<SetPaymentWindowResult>('set_payment_window', { p_id: id, p_hours: hours }),
  lookup: (ref, phone, ip) => rpc<LookupResult>('lookup_order', { p_ref: ref, p_phone: phone, p_ip: ip ?? null }),
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

// Events and tickets. Every function locks the ticket_types row it changes (see the header of the migration), so a
// type cannot be oversold and a ticket is checked in once.
const events: EventStore = {
  listPublic: (past = false) => rpc<PublicEvent[]>('list_events_public', { p_past: past }),
  async getPublic(slug) {
    return (await rpc<PublicEvent | null>('get_event_public', { p_slug: slug })) ?? null;
  },
  rsvp: (id, slug, ticketTypeId, quantity, holder, ip) =>
    rpc<IssueResult>('rsvp_tickets', {
      p_id: id,
      p_slug: slug,
      p_type_id: ticketTypeId,
      p_qty: quantity,
      p_holder: holder,
      p_ip: ip ?? null,
    }),
  async getTicket(code) {
    return (await rpc<Ticket | null>('get_ticket', { p_code: code })) ?? null;
  },
  listAdmin: () => rpc<AdminEvent[]>('list_events_admin', {}),
  upsertEvent: (id, input) => rpc<UpsertEventResult>('upsert_event', { p_id: id, p_input: input }),
  deleteEvent: (id) => rpc<DeleteEventResult>('delete_event', { p_id: id }),
  upsertTicketType: (id, input) => rpc<UpsertTicketTypeResult>('upsert_ticket_type', { p_id: id, p_input: input }),
  deleteTicketType: (id) => rpc<DeleteEventResult>('delete_ticket_type', { p_id: id }),
  issue: (id, ticketTypeId, quantity, holder) =>
    rpc<IssueResult>('admin_issue_tickets', { p_id: id, p_type_id: ticketTypeId, p_qty: quantity, p_holder: holder }),
  async listTickets(eventId) {
    return (await rpc<Ticket[] | null>('list_event_tickets', { p_event: eventId })) ?? null;
  },
  checkIn: (code, at, eventId) =>
    rpc<CheckInResult>('check_in_ticket', { p_code: code, p_at: at ?? null, p_event: eventId ?? null }),
  voidTicket: (code) => rpc<VoidResult>('void_ticket', { p_code: code }),
};

// Community: the gallery and the mailing list. `subscribe` takes the address limit and the sign-up in one transaction.
const community: CommunityStore = {
  listGalleryPublic: () => rpc<PublicGalleryItem[]>('list_gallery_public', {}),
  listGalleryAdmin: () => rpc<AdminGalleryItem[]>('list_gallery_admin', {}),
  upsertGalleryItem: (id, input) => rpc<UpsertGalleryResult>('upsert_gallery_item', { p_id: id, p_input: input }),
  deleteGalleryItem: (id) => rpc<boolean>('delete_gallery_item', { p_id: id }),
  subscribe: (input, consentText, ip) =>
    rpc<{ ok: true } | { ok: false; reason: 'rate_limited' }>('subscribe', {
      p_name: input.name ?? null,
      p_phone: input.phone ?? null,
      p_email: input.email ?? null,
      p_consent_text: consentText,
      p_source: input.source,
      p_ip: ip ?? null,
    }),
  unsubscribeContact: (input, ip) =>
    rpc<{ ok: true } | { ok: false; reason: 'rate_limited' }>('unsubscribe_contact', {
      p_phone: input.phone ?? null,
      p_email: input.email ?? null,
      p_ip: ip ?? null,
    }),
  listSubscribers: () => rpc<Subscriber[]>('list_subscribers_admin', {}),
  async unsubscribe(id) {
    return (await rpc<Subscriber | null>('admin_unsubscribe_subscriber', { p_id: id })) ?? null;
  },
};

// Restock alerts. `request` takes the address limit (shared with the sign-up), the purge and the insert in one transaction.
const restock: RestockStore = {
  request: (input, ip) =>
    rpc<RestockResult>('request_restock_alert', {
      p_product_id: input.productId,
      p_variant_id: input.variantId,
      p_phone: input.phone ?? null,
      p_email: input.email ?? null,
      p_ip: ip ?? null,
    }),
  list: () => rpc<RestockRequest[]>('list_restock_requests_admin', {}),
  remove: (id) => rpc<boolean>('delete_restock_request', { p_id: id }),
};

// Sending to the mailing list. Each call is one transaction; claim and finish are the only writes while a send runs.
const listSends: ListSendStore = {
  create: (id, input) =>
    rpc<{ created: boolean; send: ListSendSummary }>('create_list_send', {
      p_id: id,
      p_subject: input.subject,
      p_body: input.body,
    }),
  async claimBatch(id, limit) {
    return (await rpc<{ recipients: ListSendRecipient[]; summary: ListSendSummary } | null>('claim_list_send_batch', {
      p_id: id,
      p_limit: limit ?? 100,
    })) ?? null;
  },
  async finishBatch(id, subscriberIds, ok) {
    return (await rpc<ListSendSummary | null>('finish_list_send_batch', {
      p_id: id,
      p_subscriber_ids: subscriberIds,
      p_ok: ok,
    })) ?? null;
  },
  listAdmin: () => rpc<ListSendSummary[]>('list_list_sends_admin', {}),
};

const deps: Deps = {
  products,
  deliveryOptions,
  categories,
  orders,
  events,
  community,
  restock,
  listSends,
  // null (online payment off) when PAYSTACK_SECRET_KEY is unset or blank. The only read of the key.
  payments: loadPaymentProvider(Deno.env.get('PAYSTACK_SECRET_KEY')),
  // null (no order emails) unless both RESEND_API_KEY and EMAIL_FROM are set. The only read of the key.
  mailer: loadMailer(Deno.env.get('RESEND_API_KEY'), Deno.env.get('EMAIL_FROM')),
  // The live site address, no trailing slash. Also the payment return page (replaces PAYSTACK_CALLBACK_URL).
  siteUrl: Deno.env.get('SITE_URL')?.trim().replace(/\/+$/, '') || null,
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
