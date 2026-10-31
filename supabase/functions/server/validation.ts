import type {
  CartQuoteRequest,
  Customer,
  DeliveryAddress,
  DeliveryInput,
  OrderItemInput,
  PaymentMethod,
  ProductInput,
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

export function validateOrder(
  body: unknown,
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
  if (items.reduce((n, it) => n + it.quantity, 0) > MAX_ORDER_UNITS) {
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
