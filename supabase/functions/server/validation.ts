import type {
  CartQuoteRequest,
  Customer,
  DeliveryAddress,
  DeliveryInput,
  EventInput,
  EventStatus,
  GalleryInput,
  OrderItemInput,
  OrderStatus,
  PaymentMethod,
  ProductInput,
  SubscribeInput,
  SubscriberSource,
  TicketHolder,
  TicketTypeInput,
  TrackingInput,
  VariantInput,
  VariantStockInput,
} from './types.ts';

/** A category id: lowercase letters, digits and hyphens, 1 to 40 characters. */
export const CATEGORY_ID_RE = /^[a-z0-9-]{1,40}$/;
const CATEGORY_ID_ERROR = 'category must be a slug: lowercase letters, digits and hyphens, up to 40 characters';

/** `code` is a stable machine-readable name for errors the shop shows to the customer as they are. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function stringList(v: unknown, field: string): Result<string[]> {
  if (!Array.isArray(v) || v.length === 0) {
    return { ok: false, error: `${field} must be a non-empty array` };
  }
  for (const s of v) {
    if (typeof s !== 'string' || s.trim() === '') {
      return { ok: false, error: `${field} must contain non-empty strings` };
    }
  }
  return { ok: true, value: v as string[] };
}

const isStock = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

// On create: [{size?, color?, stock}]. size and color are optional strings; '' means "no such dimension".
function validateNewVariants(v: unknown): Result<VariantInput[]> {
  if (!Array.isArray(v) || v.length > 500) return { ok: false, error: 'variants must be an array of up to 500 entries' };
  const out: VariantInput[] = [];
  for (const e of v) {
    if (!isRecord(e)) return { ok: false, error: 'each variant must be an object' };
    if (!isStock(e.stock)) return { ok: false, error: 'variant stock must be an integer >= 0' };
    const item: VariantInput = { stock: e.stock };
    for (const k of ['size', 'color'] as const) {
      if (e[k] === undefined) continue;
      if (typeof e[k] !== 'string' || (e[k] as string).length > 40) {
        return { ok: false, error: `variant ${k} must be a string up to 40 characters` };
      }
      item[k] = e[k] as string;
    }
    out.push(item);
  }
  return { ok: true, value: out };
}

/** On update: `variants` is [{id, stock, expectedStock?}]. Pass the body's `variants` field. */
export function validateVariantStocks(v: unknown): Result<VariantStockInput[]> {
  if (!Array.isArray(v) || v.length > 500) return { ok: false, error: 'variants must be an array of up to 500 entries' };
  const out: VariantStockInput[] = [];
  for (const e of v) {
    if (!isRecord(e) || typeof e.id !== 'string' || e.id === '' || e.id.length > 64) {
      return { ok: false, error: 'each variant needs a string id' };
    }
    if (!isStock(e.stock)) return { ok: false, error: 'variant stock must be an integer >= 0' };
    const item: VariantStockInput = { id: e.id, stock: e.stock };
    if (e.expectedStock !== undefined) {
      if (!isStock(e.expectedStock)) {
        return { ok: false, error: 'variant expectedStock must be an integer >= 0' };
      }
      item.expectedStock = e.expectedStock;
    }
    out.push(item);
  }
  return { ok: true, value: out };
}

