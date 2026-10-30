import type { Category, CategoryStore, ProductInput, ProductStore } from './types.ts';

export const SEED_PRODUCTS: Omit<ProductInput, 'active'>[] = [
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

export const SEED_CATEGORIES: Category[] = [
  { id: 'tshirts', name: 'T-Shirts', sort: 1, active: true },
  { id: 'jerseys', name: 'Jerseys', sort: 2, active: true },
  { id: 'shorts', name: 'Shorts', sort: 3, active: true },
  { id: 'pants', name: 'Pants', sort: 4, active: true },
  { id: 'accessories', name: 'Accessories', sort: 5, active: true },
];

// For dev.ts and tests only. Production data lives in Postgres (the catalogue
// migration copies the old products over); the edge function must never seed.
export async function seedCatalogue(categories: CategoryStore, products: ProductStore): Promise<void> {
  for (const c of SEED_CATEGORIES) await categories.upsert(c);
  const base = Date.parse('2024-01-01T00:00:00.000Z');
  for (let i = 0; i < SEED_PRODUCTS.length; i++) {
    const r = await products.create({
      ...SEED_PRODUCTS[i],
      id: String(i + 1),
      createdAt: new Date(base + i * 1000).toISOString(),
    });
    if (!r.ok) throw new Error(`seed failed: ${r.reason}`);
  }
}
