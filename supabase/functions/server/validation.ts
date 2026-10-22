import type { CartQuoteRequest, Category, ProductInput } from './types.ts';

const CATEGORIES: Category[] = ['tshirts', 'jerseys', 'shorts', 'pants', 'accessories'];

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

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

export function validateProductInput(
  body: unknown,
  partial: boolean,
): { ok: true; value: Partial<ProductInput> } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  const out: Partial<ProductInput> = {};
  const has = (k: string) => body[k] !== undefined;

  const required = ['name', 'category', 'price', 'images', 'sizes', 'colors', 'stock'];
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
    if (typeof body.category !== 'string' || !CATEGORIES.includes(body.category as Category)) {
      return { ok: false, error: `category must be one of: ${CATEGORIES.join(', ')}` };
    }
    out.category = body.category as Category;
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
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 0) {
      return { ok: false, error: 'stock must be an integer >= 0' };
    }
    out.stock = s;
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