export function validateProductInput(
  body: unknown,
  partial: boolean,
): { ok: true; value: Partial<ProductInput> & { variants?: VariantInput[] } } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  const out: Partial<ProductInput> & { variants?: VariantInput[] } = {};
  const has = (k: string) => body[k] !== undefined;

  // With explicit variants the total comes from them, so stock is not needed.
  const required = ['name', 'category', 'price', 'images', 'sizes', 'colors'];
  if (!has('variants')) required.push('stock');
  if (!partial) {
    for (const k of required) {
      if (!has(k)) return { ok: false, error: `${k} is required` };
    }
  }

  if (has('name')) {
    const n = body.name;
    if (typeof n !== 'string' || n.trim() === '' || n.length > 120) {
      return { ok: false, error: 'name must be a non-empty string up to 120 characters' };
    }
    out.name = n;
  }
  if (has('category')) {
    if (typeof body.category !== 'string' || !CATEGORY_ID_RE.test(body.category)) {
      return { ok: false, error: CATEGORY_ID_ERROR };
    }
    out.category = body.category;
  }
  if (has('price')) {
    const p = body.price;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) {
      return { ok: false, error: 'price must be a finite number >= 0' };
    }
    out.price = p;
  }
  if (has('description')) {
    const d = body.description;
    if (typeof d !== 'string' || d.length > 2000) {
      return { ok: false, error: 'description must be a string up to 2000 characters' };
    }
    out.description = d;
  } else if (!partial) {
    out.description = '';
  }
  if (has('images')) {
    const im = body.images;
    if (!Array.isArray(im) || im.length > 3) {
      return { ok: false, error: 'images must be an array of at most 3 entries' };
    }
    for (const s of im) {
      if (typeof s !== 'string' || (s !== '' && !isHttpUrl(s))) {
        return { ok: false, error: 'images entries must be empty or http(s) URLs' };
      }
    }
    out.images = im as string[];
  }
  if (has('sizes')) {
    const r = stringList(body.sizes, 'sizes');
    if (!r.ok) return r;
    out.sizes = r.value;
  }
  if (has('colors')) {
    const r = stringList(body.colors, 'colors');
    if (!r.ok) return r;
    out.colors = r.value;
  }
  if (has('stock')) {
    const s = body.stock;
    if (!isStock(s)) {
      return { ok: false, error: 'stock must be an integer >= 0' };
    }
    out.stock = s;
  }
  if (has('active')) {
    if (typeof body.active !== 'boolean') return { ok: false, error: 'active must be true or false' };
    if (partial) out.active = body.active;
  }
  if (!partial && has('variants')) {
    const r = validateNewVariants(body.variants);
    if (!r.ok) return r;
    out.variants = r.value;
  }
  return { ok: true, value: out };
}

export function validateCategoryBody(
  body: unknown,
): Result<{ name: string; sort?: number; active?: boolean }> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name === '' || name.length > 80) return { ok: false, error: 'name must be a non-empty string up to 80 characters' };
  const out: { name: string; sort?: number; active?: boolean } = { name };
  if (body.sort !== undefined) {
    const s = body.sort;
    if (typeof s !== 'number' || !Number.isInteger(s) || Math.abs(s) > 1_000_000) {
      return { ok: false, error: 'sort must be a whole number' };
    }
    out.sort = s;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return { ok: false, error: 'active must be true or false' };
    out.active = body.active;
  }
  return { ok: true, value: out };
}

export function validateQuote(body: unknown): Result<CartQuoteRequest> {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    return { ok: false, error: 'items must be an array' };
  }
  if (body.items.length < 1 || body.items.length > 50) {
    return { ok: false, error: 'items must contain 1 to 50 entries' };
  }
  const items: CartQuoteRequest['items'] = [];
  for (const it of body.items) {
    if (!isRecord(it) || typeof it.productId !== 'string' || it.productId === '') {
      return { ok: false, error: 'each item needs a string productId' };
    }
    const q = it.quantity;
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > 999) {
      return { ok: false, error: 'quantity must be an integer from 1 to 999' };
    }
    const item: CartQuoteRequest['items'][number] = { productId: it.productId, quantity: q };
    if (it.size !== undefined) {
      if (typeof it.size !== 'string') return { ok: false, error: 'size must be a string' };
      item.size = it.size;
    }
    if (it.color !== undefined) {
      if (typeof it.color !== 'string') return { ok: false, error: 'color must be a string' };
      item.color = it.color;
    }
    items.push(item);
  }
  return { ok: true, value: { items } };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text120 = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 120 ? null : s;
};

