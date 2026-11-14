// Direct tests for the input checks in validation.ts. Each rejected input asserts its exact error text; each accepted
// input asserts the value that would be stored. The HTTP behaviour of these checks is tested in the route test files.
import { assertEquals } from '@std/assert';
import {
  validateEventInput,
  validateGalleryInput,
  validateOrder,
  validateProductInput,
  validateQuote,
  validateTicketTypeInput,
} from './validation.ts';

const UUID = '0b8f2c1e-5a4d-4e3b-9c2a-1f2e3d4c5b6a';
const PRODUCT = { name: 'Tee', category: 'tshirts', price: 100, images: [], sizes: ['M'], colors: ['Black'], stock: 5 };
const ORDER = { id: UUID, items: [{ productId: 'p1', quantity: 1 }], customer: { name: 'Thandi', phone: '0821234567' } };

Deno.test('validation product: sizes and colours must be non-empty lists of non-empty text', () => {
  assertEquals(validateProductInput({ ...PRODUCT, sizes: [] }, false), { ok: false, error: 'sizes must be a non-empty array' });
  assertEquals(validateProductInput({ ...PRODUCT, sizes: 'M' }, false), { ok: false, error: 'sizes must be a non-empty array' });
  assertEquals(validateProductInput({ ...PRODUCT, sizes: ['M', '  '] }, false), {
    ok: false,
    error: 'sizes must contain non-empty strings',
  });
  assertEquals(validateProductInput({ ...PRODUCT, colors: [] }, false), { ok: false, error: 'colors must be a non-empty array' });
  assertEquals(validateProductInput({ ...PRODUCT, colors: [7] }, false), {
    ok: false,
    error: 'colors must contain non-empty strings',
  });
});

Deno.test('validation product: name length and description are checked, and a description is kept', () => {
  assertEquals(validateProductInput({ ...PRODUCT, name: '   ' }, false), {
    ok: false,
    error: 'name must be a non-empty string up to 120 characters',
  });
  assertEquals(validateProductInput({ ...PRODUCT, name: 'x'.repeat(121) }, false), {
    ok: false,
    error: 'name must be a non-empty string up to 120 characters',
  });
  assertEquals(validateProductInput({ ...PRODUCT, description: 'x'.repeat(2001) }, false), {
    ok: false,
    error: 'description must be a string up to 2000 characters',
  });
  assertEquals(validateProductInput({ ...PRODUCT, description: 9 }, false), {
    ok: false,
    error: 'description must be a string up to 2000 characters',
  });
  assertEquals(validateProductInput({ ...PRODUCT, description: 'Soft cotton' }, false), {
    ok: true,
    value: { name: 'Tee', category: 'tshirts', price: 100, description: 'Soft cotton', images: [], sizes: ['M'], colors: ['Black'], stock: 5 },
  });
});

Deno.test('validation product: images are at most three, each empty or an http(s) URL', () => {
  const four = ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg', 'https://cdn.test/3.jpg', 'https://cdn.test/4.jpg'];
  assertEquals(validateProductInput({ ...PRODUCT, images: four }, false), {
    ok: false,
    error: 'images must be an array of at most 3 entries',
  });
  for (const images of [['javascript:alert(1)'], ['not a url'], [5]]) {
    assertEquals(validateProductInput({ ...PRODUCT, images }, false), {
      ok: false,
      error: 'images entries must be empty or http(s) URLs',
    });
  }
  assertEquals(validateProductInput({ ...PRODUCT, images: ['', 'https://cdn.test/a.jpg'] }, false), {
    ok: true,
    value: { name: 'Tee', category: 'tshirts', price: 100, description: '', images: ['', 'https://cdn.test/a.jpg'], sizes: ['M'], colors: ['Black'], stock: 5 },
  });
});

Deno.test('validation product: stock must be a whole number of zero or more', () => {
  for (const stock of [-1, 1.5, '5']) {
    assertEquals(validateProductInput({ ...PRODUCT, stock }, false), { ok: false, error: 'stock must be an integer >= 0' });
  }
});

Deno.test('validation product: new variants keep an optional size and colour, and reject a bad one', () => {
  // With variants, stock is not needed; a variant with no size or colour keeps only its stock.
  assertEquals(
    validateProductInput({ ...PRODUCT, stock: undefined, variants: [{ size: 'M', color: 'Black', stock: 2 }, { stock: 0 }] }, false),
    {
      ok: true,
      value: {
        name: 'Tee',
        category: 'tshirts',
        price: 100,
        description: '',
        images: [],
        sizes: ['M'],
        colors: ['Black'],
        variants: [{ size: 'M', color: 'Black', stock: 2 }, { stock: 0 }],
      },
    },
  );
  assertEquals(validateProductInput({ ...PRODUCT, variants: [{ size: 5, stock: 1 }] }, false), {
    ok: false,
    error: 'variant size must be a string up to 40 characters',
  });
  assertEquals(validateProductInput({ ...PRODUCT, variants: [{ color: 'x'.repeat(41), stock: 1 }] }, false), {
    ok: false,
    error: 'variant color must be a string up to 40 characters',
  });
  assertEquals(validateProductInput({ ...PRODUCT, variants: [{ stock: -1 }] }, false), {
    ok: false,
    error: 'variant stock must be an integer >= 0',
  });
});

