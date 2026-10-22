import type { KvLike, Product, ProductInput } from './types.ts';

export const SEED_PRODUCTS: ProductInput[] = [
  {
    name: 'Classic Cotton T-Shirt',
    category: 'tshirts',
    price: 25,
    description: 'Comfortable 100% cotton t-shirt perfect for everyday wear',
    images: [],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colors: ['Black', 'White', 'Navy', 'Gray'],
    stock: 50,
  },
  {
    name: 'Premium Sports Jersey',
    category: 'jerseys',
    price: 45,
    description: 'Breathable sports jersey with moisture-wicking technology',
    images: [],
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Red', 'Blue', 'Green'],
    stock: 30,
  },
  {
    name: 'Athletic Shorts',
    category: 'shorts',
    price: 30,
    description: 'Lightweight shorts ideal for workouts and sports',
    images: [],
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Black', 'Navy', 'Gray'],
    stock: 40,
  },
  {
    name: 'Casual Jogger Pants',
    category: 'pants',
    price: 50,
    description: 'Comfortable jogger pants with elastic waistband',
    images: [],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colors: ['Black', 'Gray', 'Khaki'],
    stock: 35,
  },
  {
    name: 'Baseball Cap',
    category: 'accessories',
    price: 20,
    description: 'Adjustable baseball cap with embroidered logo',
    images: [],
    sizes: ['One Size'],
    colors: ['Black', 'Navy', 'White', 'Red'],
    stock: 60,
  },
];

export async function ensureSeeded(kv: KvLike): Promise<void> {
  if (await kv.get('meta:seeded')) return;
  const base = Date.parse('2024-01-01T00:00:00.000Z');
  for (let i = 0; i < SEED_PRODUCTS.length; i++) {
    const input = SEED_PRODUCTS[i];
    const id = String(i + 1);
    const product: Product = {
      ...input,
      id,
      image: input.images[0] ?? '',
      createdAt: new Date(base + i * 1000).toISOString(),
    };
    await kv.set(`product:${id}`, product);
  }
  await kv.set('meta:seeded', true);
}