/** The delivery choice. A fee, price or total in it is ignored: the server reads the fee from the table. */
function validateDelivery(raw: unknown): Result<DeliveryInput> {
  if (!isRecord(raw)) return { ok: false, error: 'delivery must be an object' };
  const m = raw.method;
  if (m !== 'door' && m !== 'locker' && m !== 'collect') {
    return { ok: false, error: 'delivery method must be door, locker or collect' };
  }
  if (m === 'collect') return { ok: true, value: { method: m } };
  if (m === 'locker') {
    const locker = text120(raw.locker);
    if (!locker) return { ok: false, error: 'locker must be 1 to 120 characters' };
    return { ok: true, value: { method: m, locker } };
  }
  if (!isRecord(raw.address)) return { ok: false, error: 'door delivery needs an address' };
  const a = raw.address;
  const required = (k: string, label: string): Result<string> => {
    const v = text120(a[k]);
    return v ? { ok: true, value: v } : { ok: false, error: `address ${label} must be 1 to 120 characters` };
  };
  const line1 = required('line1', 'line 1');
  if (!line1.ok) return line1;
  const suburb = required('suburb', 'suburb');
  if (!suburb.ok) return suburb;
  const city = required('city', 'city');
  if (!city.ok) return city;
  const postalCode = typeof a.postalCode === 'string' ? a.postalCode.trim() : '';
  if (!/^\d{4}$/.test(postalCode)) return { ok: false, error: 'address postal code must be 4 digits' };
  const address: DeliveryAddress = { line1: line1.value, suburb: suburb.value, city: city.value, postalCode };
  if (a.line2 !== undefined && a.line2 !== null && a.line2 !== '') {
    const line2 = text120(a.line2);
    if (line2 === null) return { ok: false, error: 'address line 2 must be up to 120 characters' };
    if (line2 !== '') address.line2 = line2;
  }
  return { ok: true, value: { method: m, address } };
}

/** Most units one order may hold, across all lines. */
export const MAX_ORDER_UNITS = 10;

/** `maxUnits: false` lifts the whole-order cap (the owner's own orders, such as event-table sales, may be bigger).
 *  The per-line limits stay. */
export function validateOrder(
  body: unknown,
  opts: { maxUnits?: boolean } = {},
): Result<{
  id: string;
  items: OrderItemInput[];
  customer: Customer;
  delivery?: DeliveryInput;
  paymentMethod: PaymentMethod;
}> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  if (typeof body.id !== 'string' || !UUID_RE.test(body.id)) {
    return { ok: false, error: 'id must be a UUID' };
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    return { ok: false, error: 'items must contain 1 to 20 entries' };
  }
  const items: OrderItemInput[] = [];
  for (const it of body.items) {
    if (!isRecord(it) || typeof it.productId !== 'string' || it.productId === '') {
      return { ok: false, error: 'each item needs a string productId' };
    }
    if (it.productId.length > 64) {
      return { ok: false, error: 'productId must be up to 64 characters' };
    }
    const q = it.quantity;
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > 50) {
      return { ok: false, error: 'quantity must be an integer from 1 to 50' };
    }
    const item: OrderItemInput = { productId: it.productId, quantity: q };
    if (it.size !== undefined) {
      if (typeof it.size !== 'string') return { ok: false, error: 'size must be a string' };
      if (it.size.length > 40) return { ok: false, error: 'size must be up to 40 characters' };
      item.size = it.size;
    }
    if (it.color !== undefined) {
      if (typeof it.color !== 'string') return { ok: false, error: 'color must be a string' };
      if (it.color.length > 40) return { ok: false, error: 'color must be up to 40 characters' };
      item.color = it.color;
    }
    items.push(item);
  }
  // Per-line limits above stay; this caps the whole order.
  if (opts.maxUnits !== false && items.reduce((n, it) => n + it.quantity, 0) > MAX_ORDER_UNITS) {
    return { ok: false, error: 'An order can hold up to 10 items in total', code: 'too_many_units' };
  }

  if (!isRecord(body.customer)) return { ok: false, error: 'customer must be an object' };
  const c = body.customer;
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: 'customer name must be 1 to 80 characters' };
  }
  const phone = typeof c.phone === 'string' ? c.phone.trim() : '';
  if (
    phone.length < 7 || phone.length > 20 || !/^[0-9 +\-()]+$/.test(phone) ||
    phone.replace(/\D/g, '').length < 7
  ) {
    return { ok: false, error: 'customer phone must be 7 to 20 characters with at least 7 digits' };
  }
  const customer: Customer = { name, phone };
  if (c.note !== undefined) {
    if (typeof c.note !== 'string') return { ok: false, error: 'customer note must be a string' };
    const note = c.note.trim();
    if (note.length > 500) return { ok: false, error: 'customer note must be up to 500 characters' };
    if (note !== '') customer.note = note;
  }
  if (c.email !== undefined && c.email !== null && c.email !== '') {
    if (typeof c.email !== 'string') return { ok: false, error: 'customer email must be a string' };
    const email = c.email.trim();
    if (email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, error: 'customer email is not valid' };
    customer.email = email;
  }

  let paymentMethod: PaymentMethod = 'whatsapp';
  if (body.paymentMethod !== undefined) {
    if (body.paymentMethod !== 'whatsapp' && body.paymentMethod !== 'online') {
      return { ok: false, error: 'paymentMethod must be whatsapp or online' };
    }
    paymentMethod = body.paymentMethod;
  }
  if (paymentMethod === 'online' && !customer.email) {
    return { ok: false, error: 'customer email is needed to pay online' };
  }

  let delivery: DeliveryInput | undefined;
  if (body.delivery !== undefined && body.delivery !== null) {
    const d = validateDelivery(body.delivery);
    if (!d.ok) return d;
    delivery = d.value;
  }
  return { ok: true, value: { id: body.id, items, customer, ...(delivery ? { delivery } : {}), paymentMethod } };
}