Deno.test('validation quote: the items must be a list, and each needs a product id', () => {
  assertEquals(validateQuote(null), { ok: false, error: 'items must be an array' });
  assertEquals(validateQuote({ items: 'p1' }), { ok: false, error: 'items must be an array' });
  assertEquals(validateQuote({ items: [{ productId: '', quantity: 1 }] }), {
    ok: false,
    error: 'each item needs a string productId',
  });
  assertEquals(validateQuote({ items: [{ productId: 7, quantity: 1 }] }), {
    ok: false,
    error: 'each item needs a string productId',
  });
  assertEquals(validateQuote({ items: [{ productId: 'p1', quantity: 2, size: 'M', color: 'Black' }] }), {
    ok: true,
    value: { items: [{ productId: 'p1', quantity: 2, size: 'M', color: 'Black' }] },
  });
});

Deno.test('validation order: each item needs a product id, and a door address needs a suburb', () => {
  assertEquals(validateOrder({ ...ORDER, items: [{ productId: '', quantity: 1 }] }), {
    ok: false,
    error: 'each item needs a string productId',
  });
  assertEquals(validateOrder({ ...ORDER, items: [{ productId: 7, quantity: 1 }] }), {
    ok: false,
    error: 'each item needs a string productId',
  });
  assertEquals(
    validateOrder({
      ...ORDER,
      delivery: { method: 'door', address: { line1: '12 Main Rd', suburb: '  ', city: 'Cape Town', postalCode: '8005' } },
    }),
    { ok: false, error: 'address suburb must be 1 to 120 characters' },
  );
});

Deno.test('validation event: title, text lengths and image are checked, and a title is trimmed', () => {
  assertEquals(validateEventInput({ title: '   ' }), { ok: false, error: 'title must be a non-empty string up to 120 characters' });
  assertEquals(validateEventInput({ title: 'x'.repeat(121) }), {
    ok: false,
    error: 'title must be a non-empty string up to 120 characters',
  });
  assertEquals(validateEventInput({ description: 'x'.repeat(4001) }), {
    ok: false,
    error: 'description must be a string up to 4000 characters',
  });
  assertEquals(validateEventInput({ venue: 'x'.repeat(161) }), { ok: false, error: 'venue must be a string up to 160 characters' });
  assertEquals(validateEventInput({ city: 'x'.repeat(81) }), { ok: false, error: 'city must be a string up to 80 characters' });
  assertEquals(validateEventInput({ image: 'nope' }), { ok: false, error: 'image must be empty or an http(s) URL' });
  assertEquals(validateEventInput({ image: 'javascript:alert(1)' }), { ok: false, error: 'image must be empty or an http(s) URL' });
  assertEquals(validateEventInput({ title: '  Night Run  ', image: 'https://x.test/a.jpg' }), {
    ok: true,
    value: { title: 'Night Run', image: 'https://x.test/a.jpg' },
  });
});

Deno.test('validation ticket type: name, sale dates and sort are checked', () => {
  assertEquals(validateTicketTypeInput({ name: '' }), {
    ok: false,
    error: 'name must be a non-empty string up to 80 characters',
  });
  assertEquals(validateTicketTypeInput({ name: 'x'.repeat(81) }), {
    ok: false,
    error: 'name must be a non-empty string up to 80 characters',
  });
  // Null clears a sale date.
  assertEquals(validateTicketTypeInput({ saleStartsAt: null, saleEndsAt: null }), {
    ok: true,
    value: { saleStartsAt: null, saleEndsAt: null },
  });
  assertEquals(validateTicketTypeInput({ sort: 1.5 }), { ok: false, error: 'sort must be a whole number' });
  assertEquals(validateTicketTypeInput({ sort: 1_000_001 }), { ok: false, error: 'sort must be a whole number' });
  assertEquals(validateTicketTypeInput({ sort: -3 }), { ok: true, value: { sort: -3 } });
});

Deno.test('validation gallery: a caption is up to 300 characters and is trimmed', () => {
  assertEquals(validateGalleryInput({ caption: 'x'.repeat(301) }), {
    ok: false,
    error: 'caption must be text up to 300 characters',
  });
  assertEquals(validateGalleryInput({ caption: '  Night run  ' }), { ok: true, value: { caption: 'Night run' } });
});