/** The statuses an admin can set through POST /orders/:id/status, with the status each one must come from
 *  (null = from any status the transition table allows). Cancelling has its own route, marking paid its own,
 *  and nothing here can skip a payment: paid, expired and the waiting statuses are not on the list. */
export const ADMIN_STATUS_FROM: Readonly<Record<string, OrderStatus | null>> = {
  packed: 'paid',
  shipped: 'packed',
  delivered: 'shipped',
  refunded: null,
};

export function validateStatusBody(body: unknown): Result<{ status: OrderStatus; from: OrderStatus | null }> {
  if (!isRecord(body) || typeof body.status !== 'string') return { ok: false, error: 'status must be a string' };
  const status = body.status;
  if (status === 'cancelled') return { ok: false, error: 'Use the cancel route to cancel an order' };
  if (!Object.hasOwn(ADMIN_STATUS_FROM, status)) {
    return { ok: false, error: 'status must be packed, shipped, delivered or refunded' };
  }
  return { ok: true, value: { status: status as OrderStatus, from: ADMIN_STATUS_FROM[status] } };
}

const TRACKING_MAX = 120;

/** Courier, number and url, each a string (trimmed, up to 120 characters) or null/'' to clear. A missing key
 *  is left out. The url has to be an https:// link. At least one field is needed. */
export function validateTracking(body: unknown): Result<TrackingInput> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  const out: TrackingInput = {};
  for (const k of ['courier', 'number', 'url'] as const) {
    const raw = body[k];
    if (raw === undefined) continue;
    if (raw === null) {
      out[k] = null;
      continue;
    }
    if (typeof raw !== 'string') return { ok: false, error: `${k} must be a string` };
    const v = raw.trim();
    if (v.length > TRACKING_MAX) return { ok: false, error: `${k} must be up to ${TRACKING_MAX} characters` };
    if (k === 'url' && v !== '') {
      let https = false;
      try {
        https = new URL(v).protocol === 'https:';
      } catch {
        https = false;
      }
      if (!https || !v.toLowerCase().startsWith('https://')) return { ok: false, error: 'url must start with https://' };
    }
    out[k] = v === '' ? null : v;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'Give a courier, number or url' };
  return { ok: true, value: out };
}

/** The public lookup. Only the shape is checked; whether the order exists is the store's answer. */
export function validateLookup(body: unknown): Result<{ ref: string; phone: string }> {
  if (!isRecord(body) || typeof body.ref !== 'string' || typeof body.phone !== 'string') {
    return { ok: false, error: 'ref and phone must be strings' };
  }
  if (body.ref.length > 40 || body.phone.length > 40) return { ok: false, error: 'ref and phone must be up to 40 characters' };
  return { ok: true, value: { ref: body.ref, phone: body.phone } };
}

// --- Events and tickets ----------------------------------------------------------------------------------------

/** The holder of a ticket: a name and a phone (like an order's customer) and an optional email. */
function validateHolder(raw: unknown): Result<TicketHolder> {
  if (!isRecord(raw)) return { ok: false, error: 'holder must be an object' };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name.length < 1 || name.length > 80) return { ok: false, error: 'holder name must be 1 to 80 characters' };
  const phone = typeof raw.phone === 'string' ? raw.phone.trim() : '';
  if (
    phone.length < 7 || phone.length > 20 || !/^[0-9 +\-()]+$/.test(phone) ||
    phone.replace(/\D/g, '').length < 7
  ) {
    return { ok: false, error: 'holder phone must be 7 to 20 characters with at least 7 digits' };
  }
  const holder: TicketHolder = { name, phone };
  if (raw.email !== undefined && raw.email !== null && raw.email !== '') {
    if (typeof raw.email !== 'string') return { ok: false, error: 'holder email must be a string' };
    const email = raw.email.trim();
    if (email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, error: 'holder email is not valid' };
    holder.email = email;
  }
  return { ok: true, value: holder };
}

/** The body of POST /events/:slug/rsvp and POST /admin/tickets. `max` is the most tickets one request may hold. */
export function validateTicketRequest(
  body: unknown,
  max: number,
): Result<{ id: string; ticketTypeId: string; quantity: number; holder: TicketHolder }> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  if (typeof body.id !== 'string' || !UUID_RE.test(body.id)) return { ok: false, error: 'id must be a UUID' };
  if (typeof body.ticketTypeId !== 'string' || !UUID_RE.test(body.ticketTypeId)) {
    return { ok: false, error: 'ticketTypeId must be a UUID' };
  }
  const q = body.quantity;
  if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > max) {
    return { ok: false, error: `quantity must be a whole number from 1 to ${max}` };
  }
  const holder = validateHolder(body.holder);
  if (!holder.ok) return holder;
  return {
    ok: true,
    value: { id: body.id.toLowerCase(), ticketTypeId: body.ticketTypeId.toLowerCase(), quantity: q, holder: holder.value },
  };
}

const EVENT_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EVENT_STATUSES: readonly EventStatus[] = ['draft', 'published', 'cancelled'];

/** An ISO date-time (with a zone) as a normalised ISO string, else null. */
function isoDate(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** The body of PUT /admin/events/:id. Every key is optional (the store says what a new event needs). */
export function validateEventInput(body: unknown): Result<EventInput> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  const out: EventInput = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim() === '' || body.title.length > 120) {
      return { ok: false, error: 'title must be a non-empty string up to 120 characters' };
    }
    out.title = body.title.trim();
  }
  for (const [k, max] of [['description', 4000], ['venue', 160], ['city', 80]] as const) {
    if (body[k] === undefined) continue;
    if (typeof body[k] !== 'string' || (body[k] as string).length > max) {
      return { ok: false, error: `${k} must be a string up to ${max} characters` };
    }
    out[k] = body[k] as string;
  }
  if (body.image !== undefined) {
    const im = body.image;
    if (typeof im !== 'string' || im.length > 2000 || (im !== '' && !isHttpUrl(im))) {
      return { ok: false, error: 'image must be empty or an http(s) URL' };
    }
    out.image = im;
  }
  if (body.startsAt !== undefined) {
    const d = isoDate(body.startsAt);
    if (!d) return { ok: false, error: 'startsAt must be an ISO date and time, such as 2026-12-05T18:00:00Z' };
    out.startsAt = d;
  }
  if (body.endsAt !== undefined) {
    if (body.endsAt === null) out.endsAt = null;
    else {
      const d = isoDate(body.endsAt);
      if (!d) return { ok: false, error: 'endsAt must be null or an ISO date and time' };
      out.endsAt = d;
    }
  }
  if (out.startsAt && out.endsAt && out.endsAt < out.startsAt) {
    return { ok: false, error: 'endsAt must not be before startsAt' };
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !EVENT_STATUSES.includes(body.status as EventStatus)) {
      return { ok: false, error: 'status must be draft, published or cancelled' };
    }
    out.status = body.status as EventStatus;
  }
  if (body.slug !== undefined) {
    if (typeof body.slug !== 'string' || body.slug.length > 60 || !EVENT_SLUG_RE.test(body.slug)) {
      return { ok: false, error: 'slug must be lowercase letters, digits and hyphens, up to 60 characters' };
    }
    out.slug = body.slug;
  }
  return { ok: true, value: out };
}

/** The body of PUT /admin/ticket-types/:id. Every key is optional (a new type needs eventId and name). */
export function validateTicketTypeInput(body: unknown): Result<TicketTypeInput> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  const out: TicketTypeInput = {};
  if (body.eventId !== undefined) {
    if (typeof body.eventId !== 'string' || !UUID_RE.test(body.eventId)) return { ok: false, error: 'eventId must be a UUID' };
    out.eventId = body.eventId.toLowerCase();
  }
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim() === '' || body.name.length > 80) {
      return { ok: false, error: 'name must be a non-empty string up to 80 characters' };
    }
    out.name = body.name.trim();
  }
  if (body.price !== undefined) {
    const p = body.price;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1_000_000 || Math.round(p * 100) / 100 !== p) {
      return { ok: false, error: 'price must be a number from 0 to 1000000 with at most 2 decimals' };
    }
    out.price = p;
  }
  if (body.capacity !== undefined) {
    const c = body.capacity;
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > 100_000) {
      return { ok: false, error: 'capacity must be a whole number from 0 to 100000' };
    }
    out.capacity = c;
  }
  for (const k of ['saleStartsAt', 'saleEndsAt'] as const) {
    if (body[k] === undefined) continue;
    if (body[k] === null) {
      out[k] = null;
      continue;
    }
    const d = isoDate(body[k]);
    if (!d) return { ok: false, error: `${k} must be null or an ISO date and time` };
    out[k] = d;
  }
  if (out.saleStartsAt && out.saleEndsAt && out.saleEndsAt < out.saleStartsAt) {
    return { ok: false, error: 'saleEndsAt must not be before saleStartsAt' };
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return { ok: false, error: 'active must be true or false' };
    out.active = body.active;
  }
  if (body.sort !== undefined) {
    const n = body.sort;
    if (typeof n !== 'number' || !Number.isInteger(n) || Math.abs(n) > 1_000_000) {
      return { ok: false, error: 'sort must be a whole number' };
    }
    out.sort = n;
  }
  return { ok: true, value: out };
}

/** A ticket code from a URL parameter: the full 128-bit codes are 32 hex characters; this accepts a little more room. */
export const TICKET_CODE_RE = /^[0-9a-zA-Z]{16,64}$/;

// --- Community ----------------------------------------------------------------------------------------------

export const SUBSCRIBER_SOURCES: SubscriberSource[] = ['community', 'footer', 'event'];

/** Mirrors normalise_phone in 20261031130000_community.sql: digits only, "00" dropped, a leading 0 becomes 27. */
export function normalisePhone(phone: string): string | null {
  const d = phone.replace(/[^0-9]/g, '').replace(/^00/, '');
  const n = d.startsWith('0') ? `27${d.slice(1)}` : d;
  return n === '' ? null : n;
}

/** The phone and email rules shared by the sign-up and the unsubscribe: each is optional, blank counts as absent,
 *  the phone needs 9 to 15 digits, the email a plausible address. Does not require either to be present. */
function readContact(body: Record<string, unknown>): Result<{ phone?: string; email?: string }> {
  const out: { phone?: string; email?: string } = {};
  if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
    if (typeof body.phone !== 'string' || body.phone.length > 40) return { ok: false, error: 'phone must be text' };
    const phone = body.phone.trim();
    if (phone !== '') {
      const digits = normalisePhone(phone) ?? '';
      if (digits.length < 9 || digits.length > 15 || !/^[0-9+()\s.-]+$/.test(phone)) {
        return { ok: false, error: 'phone must be a phone number' };
      }
      out.phone = phone;
    }
  }
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    if (typeof body.email !== 'string' || body.email.length > 254) return { ok: false, error: 'email must be text' };
    const email = body.email.trim();
    if (email !== '') {
      if (!EMAIL_RE.test(email)) return { ok: false, error: 'email must be an email address' };
      out.email = email;
    }
  }
  return { ok: true, value: out };
}

/**
 * The body of POST /subscribers. `consent` must be exactly true. The consent wording is never read from
 * the body: the route stores its own constant. At least one of phone and email is needed; the phone needs 9 to 15
 * digits, the email a plausible address.
 */
export function validateSubscribeInput(body: unknown): Result<SubscribeInput> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  if (body.consent !== true) return { ok: false, error: 'consent must be true' };
  if (typeof body.source !== 'string' || !SUBSCRIBER_SOURCES.includes(body.source as SubscriberSource)) {
    return { ok: false, error: 'source must be community, footer or event' };
  }
  const out: SubscribeInput = { source: body.source as SubscriberSource };
  if (body.name !== undefined && body.name !== null && body.name !== '') {
    if (typeof body.name !== 'string' || body.name.length > 100) {
      return { ok: false, error: 'name must be text up to 100 characters' };
    }
    if (body.name.trim() !== '') out.name = body.name.trim();
  }
  const contact = readContact(body);
  if (!contact.ok) return contact;
  if (contact.value.phone) out.phone = contact.value.phone;
  if (contact.value.email) out.email = contact.value.email;
  if (!out.phone && !out.email) return { ok: false, error: 'Give a phone number or an email address' };
  return { ok: true, value: out };
}

/**
 * The body of POST /subscribers/unsubscribe: a phone, an email or both, checked like a sign-up's. At least one is
 * needed. Nothing else in the body is read.
 */
export function validateUnsubscribeInput(body: unknown): Result<{ phone?: string; email?: string }> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  const contact = readContact(body);
  if (!contact.ok) return contact;
  if (!contact.value.phone && !contact.value.email) return { ok: false, error: 'Give a phone number or an email address' };
  return contact;
}

/** The body of PUT /admin/gallery/:id. Every key is optional (a new item needs image). */
export function validateGalleryInput(body: unknown): Result<GalleryInput> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  const out: GalleryInput = {};
  if (body.image !== undefined) {
    if (typeof body.image !== 'string' || body.image.length > 2000 || !isHttpUrl(body.image.trim())) {
      return { ok: false, error: 'image must be an http(s) link' };
    }
    out.image = body.image.trim();
  }
  if (body.caption !== undefined) {
    if (typeof body.caption !== 'string' || body.caption.length > 300) {
      return { ok: false, error: 'caption must be text up to 300 characters' };
    }
    out.caption = body.caption.trim();
  }
  if (body.eventId !== undefined) {
    if (body.eventId === null) {
      out.eventId = null;
    } else if (typeof body.eventId === 'string' && UUID_RE.test(body.eventId)) {
      out.eventId = body.eventId.toLowerCase();
    } else {
      return { ok: false, error: 'eventId must be null or a UUID' };
    }
  }
  if (body.sort !== undefined) {
    const n = body.sort;
    if (typeof n !== 'number' || !Number.isInteger(n) || Math.abs(n) > 1_000_000) {
      return { ok: false, error: 'sort must be a whole number' };
    }
    out.sort = n;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return { ok: false, error: 'active must be true or false' };
    out.active = body.active;
  }
  return { ok: true, value: out };
}
