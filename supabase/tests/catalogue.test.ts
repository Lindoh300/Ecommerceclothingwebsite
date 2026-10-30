// Tests for supabase/migrations/20261030000000_catalogue.sql, run against an
// in-process Postgres (PGlite). Run with `deno task test:sql` from
// supabase/functions/server.
//
// PGlite is ONE connection, so these tests cannot show real row-lock races
// between concurrent transactions. They check the logic and the results. The
// lock order (orders row, then variant rows by id, then the products row) is
// written at the top of the migration and in each function, and has to be
// reviewed by reading it.
import { assert, assertEquals, assertRejects } from '@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.13';

// deno-lint-ignore no-explicit-any
type Json = any;
type Db = Awaited<ReturnType<PGlite['clone']>>;

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const readMigration = (name: string) => Deno.readTextFile(new URL(name, MIGRATIONS));
const OLD_MIGRATIONS = ['20261021000000_init.sql', '20261022000000_orders.sql', '20261029000000_update_product.sql'];
const NEW_MIGRATION = '20261030000000_catalogue.sql';

// ---------------------------------------------------------------------------
// Fixture: what the live database looks like before the new migration.
// ---------------------------------------------------------------------------
const TEE_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const TEE_COLORS = ['Black', 'White', 'Red', 'Blue'];
const UUID_ID = 'b3f1c1d2-5a6e-4c7f-9d8e-0a1b2c3d4e5f';

const kvProducts: Record<string, Json> = {
  '1': {
    id: '1', name: 'Classic Tee', category: 'tshirts', price: 250, description: 'Plain cotton tee',
    image: '', images: [], sizes: TEE_SIZES, colors: TEE_COLORS, stock: 59, createdAt: '2026-01-05T10:00:00.000Z',
  },
  '2': {
    id: '2', name: 'Cap', category: 'accessories', price: 120.5, description: '',
    image: 'https://img.test/cap.png', images: ['', 'https://img.test/cap.png'], sizes: ['One Size'], colors: [],
    stock: 7, createdAt: '2026-01-06T10:00:00.000Z',
  },
  [UUID_ID]: {
    id: UUID_ID, name: 'Training Shorts!', category: 'shorts', price: 199.99, description: 'Light shorts',
    image: '', images: [], sizes: ['S', 'M'], colors: ['Black'], stock: 10, createdAt: '2026-03-01T08:30:00.000Z',
  },
  '3': {
    id: '3', name: 'Home Jersey', category: 'jerseys', price: 450, description: '',
    image: '', images: [], sizes: ['M', 'L'], colors: ['Green'], stock: 5, createdAt: '2026-02-01T00:00:00.000Z',
  },
  '4': {
    id: '4', name: 'Home Jersey', category: 'jerseys', price: 460, description: '',
    image: '', images: [], sizes: ['M', 'L'], colors: ['Green'], stock: 4, createdAt: '2026-02-01T00:00:00.000Z',
  },
  '5': {
    id: '5', name: 'Zip Hoodie', category: 'baby-wear', price: 600, description: '',
    image: '', images: [], sizes: ['M'], colors: [], stock: 0, createdAt: '2026-02-10T00:00:00.000Z',
  },
  '6': {
    id: '6', name: 'Odd Sizes', category: 'pants', price: 300, description: '',
    image: '', images: [], sizes: ['X-L', 'XL'], colors: ['Navy Blue', 'NavyBlue'], stock: 9, createdAt: '2026-02-11T00:00:00.000Z',
  },
};

const OLD_ORDER_ID = '11111111-2222-4333-8444-555555555555';
const oldOrderLines = [
  { productId: '1', name: 'Classic Tee', price: 250, size: 'M', color: 'Red', quantity: 2, subtotal: 500 },
  { productId: '1', name: 'Classic Tee', price: 250, size: 'XXS', color: 'Black', quantity: 1, subtotal: 250 },
];

const SUPABASE_ROLES_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  -- Supabase hands every new table and function in public to these roles by
  -- default. Mirror that, so the migration's revokes are really tested.
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

let preDb: Promise<Db> | undefined;
let postDb: Promise<Db> | undefined;

/** Roles, the three older migrations and the live-shaped kv rows and order. */
function pre(): Promise<Db> {
  preDb ??= (async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_ROLES_SQL);
    for (const f of OLD_MIGRATIONS) await db.exec(await readMigration(f));
    for (const [id, value] of Object.entries(kvProducts)) {
      await db.query('insert into public.kv_store_fbb8f0e1 (key, value) values ($1, $2::jsonb)', [
        `product:${id}`,
        JSON.stringify(value),
      ]);
    }
    await db.query(`insert into public.kv_store_fbb8f0e1 (key, value) values ('meta:seeded', 'true'::jsonb)`);
    await db.query(
      `insert into public.orders (id, ref, status, lines, total, customer) values ($1, 'ABCD1234', 'pending', $2::jsonb, 750, $3::jsonb)`,
      [OLD_ORDER_ID, JSON.stringify(oldOrderLines), JSON.stringify({ name: 'Old Customer', phone: '0820000000' })],
    );
    return db;
  })();
  return preDb;
}

/** `pre` plus the new migration applied once. */
function post(): Promise<Db> {
  postDb ??= (async () => {
    const db = await (await pre()).clone();
    await db.exec(await readMigration(NEW_MIGRATION));
    return db;
  })();
  return postDb;
}

/** Run a test body on a private copy of the migrated database. */
async function withDb(body: (db: Db) => Promise<void>): Promise<void> {
  const db = await (await post()).clone();
  try {
    await body(db);
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
async function rows(db: Db, sql: string, params: unknown[] = []): Promise<Json[]> {
  return (await db.query(sql, params)).rows as Json[];
}

/** Call a SQL function expression and return its single jsonb/scalar result. */
async function call(db: Db, expr: string, ...params: unknown[]): Promise<Json> {
  return ((await db.query(`select ${expr} as r`, params)).rows[0] as Json).r;
}

const j = (v: unknown) => JSON.stringify(v);

const placeV2 = (db: Db, id: string, items: unknown[], customer: unknown = { name: 'Test', phone: '0' }) =>
  call(db, 'public.place_order_v2($1::uuid, $2::jsonb, $3::jsonb)', id, j(items), j(customer));
const cancelV2 = (db: Db, id: string) => call(db, 'public.cancel_order_v2($1::uuid)', id);
const updateV2 = (
  db: Db,
  id: string,
  patch: unknown,
  expected: number | null = null,
  variants: unknown = null,
) =>
  call(
    db,
    'public.update_product_v2($1, $2::jsonb, $3::int, $4::jsonb)',
    id,
    j(patch),
    expected,
    variants === null ? null : j(variants),
  );
const createProduct = (db: Db, id: string, input: unknown) =>
  call(db, 'public.create_product($1, $2::jsonb)', id, j(input));

interface Variant {
  id: string;
  sku: string;
  size: string;
  color: string;
  stock: number;
}

/** A product's variants straight from the table, in size then colour order. */
async function variantsOf(db: Db, productId: string): Promise<Variant[]> {
  const p = (await rows(db, 'select sizes, colors from public.products where id = $1', [productId]))[0];
  const list: Variant[] = await rows(
    db,
    'select id, sku, size, color, stock from public.product_variants where product_id = $1',
    [productId],
  );
  const pos = (arr: string[], v: string) => (arr.includes(v) ? arr.indexOf(v) : 1e6);
  return list.sort((a, b) =>
    pos(p.sizes, a.size) - pos(p.sizes, b.size) || pos(p.colors, a.color) - pos(p.colors, b.color)
  );
}

const total = (vs: Variant[]) => vs.reduce((n, v) => n + v.stock, 0);
const stocks = (vs: Variant[]) => vs.map((v) => v.stock);

async function findVariant(db: Db, productId: string, size: string, color: string): Promise<Variant> {
  const v = (await variantsOf(db, productId)).find((x) => x.size === size && x.color === color);
  assert(v, `variant ${productId}/${size}/${color} exists`);
  return v;
}

async function setStock(db: Db, variantId: string, stock: number) {
  await db.query('update public.product_variants set stock = $2 where id = $1', [variantId, stock]);
}

/** The three new tables as one comparable value. */
async function dumpCatalogue(db: Db): Promise<Json> {
  const q = (sql: string) => rows(db, sql);
  return {
    categories: await q('select to_jsonb(t) as r from public.categories t order by t.id'),
    products: await q('select to_jsonb(t) as r from public.products t order by t.id'),
    variants: await q('select to_jsonb(t) as r from public.product_variants t order by t.id'),
  };
}

async function dumpKvAndOrders(db: Db): Promise<Json> {
  return {
    kv: await rows(db, 'select key, value from public.kv_store_fbb8f0e1 order by key'),
    orders: await rows(db, 'select to_jsonb(o) as r from public.orders o order by o.id'),
  };
}

const OLD_FUNCTIONS = ['place_order', 'cancel_order', 'update_product', 'order_json'];
async function oldFunctionDefs(db: Db): Promise<Json> {
  return await rows(
    db,
    `select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any($1::text[])
     order by p.proname, args`,
    [OLD_FUNCTIONS],
  );
}

const newId = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// Data copy.
// ---------------------------------------------------------------------------
Deno.test('copy: every product, its id and createdAt, totals and all size x colour combinations', async () => {
  await withDb(async (db) => {
    const prods = await rows(db, 'select id, extract(epoch from created_at)::float8 as ts from public.products order by id');
    assertEquals(prods.map((p) => p.id).sort(), Object.keys(kvProducts).sort());

    for (const [id, kv] of Object.entries(kvProducts)) {
      const p = prods.find((x) => x.id === id);
      assertEquals(p.ts, Date.parse(kv.createdAt) / 1000, `created_at of ${id}`);

      const vs = await variantsOf(db, id);
      assertEquals(total(vs), kv.stock, `stock total of ${id}`);

      const sizes: string[] = kv.sizes.length ? kv.sizes : [''];
      const colors: string[] = kv.colors.length ? kv.colors : [''];
      const expected = sizes.flatMap((s) => colors.map((c) => `${s}|${c}`));
      assertEquals(vs.map((v) => `${v.size}|${v.color}`), expected, `combinations of ${id}`);
    }
  });
});

Deno.test('copy: stock is split evenly and the remainder goes to the first variants', async () => {
  await withDb(async (db) => {
    // 59 over 20 variants: 19 variants get 3, the last (XXL / Blue) gets 2.
    const tee = stocks(await variantsOf(db, '1'));
    assertEquals(tee, [...Array(19).fill(3), 2]);
    // 9 over 4: 3, 2, 2, 2.
    assertEquals(stocks(await variantsOf(db, '6')), [3, 2, 2, 2]);
    // Zero stock stays zero.
    assertEquals(stocks(await variantsOf(db, '5')), [0]);
    // One size, no colours: a single variant with '' colour.
    const cap = await variantsOf(db, '2');
    assertEquals(cap.map((v) => [v.size, v.color, v.stock]), [['One Size', '', 7]]);
  });
});

Deno.test('copy: slugs are unique, lowercase and hyphenated, with -2 for a repeated name', async () => {
  await withDb(async (db) => {
    const slugs = Object.fromEntries((await rows(db, 'select id, slug from public.products')).map((r) => [r.id, r.slug]));
    assertEquals(slugs, {
      '1': 'classic-tee',
      '2': 'cap',
      [UUID_ID]: 'training-shorts',
      '3': 'home-jersey',
      '4': 'home-jersey-2',
      '5': 'zip-hoodie',
      '6': 'odd-sizes',
    });
  });
});

Deno.test('copy: categories are seeded, and a category found only in product data is added', async () => {
  await withDb(async (db) => {
    const cats = await rows(db, 'select id, name, sort, active from public.categories order by sort, name');
    assertEquals(cats, [
      { id: 'tshirts', name: 'T-Shirts', sort: 1, active: true },
      { id: 'jerseys', name: 'Jerseys', sort: 2, active: true },
      { id: 'shorts', name: 'Shorts', sort: 3, active: true },
      { id: 'pants', name: 'Pants', sort: 4, active: true },
      { id: 'accessories', name: 'Accessories', sort: 5, active: true },
      { id: 'baby-wear', name: 'Baby Wear', sort: 100, active: true },
    ]);
    const hoodie = (await rows(db, `select category_id from public.products where id = '5'`))[0];
    assertEquals(hoodie.category_id, 'baby-wear');
  });
});

Deno.test('copy: SKUs follow the formula and stay unique', async () => {
  await withDb(async (db) => {
    const tee = await variantsOf(db, '1');
    assertEquals(tee[0].sku, 'N1-S-BLACK');
    assertEquals(tee[19].sku, 'N1-XXL-BLUE');
    assertEquals((await variantsOf(db, '2'))[0].sku, 'N2-ONESIZE-');
    // UUID id: 'N' + first 8 characters of the id without hyphens.
    assertEquals((await variantsOf(db, UUID_ID))[0].sku, 'NB3F1C1D2-S-BLACK');
    // 'X-L' / 'XL' and 'Navy Blue' / 'NavyBlue' collapse to the same text; a suffix keeps them apart.
    const odd = (await variantsOf(db, '6')).map((v) => v.sku);
    assertEquals(odd, ['N6-XL-NAVYBLUE', 'N6-XL-NAVYBLUE-2', 'N6-XL-NAVYBLUE-3', 'N6-XL-NAVYBLUE-4']);
    const all = await rows(db, 'select sku from public.product_variants');
    assertEquals(new Set(all.map((r) => r.sku)).size, all.length);
  });
});

Deno.test('migration is idempotent: a second run changes nothing and overwrites nothing', async () => {
  await withDb(async (db) => {
    const sql = await readMigration(NEW_MIGRATION);
    const first = await dumpCatalogue(db);
    await db.exec(sql);
    assertEquals(await dumpCatalogue(db), first);

    // Admin edits made after the migration survive a re-run.
    await updateV2(db, '1', { price: 275, name: 'Renamed Tee' });
    const v = await findVariant(db, '1', 'M', 'Red');
    await setStock(db, v.id, 42);
    await call(db, `public.upsert_category('tshirts', 'Tees', 9, false)`);
    const edited = await dumpCatalogue(db);
    await db.exec(sql);
    assertEquals(await dumpCatalogue(db), edited);
  });
});

Deno.test('kv table, orders and the old functions are untouched by the migration', async () => {
  const before = await pre();
  const after = await post();
  assertEquals(await dumpKvAndOrders(after), await dumpKvAndOrders(before));
  assertEquals(await oldFunctionDefs(after), await oldFunctionDefs(before));
  assertEquals((await oldFunctionDefs(after)).length, OLD_FUNCTIONS.length);
  // Same columns on the kv and orders tables.
  const cols = (db: Db) =>
    rows(
      db,
      `select table_name, column_name, data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name in ('kv_store_fbb8f0e1', 'orders') order by table_name, ordinal_position`,
    );
  assertEquals(await cols(after), await cols(before));
});

Deno.test('the old place_order and update_product still work on kv and do not touch the new tables', async () => {
  await withDb(async (db) => {
    const catalogueBefore = await dumpCatalogue(db);
    const id = newId();
    const r = await call(db, 'public.place_order($1::uuid, $2::jsonb, $3::jsonb)', id, j([{ productId: '1', size: 'M', quantity: 2 }]), j({ name: 'A', phone: '1' }));
    assertEquals(r.ok, true);
    assertEquals((await rows(db, `select value->>'stock' as s from public.kv_store_fbb8f0e1 where key = 'product:1'`))[0].s, '57');
    const u = await call(db, `public.update_product('2', '{"price": 99}'::jsonb)`);
    assertEquals(u.ok, true);
    assertEquals(await dumpCatalogue(db), catalogueBefore);
  });
});

// ---------------------------------------------------------------------------
// Grants and RLS.
// ---------------------------------------------------------------------------
const NEW_FUNCTIONS = [
  'product_json', 'list_products', 'get_product', 'list_categories', 'upsert_category', 'delete_category',
  'create_product', 'update_product_v2', 'delete_product', 'place_order_v2', 'cancel_order_v2',
];

Deno.test('grants: anon and authenticated cannot execute the new functions or read the new tables', async () => {
  await withDb(async (db) => {
    const fns = await rows(
      db,
      `select p.oid::regprocedure::text as sig, p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (p.proname = any($1::text[]) or p.proname like 'catalogue\\_%')`,
      [NEW_FUNCTIONS],
    );
    assert(fns.length >= NEW_FUNCTIONS.length + 8);
    for (const f of fns) {
      for (const role of ['anon', 'authenticated']) {
        assertEquals(
          (await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, f.sig]))[0].ok,
          false,
          `${role} must not execute ${f.sig}`,
        );
      }
      assertEquals(
        (await rows(db, `select has_function_privilege('service_role', $1, 'execute') as ok`, [f.sig]))[0].ok,
        true,
        `service_role executes ${f.sig}`,
      );
    }
    assertEquals(
      (await rows(db, `select has_function_privilege('anon', 'public.place_order_v2(uuid, jsonb, jsonb)', 'execute') as ok`))[0].ok,
      false,
    );

    for (const table of ['categories', 'products', 'product_variants']) {
      for (const role of ['anon', 'authenticated']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          assertEquals(
            (await rows(db, `select has_table_privilege($1, $2, $3) as ok`, [role, `public.${table}`, priv]))[0].ok,
            false,
            `${role} ${priv} on ${table}`,
          );
        }
      }
    }
    const rls = await rows(
      db,
      `select relname, relrowsecurity from pg_class where relname in ('categories','products','product_variants') order by relname`,
    );
    assertEquals(rls.map((r) => r.relrowsecurity), [true, true, true]);
    assertEquals((await rows(db, `select count(*)::int as n from pg_policies where schemaname = 'public'`))[0].n, 0);
  });
});

Deno.test('grants: a real call as anon is refused, and works as service_role', async () => {
  await withDb(async (db) => {
    await db.exec('set role anon');
    try {
      await assertRejects(() => placeV2(db, newId(), [{ productId: '2', quantity: 1 }]), Error, 'permission denied');
      await assertRejects(() => db.query('select * from public.product_variants'), Error, 'permission denied');
    } finally {
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    try {
      const r = await placeV2(db, newId(), [{ productId: '2', quantity: 1 }]);
      assertEquals(r.ok, true);
    } finally {
      await db.exec('reset role');
    }
  });
});

// ---------------------------------------------------------------------------
// product_json, list_products, get_product, categories.
// ---------------------------------------------------------------------------
Deno.test('product_json: shape, types, image and variant order', async () => {
  await withDb(async (db) => {
    const tee = await call(db, `public.get_product('1')`);
    assertEquals(Object.keys(tee).sort(), [
      'active', 'category', 'colors', 'createdAt', 'description', 'id', 'image', 'images', 'name', 'price',
      'sizes', 'slug', 'stock', 'variants',
    ]);
    assertEquals(tee.id, '1');
    assertEquals(tee.slug, 'classic-tee');
    assertEquals(tee.category, 'tshirts');
    assertEquals(tee.price, 250);
    assertEquals(typeof tee.price, 'number');
    assertEquals(tee.stock, 59);
    assertEquals(tee.image, '');
    assertEquals(tee.active, true);
    assertEquals(tee.sizes, TEE_SIZES);
    assertEquals(tee.colors, TEE_COLORS);
    assertEquals(Date.parse(tee.createdAt), Date.parse('2026-01-05T10:00:00.000Z'));
    assertEquals(tee.variants.length, 20);
    assertEquals(Object.keys(tee.variants[0]).sort(), ['color', 'id', 'size', 'sku', 'stock']);
    // Size position first, then colour position.
    assertEquals(
      tee.variants.map((v: Variant) => `${v.size}/${v.color}`),
      TEE_SIZES.flatMap((s) => TEE_COLORS.map((c) => `${s}/${c}`)),
    );
    assertEquals(tee.stock, tee.variants.reduce((n: number, v: Variant) => n + v.stock, 0));

    // First NON-EMPTY image, and a fractional price stays fractional.
    const cap = await call(db, `public.get_product('2')`);
    assertEquals(cap.image, 'https://img.test/cap.png');
    assertEquals(cap.images, ['', 'https://img.test/cap.png']);
    assertEquals(cap.price, 120.5);
    assertEquals(cap.variants.map((v: Variant) => [v.size, v.color]), [['One Size', '']]);
  });
});

Deno.test('product_json: variant order follows sizes/colors, not alphabet or insertion', async () => {
  await withDb(async (db) => {
    const r = await createProduct(db, 'ord-1', {
      name: 'Ordering', category: 'pants', price: 1, description: '', images: [],
      sizes: ['XL', 'S', 'M'], colors: ['Red', 'Blue'], stock: 0,
    });
    assertEquals(
      r.product.variants.map((v: Variant) => `${v.size}/${v.color}`),
      ['XL/Red', 'XL/Blue', 'S/Red', 'S/Blue', 'M/Red', 'M/Blue'],
    );
  });
});

Deno.test('list_products and get_product: order, inactive filter, lookup by id or slug', async () => {
  await withDb(async (db) => {
    const list = await call(db, 'public.list_products()');
    assertEquals(list.map((p: Json) => p.id), ['1', '2', '3', '4', '5', '6', UUID_ID]);
    // '3' and '4' share a createdAt, so id breaks the tie.

    assertEquals((await call(db, `public.get_product('classic-tee')`)).id, '1');
    assertEquals((await call(db, `public.get_product('1')`)).slug, 'classic-tee');
    assertEquals((await call(db, `public.get_product($1)`, UUID_ID)).slug, 'training-shorts');
    assertEquals(await call(db, `public.get_product('nope')`), null);

    await updateV2(db, '2', { active: false });
    assertEquals((await call(db, 'public.list_products()')).map((p: Json) => p.id).includes('2'), false);
    assertEquals((await call(db, 'public.list_products(false)')).length, 6);
    const all = await call(db, 'public.list_products(true)');
    assertEquals(all.length, 7);
    assertEquals(all.find((p: Json) => p.id === '2').active, false);
    // get_product still returns an inactive product (the API checks `active`).
    assertEquals((await call(db, `public.get_product('cap')`)).active, false);
  });
});

Deno.test('categories: list order, upsert, in-use refusal, delete', async () => {
  await withDb(async (db) => {
    const list = await call(db, 'public.list_categories()');
    assertEquals(list.map((c: Json) => c.id), ['tshirts', 'jerseys', 'shorts', 'pants', 'accessories', 'baby-wear']);
    assertEquals(list[0], { id: 'tshirts', name: 'T-Shirts', sort: 1, active: true });

    // Insert.
    assertEquals(await call(db, `public.upsert_category('socks', 'Socks', 0, true)`), {
      id: 'socks', name: 'Socks', sort: 0, active: true,
    });
    // Same sort, so name breaks the tie: Hats < Socks.
    await call(db, `public.upsert_category('hats', 'Hats', 0, true)`);
    const ordered = (await call(db, 'public.list_categories()')).map((c: Json) => c.id);
    assertEquals(ordered.slice(0, 2), ['hats', 'socks']);

    // Update by id, and inactive categories are hidden unless asked for.
    assertEquals(await call(db, `public.upsert_category('socks', 'Sox', 7, false)`), {
      id: 'socks', name: 'Sox', sort: 7, active: false,
    });
    assertEquals((await call(db, 'public.list_categories()')).some((c: Json) => c.id === 'socks'), false);
    assertEquals((await call(db, 'public.list_categories(true)')).some((c: Json) => c.id === 'socks'), true);

    // A category with products cannot be deleted. jerseys has two.
    assertEquals(await call(db, `public.delete_category('jerseys')`), { ok: false, reason: 'in_use', count: 2 });
    assertEquals((await rows(db, `select count(*)::int as n from public.categories where id = 'jerseys'`))[0].n, 1);

    assertEquals(await call(db, `public.delete_category('hats')`), { ok: true });
    assertEquals((await call(db, 'public.list_categories(true)')).some((c: Json) => c.id === 'hats'), false);
  });
});

// ---------------------------------------------------------------------------
// place_order_v2.
// ---------------------------------------------------------------------------
Deno.test('place: exact variant is decremented and the order line is built from storage', async () => {
  await withDb(async (db) => {
    const id = newId();
    const v = await findVariant(db, '1', 'L', 'Red');
    const kvBefore = await dumpKvAndOrders(db);
    const r = await placeV2(db, id, [{ productId: '1', size: 'L', color: 'Red', quantity: 2 }], { name: 'Thandi', phone: '082' });

    assertEquals(r.ok, true);
    assertEquals(r.created, true);
    assertEquals(r.order.id, id);
    assertEquals(r.order.ref, id.slice(0, 8).toUpperCase());
    assertEquals(r.order.status, 'pending');
    assertEquals(r.order.total, 500);
    assertEquals(r.order.customer, { name: 'Thandi', phone: '082' });
    assertEquals(r.order.lines, [{
      productId: '1', name: 'Classic Tee', price: 250, size: 'L', color: 'Red', quantity: 2, subtotal: 500,
      variantId: v.id, sku: v.sku,
    }]);

    assertEquals((await findVariant(db, '1', 'L', 'Red')).stock, v.stock - 2);
    assertEquals(total(await variantsOf(db, '1')), 57);
    // The old kv stock is not touched by the new function.
    const kvAfter = await dumpKvAndOrders(db);
    assertEquals(kvAfter.kv, kvBefore.kv);
  });
});

Deno.test('place: a missing size or colour picks the matching variant with the most stock', async () => {
  await withDb(async (db) => {
    const l = await findVariant(db, '1', 'L', 'Blue');
    await setStock(db, l.id, 10);

    // Colour only: the Blue variant with the most stock is L/Blue.
    const r = await placeV2(db, newId(), [{ productId: '1', color: 'Blue', quantity: 1 }]);
    assertEquals(r.ok, true);
    assertEquals(r.order.lines[0].variantId, l.id);
    assertEquals(r.order.lines[0].size, 'L');
    assertEquals(r.order.lines[0].color, 'Blue');
    assertEquals((await findVariant(db, '1', 'L', 'Blue')).stock, 9);

    // Size only.
    const xl = await findVariant(db, '1', 'XL', 'White');
    await setStock(db, xl.id, 20);
    const r2 = await placeV2(db, newId(), [{ productId: '1', size: 'XL', quantity: 3 }]);
    assertEquals(r2.order.lines[0].variantId, xl.id);
    assertEquals((await findVariant(db, '1', 'XL', 'White')).stock, 17);

    // Neither: the variant with the most stock overall (XL/White, 17), and '' / null count as missing.
    const r3 = await placeV2(db, newId(), [{ productId: '1', size: '', color: null, quantity: 1 }]);
    assertEquals(r3.order.lines[0].variantId, xl.id);
  });
});

Deno.test("place: '' and null are the same as absent, for a product with no colours", async () => {
  await withDb(async (db) => {
    for (const item of [
      { productId: '2', size: 'One Size', color: '', quantity: 1 },
      { productId: '2', size: 'One Size', color: null, quantity: 1 },
      { productId: '2', quantity: 1 },
    ]) {
      const r = await placeV2(db, newId(), [item]);
      assertEquals(r.ok, true, j(item));
      // No colour: the line has no colour key at all.
      assertEquals('color' in r.order.lines[0], false);
      assertEquals(r.order.lines[0].size, 'One Size');
    }
    assertEquals((await variantsOf(db, '2'))[0].stock, 4);
  });
});

Deno.test('place: an unknown size or colour is missing, with the product id, and changes nothing', async () => {
  await withDb(async (db) => {
    const before = await dumpCatalogue(db);
    const id = newId();
    const r = await placeV2(db, id, [
      { productId: '1', size: 'S', color: 'Red', quantity: 1 },
      { productId: '1', size: 'XXXL', quantity: 1 },
    ]);
    assertEquals(r, { ok: false, reason: 'missing', missing: ['1'] });
    // A colour a colourless product does not have.
    assertEquals(await placeV2(db, newId(), [{ productId: '2', color: 'Black', quantity: 1 }]), {
      ok: false, reason: 'missing', missing: ['2'],
    });
    assertEquals(await dumpCatalogue(db), before);
    assertEquals((await rows(db, 'select 1 from public.orders where id = $1', [id])).length, 0);
  });
});

Deno.test('place: unknown products are missing (each id once, in order of appearance)', async () => {
  await withDb(async (db) => {
    const r = await placeV2(db, newId(), [
      { productId: 'ghost', quantity: 1 },
      { productId: '2', size: 'One Size', quantity: 1 },
      { productId: 'phantom', quantity: 1 },
      { productId: 'ghost', quantity: 2 },
    ]);
    assertEquals(r, { ok: false, reason: 'missing', missing: ['ghost', 'phantom'] });
    assertEquals((await variantsOf(db, '2'))[0].stock, 7);
  });
});

Deno.test('place: a shortage on one variant is reason stock even when the product total is positive, and nothing changes', async () => {
  await withDb(async (db) => {
    const lRed = await findVariant(db, '1', 'L', 'Red');
    assertEquals(lRed.stock, 3);
    const before = await dumpCatalogue(db);
    const id = newId();

    const r = await placeV2(db, id, [
      { productId: '2', size: 'One Size', quantity: 1 }, // fine on its own
      { productId: '1', size: 'L', color: 'Red', quantity: 4 }, // only 3 on this variant (59 in total)
    ]);
    assertEquals(r, {
      ok: false,
      reason: 'stock',
      short: [{ productId: '1', name: 'Classic Tee', size: 'L', color: 'Red', requested: 4, available: 3 }],
    });
    // The fine line was not taken either, and there is no order.
    assertEquals(await dumpCatalogue(db), before);
    assertEquals((await rows(db, 'select 1 from public.orders where id = $1', [id])).length, 0);
    assert(total(await variantsOf(db, '1')) > 4);
  });
});

Deno.test('place: two lines on the same variant are counted together', async () => {
  await withDb(async (db) => {
    const v = await findVariant(db, '1', 'S', 'Black');
    assertEquals(v.stock, 3);

    // 2 + 2 = 4 > 3, though each line alone would fit.
    const r = await placeV2(db, newId(), [
      { productId: '1', size: 'S', color: 'Black', quantity: 2 },
      { productId: '1', size: 'S', color: 'Black', quantity: 2 },
    ]);
    assertEquals(r.reason, 'stock');
    assertEquals(r.short, [{ productId: '1', name: 'Classic Tee', size: 'S', color: 'Black', requested: 4, available: 3 }]);
    assertEquals((await findVariant(db, '1', 'S', 'Black')).stock, 3);

    // 1 + 2 = 3 fits exactly: two order lines, stock to zero.
    const ok = await placeV2(db, newId(), [
      { productId: '1', size: 'S', color: 'Black', quantity: 1 },
      { productId: '1', size: 'S', color: 'Black', quantity: 2 },
    ]);
    assertEquals(ok.ok, true);
    assertEquals(ok.order.lines.length, 2);
    assertEquals(ok.order.total, 750);
    assertEquals((await findVariant(db, '1', 'S', 'Black')).stock, 0);
  });
});

Deno.test('place: a replay with the same id returns the order and takes stock once', async () => {
  await withDb(async (db) => {
    const id = newId();
    const items = [{ productId: '1', size: 'M', color: 'White', quantity: 2 }];
    const first = await placeV2(db, id, items);
    const second = await placeV2(db, id, items);
    // Even a different body with the same id just returns the first order.
    const third = await placeV2(db, id, [{ productId: '2', size: 'One Size', quantity: 1 }]);

    assertEquals(first.created, true);
    assertEquals(second.created, false);
    assertEquals(third.created, false);
    assertEquals(second.order, first.order);
    assertEquals(third.order, first.order);
    assertEquals((await findVariant(db, '1', 'M', 'White')).stock, 1);
    assertEquals((await variantsOf(db, '2'))[0].stock, 7);
    assertEquals((await rows(db, 'select count(*)::int as n from public.orders where id = $1', [id]))[0].n, 1);
  });
});

Deno.test('place: names and prices come from storage, whatever the request says', async () => {
  await withDb(async (db) => {
    const r = await placeV2(db, newId(), [
      { productId: '1', size: 'M', color: 'Black', quantity: 3, price: 1, name: 'Hacked', subtotal: 3, sku: 'X', variantId: 'nope' },
    ]);
    assertEquals(r.ok, true);
    const line = r.order.lines[0];
    assertEquals(line.price, 250);
    assertEquals(line.name, 'Classic Tee');
    assertEquals(line.subtotal, 750);
    assertEquals(line.sku, 'N1-M-BLACK');
    assertEquals(r.order.total, 750);

    // Fractional prices keep their cents.
    const cap = await placeV2(db, newId(), [{ productId: '2', size: 'One Size', quantity: 3 }]);
    assertEquals(cap.order.total, 361.5);
    assertEquals(cap.order.lines[0].price, 120.5);
  });
});

Deno.test('place: an inactive product is treated as missing', async () => {
  await withDb(async (db) => {
    await updateV2(db, '1', { active: false });
    const r = await placeV2(db, newId(), [{ productId: '1', size: 'M', color: 'Black', quantity: 1 }]);
    assertEquals(r, { ok: false, reason: 'missing', missing: ['1'] });
    assertEquals(total(await variantsOf(db, '1')), 59);
    // It can be sold again once active.
    await updateV2(db, '1', { active: true });
    assertEquals((await placeV2(db, newId(), [{ productId: '1', size: 'M', color: 'Black', quantity: 1 }])).ok, true);
  });
});

// ---------------------------------------------------------------------------
// cancel_order_v2.
// ---------------------------------------------------------------------------
Deno.test('cancel: stock goes back to the right variant; a second cancel does not restore twice', async () => {
  await withDb(async (db) => {
    const id = newId();
    const a = await findVariant(db, '1', 'L', 'Red');
    const b = await findVariant(db, '1', 'XL', 'Blue');
    const placed = await placeV2(db, id, [
      { productId: '1', size: 'L', color: 'Red', quantity: 2 },
      { productId: '1', size: 'XL', color: 'Blue', quantity: 1 },
      { productId: '1', size: 'L', color: 'Red', quantity: 1 },
    ]);
    assertEquals(placed.ok, true);
    assertEquals((await findVariant(db, '1', 'L', 'Red')).stock, a.stock - 3);
    assertEquals((await findVariant(db, '1', 'XL', 'Blue')).stock, b.stock - 1);

    const cancelled = await cancelV2(db, id);
    assertEquals(cancelled.status, 'cancelled');
    assertEquals(cancelled.id, id);
    assertEquals((await findVariant(db, '1', 'L', 'Red')).stock, a.stock);
    assertEquals((await findVariant(db, '1', 'XL', 'Blue')).stock, b.stock);
    assertEquals(total(await variantsOf(db, '1')), 59);

    const again = await cancelV2(db, id);
    assertEquals(again.status, 'cancelled');
    assertEquals(total(await variantsOf(db, '1')), 59);
    assertEquals((await findVariant(db, '1', 'L', 'Red')).stock, a.stock);

    assertEquals(await cancelV2(db, newId()), null);
  });
});

Deno.test('cancel: an old line without variantId goes to its exact variant, or to the first variant', async () => {
  await withDb(async (db) => {
    const m = await findVariant(db, '1', 'M', 'Red');
    const first = await findVariant(db, '1', 'S', 'Black');
    const kvBefore = (await dumpKvAndOrders(db)).kv;

    // Line 1: M / Red x2 (exact). Line 2: size XXS does not exist, so the first variant (S / Black) x1.
    const r = await cancelV2(db, OLD_ORDER_ID);
    assertEquals(r.status, 'cancelled');
    assertEquals((await findVariant(db, '1', 'M', 'Red')).stock, m.stock + 2);
    assertEquals((await findVariant(db, '1', 'S', 'Black')).stock, first.stock + 1);
    assertEquals(total(await variantsOf(db, '1')), 62);
    assertEquals((await dumpKvAndOrders(db)).kv, kvBefore);

    await cancelV2(db, OLD_ORDER_ID);
    assertEquals(total(await variantsOf(db, '1')), 62);
  });
});

Deno.test('cancel: a line whose product was deleted is skipped', async () => {
  await withDb(async (db) => {
    // A deleted product.
    const id1 = newId();
    await placeV2(db, id1, [
      { productId: '1', size: 'M', color: 'Black', quantity: 1 },
      { productId: '2', size: 'One Size', quantity: 2 },
    ]);
    assertEquals(await call(db, `public.delete_product('2')`), true);
    const c1 = await cancelV2(db, id1);
    assertEquals(c1.status, 'cancelled');
    assertEquals(total(await variantsOf(db, '1')), 59);
  });
});

Deno.test('cancel: a line whose variant was deleted falls back to the exact size and colour, else the first variant', async () => {
  await withDb(async (db) => {
    // Product 3 has sizes M, L and colour Green. Drop size L, so L / Green is gone.
    const id1 = newId();
    assertEquals((await placeV2(db, id1, [{ productId: '3', size: 'L', color: 'Green', quantity: 2 }])).ok, true);
    assertEquals((await updateV2(db, '3', { sizes: ['M'] })).ok, true);
    const first = await findVariant(db, '3', 'M', 'Green');
    const totalBefore = total(await variantsOf(db, '3'));
    assertEquals((await cancelV2(db, id1)).status, 'cancelled');
    // Not lost: it went to the product's first (here only) variant.
    assertEquals(total(await variantsOf(db, '3')), totalBefore + 2);
    assertEquals((await findVariant(db, '3', 'M', 'Green')).stock, first.stock + 2);

    // The stored variantId is gone, but the line's size and colour still match another variant exactly.
    const id2 = newId();
    const sOld = await findVariant(db, '1', 'M', 'Blue');
    await db.query(
      `insert into public.orders (id, ref, status, lines, total, customer) values ($1, 'FALLBACK', 'pending', $2::jsonb, 0, $3::jsonb)`,
      [
        id2,
        j([{ productId: '1', name: 'Classic Tee', price: 250, size: 'M', color: 'Blue', quantity: 3, subtotal: 750, variantId: newId() }]),
        j({ name: 'Test', phone: '0' }),
      ],
    );
    assertEquals((await cancelV2(db, id2)).status, 'cancelled');
    assertEquals((await findVariant(db, '1', 'M', 'Blue')).stock, sOld.stock + 3);

    // Same, with no matching size either: the product's first variant (S / Black).
    const id3 = newId();
    const firstTee = await findVariant(db, '1', 'S', 'Black');
    await db.query(
      `insert into public.orders (id, ref, status, lines, total, customer) values ($1, 'FALLBAC2', 'pending', $2::jsonb, 0, $3::jsonb)`,
      [
        id3,
        j([{ productId: '1', name: 'Classic Tee', price: 250, size: 'XXS', color: 'Pink', quantity: 4, subtotal: 1000, variantId: newId() }]),
        j({ name: 'Test', phone: '0' }),
      ],
    );
    assertEquals((await cancelV2(db, id3)).status, 'cancelled');
    assertEquals((await findVariant(db, '1', 'S', 'Black')).stock, firstTee.stock + 4);

    // A line whose product is gone is skipped.
    const id4 = newId();
    assertEquals((await placeV2(db, id4, [{ productId: '4', quantity: 1 }])).ok, true);
    assertEquals(await call(db, `public.delete_product('4')`), true);
    assertEquals((await cancelV2(db, id4)).status, 'cancelled');
  });
});

// ---------------------------------------------------------------------------
// update_product_v2.
// ---------------------------------------------------------------------------
Deno.test('update: total-only increase is spread evenly from the first variant', async () => {
  await withDb(async (db) => {
    const before = stocks(await variantsOf(db, '1'));
    const r = await updateV2(db, '1', { stock: 70 });
    assertEquals(r.ok, true);
    assertEquals(r.product.stock, 70);
    // +11 over 20 variants: nothing each, one extra unit for the first 11.
    assertEquals(stocks(await variantsOf(db, '1')), before.map((s, i) => s + (i < 11 ? 1 : 0)));

    // +45 over 20: 2 each, and 5 extra for the first five.
    await updateV2(db, '1', { stock: 115 });
    assertEquals(total(await variantsOf(db, '1')), 115);
    assertEquals(
      stocks(await variantsOf(db, '1')),
      before.map((s, i) => s + (i < 11 ? 1 : 0) + 2 + (i < 5 ? 1 : 0)),
    );
  });
});

Deno.test('update: total-only decrease is taken from the variants with the most stock', async () => {
  await withDb(async (db) => {
    // 59 -> 50: nine of the 3-unit variants lose one, in size/colour order.
    const r = await updateV2(db, '1', { stock: 50 });
    assertEquals(r.product.stock, 50);
    const after = stocks(await variantsOf(db, '1'));
    assertEquals(after, [...Array(9).fill(2), ...Array(10).fill(3), 2]);

    // Uneven stock: S/Black 10, M/Black 5, everything else 0. Take 8: levelled
    // down to 4/4 (7 units) and the last unit comes off the first variant.
    const vs = await variantsOf(db, '1');
    for (const v of vs) await setStock(db, v.id, 0);
    await setStock(db, vs[0].id, 10);
    await setStock(db, vs[4].id, 5);
    const r2 = await updateV2(db, '1', { stock: 7 });
    assertEquals(r2.product.stock, 7);
    const s = stocks(await variantsOf(db, '1'));
    assertEquals(s[0], 3);
    assertEquals(s[4], 4);
    assertEquals(total(await variantsOf(db, '1')), 7);

    // Down to zero, never negative.
    const r3 = await updateV2(db, '1', { stock: 0 });
    assertEquals(r3.product.stock, 0);
    assert(stocks(await variantsOf(db, '1')).every((n) => n === 0));
  });
});

Deno.test('update: a stale expected stock returns stock_changed with the current numbers and writes nothing', async () => {
  await withDb(async (db) => {
    const before = await dumpCatalogue(db);
    const r = await updateV2(db, '1', { stock: 70, name: 'Should Not Apply', price: 1 }, 10);
    assertEquals(r.ok, false);
    assertEquals(r.reason, 'stock_changed');
    assertEquals(r.stock, 59);
    assertEquals(r.variants.length, 20);
    assertEquals(Object.keys(r.variants[0]).sort(), ['id', 'stock']);
    assertEquals(r.variants.map((v: Variant) => v.stock), stocks(await variantsOf(db, '1')));
    assertEquals(await dumpCatalogue(db), before);

    // The right expected stock goes through.
    const ok = await updateV2(db, '1', { stock: 70, name: 'Applied' }, 59);
    assertEquals(ok.ok, true);
    assertEquals(ok.product.stock, 70);
    assertEquals(ok.product.name, 'Applied');

    // expectedStock is only checked when the patch sets stock.
    const noStock = await updateV2(db, '1', { name: 'Again' }, 1);
    assertEquals(noStock.ok, true);
    assertEquals(noStock.product.stock, 70);
  });
});

Deno.test('update: p_variants sets each variant stock, with matching expectedStock', async () => {
  await withDb(async (db) => {
    const [a, b, c] = await variantsOf(db, '1');
    const r = await updateV2(
      db, '1', { price: 300, stock: 9999 }, null,
      [
        { id: a.id, stock: 7, expectedStock: a.stock },
        { id: b.id, stock: 0 },
        { id: c.id, stock: 12, expectedStock: c.stock },
      ],
    );
    assertEquals(r.ok, true);
    assertEquals(r.product.price, 300);
    const after = await variantsOf(db, '1');
    assertEquals(after.slice(0, 3).map((v) => v.stock), [7, 0, 12]);
    // The 'stock' total in the patch is ignored when variants are given.
    assertEquals(total(after), 59 - a.stock - b.stock - c.stock + 7 + 0 + 12);
    assertEquals(r.product.stock, total(after));
    assertEquals(r.product.variants.slice(0, 3).map((v: Variant) => v.stock), [7, 0, 12]);
  });
});

Deno.test('update: a stale expectedStock on any variant writes nothing at all', async () => {
  await withDb(async (db) => {
    const [a, b] = await variantsOf(db, '1');
    const before = await dumpCatalogue(db);

    const r = await updateV2(
      db, '1', { name: 'Not Applied', price: 1, sizes: ['S'], active: false, category: 'pants' }, null,
      [
        { id: a.id, stock: 9, expectedStock: a.stock }, // right
        { id: b.id, stock: 9, expectedStock: b.stock + 5 }, // stale
      ],
    );
    assertEquals(r.ok, false);
    assertEquals(r.reason, 'stock_changed');
    assertEquals(r.stock, 59);
    assertEquals(r.variants.length, 20);
    assertEquals(await dumpCatalogue(db), before);

    // A variant that no longer exists counts as stale too.
    const r2 = await updateV2(db, '1', { name: 'Not Applied' }, null, [{ id: newId(), stock: 1, expectedStock: 0 }]);
    assertEquals(r2.reason, 'stock_changed');
    assertEquals(await dumpCatalogue(db), before);
  });
});

Deno.test('update: dropping a size removes its variants and keeps the total', async () => {
  await withDb(async (db) => {
    const before = await variantsOf(db, '1');
    const r = await updateV2(db, '1', { sizes: ['S', 'M', 'L'] });
    assertEquals(r.ok, true);
    const after = await variantsOf(db, '1');
    assertEquals(after.length, 12);
    assertEquals(r.product.variants.length, 12);
    assertEquals(total(after), 59);
    assertEquals(r.product.stock, 59);
    assertEquals(r.product.sizes, ['S', 'M', 'L']);
    // The 8 removed variants held 23 units; 23 over 12 is 1 each plus 11 extra
    // for the first 11. They were 3 each before.
    assertEquals(stocks(after), [...Array(11).fill(3 + 2), 3 + 1]);
    // Surviving variants keep their ids and SKUs.
    assertEquals(after.map((v) => v.id), before.slice(0, 12).map((v) => v.id));
    assertEquals(after.map((v) => v.sku), before.slice(0, 12).map((v) => v.sku));
  });
});

Deno.test('update: adding a colour adds zero-stock variants and keeps the total', async () => {
  await withDb(async (db) => {
    const before = stocks(await variantsOf(db, '1'));
    const r = await updateV2(db, '1', { colors: [...TEE_COLORS, 'Green'] });
    assertEquals(r.ok, true);
    const after = await variantsOf(db, '1');
    assertEquals(after.length, 25);
    assertEquals(total(after), 59);
    const green = after.filter((v) => v.color === 'Green');
    assertEquals(green.length, 5);
    assert(green.every((v) => v.stock === 0));
    assertEquals(after.filter((v) => v.color !== 'Green').map((v) => v.stock), before);
    assertEquals(green.map((v) => v.sku), TEE_SIZES.map((s) => `N1-${s}-GREEN`));
    assertEquals(r.product.variants.length, 25);
  });
});

Deno.test('update: going from sizes to no sizes (and back) preserves the total', async () => {
  await withDb(async (db) => {
    const r = await updateV2(db, '3', { sizes: [], colors: [] }); // M,L x Green: 5 units
    assertEquals(r.ok, true);
    const vs = await variantsOf(db, '3');
    assertEquals(vs.map((v) => [v.size, v.color, v.stock]), [['', '', 5]]);

    const back = await updateV2(db, '3', { sizes: ['M', 'L'], colors: ['Green'] });
    assertEquals(back.ok, true);
    assertEquals(stocks(await variantsOf(db, '3')), [3, 2]);
  });
});

Deno.test('update: unknown category and unknown product', async () => {
  await withDb(async (db) => {
    const before = await dumpCatalogue(db);
    assertEquals(await updateV2(db, '1', { category: 'nope', name: 'X', stock: 5 }), {
      ok: false, reason: 'unknown_category',
    });
    assertEquals(await dumpCatalogue(db), before);
    assertEquals(await updateV2(db, 'ghost', { name: 'X' }), { ok: false, reason: 'not_found' });

    const ok = await updateV2(db, '1', { category: 'pants' });
    assertEquals(ok.product.category, 'pants');
  });
});

Deno.test('update: merges fields, ignores id and createdAt, keeps the slug and stock', async () => {
  await withDb(async (db) => {
    const before = await call(db, `public.get_product('1')`);
    const r = await updateV2(db, '1', {
      id: 'hacked', createdAt: '2000-01-01T00:00:00Z', image: 'ignored', name: 'New Name', price: 199.5,
      description: 'New text', images: ['', 'a.png', 'b.png'], active: false,
    });
    assertEquals(r.ok, true);
    const p = r.product;
    assertEquals(p.id, '1');
    assertEquals(p.createdAt, before.createdAt);
    assertEquals(p.slug, 'classic-tee');
    assertEquals(p.name, 'New Name');
    assertEquals(p.price, 199.5);
    assertEquals(p.description, 'New text');
    assertEquals(p.images, ['', 'a.png', 'b.png']);
    assertEquals(p.image, 'a.png');
    assertEquals(p.active, false);
    assertEquals(p.stock, 59);
    assertEquals(p.sizes, before.sizes);
    assertEquals(p.variants, before.variants);
    assertEquals((await rows(db, `select count(*)::int as n from public.products where id = 'hacked'`))[0].n, 0);
  });
});

// ---------------------------------------------------------------------------
// create_product and delete_product.
// ---------------------------------------------------------------------------
Deno.test('create_product: stock is split over every size x colour, remainder first', async () => {
  await withDb(async (db) => {
    const r = await createProduct(db, 'new-1', {
      name: 'Home Jersey', category: 'jerseys', price: 500, description: 'd', images: ['i.png'],
      sizes: ['S', 'M'], colors: ['Red', 'Blue'], stock: 10,
    });
    assertEquals(r.ok, true);
    assertEquals(r.product.id, 'new-1');
    assertEquals(r.product.slug, 'home-jersey-3'); // -1 and -2 are taken by the copied products
    assertEquals(r.product.stock, 10);
    assertEquals(r.product.image, 'i.png');
    assertEquals(r.product.variants.map((v: Variant) => [v.size, v.color, v.stock]), [
      ['S', 'Red', 3], ['S', 'Blue', 3], ['M', 'Red', 2], ['M', 'Blue', 2],
    ]);
    assertEquals(r.product.variants[0].sku, 'NNEW1-S-RED');
    assertEquals((await call(db, `public.get_product('new-1')`)).stock, 10);
  });
});

Deno.test('create_product: given variants set their stock, the rest are zero', async () => {
  await withDb(async (db) => {
    const r = await createProduct(db, 'new-2', {
      name: 'Fresh Tee', category: 'tshirts', price: 10, description: '', images: [],
      sizes: ['S', 'M'], colors: ['Red', 'Blue'], stock: 100,
      variants: [{ size: 'S', color: 'Red', stock: 4 }, { size: 'M', color: 'Blue', stock: 1 }, { size: 'XL', color: 'Red', stock: 50 }],
    });
    assertEquals(r.ok, true);
    assertEquals(r.product.variants.map((v: Variant) => v.stock), [4, 0, 0, 1]);
    assertEquals(r.product.stock, 5); // the unknown XL combination and the total are ignored
    assertEquals(r.product.variants.length, 4);
  });
});

Deno.test('create_product: no sizes or colours gives one variant; stock defaults to 0', async () => {
  await withDb(async (db) => {
    const a = await createProduct(db, 'new-3', {
      name: 'Plain', category: 'accessories', price: 5, description: '', images: [], sizes: [], colors: [], stock: 8,
    });
    assertEquals(a.product.variants.map((v: Variant) => [v.size, v.color, v.stock]), [['', '', 8]]);
    const b = await createProduct(db, 'new-4', { name: 'Zero', category: 'accessories', price: 5, sizes: ['M'] });
    assertEquals(b.ok, true);
    assertEquals(b.product.stock, 0);
    assertEquals(b.product.description, '');
    assertEquals(b.product.images, []);
  });
});

Deno.test('create_product: an unknown category is refused and nothing is created', async () => {
  await withDb(async (db) => {
    const before = await dumpCatalogue(db);
    const r = await createProduct(db, 'new-5', {
      name: 'X', category: 'nope', price: 5, description: '', images: [], sizes: ['M'], colors: [], stock: 3,
    });
    assertEquals(r, { ok: false, reason: 'unknown_category' });
    assertEquals(await dumpCatalogue(db), before);
  });
});

Deno.test('delete_product: removes the product and variants, orders keep their lines', async () => {
  await withDb(async (db) => {
    const id = newId();
    const placed = await placeV2(db, id, [{ productId: '1', size: 'M', color: 'Black', quantity: 1 }]);
    assertEquals(await call(db, `public.delete_product('1')`), true);
    assertEquals(await call(db, `public.get_product('1')`), null);
    assertEquals((await rows(db, `select count(*)::int as n from public.product_variants where product_id = '1'`))[0].n, 0);
    const order = (await rows(db, 'select lines from public.orders where id = $1', [id]))[0];
    assertEquals(order.lines, placed.order.lines);
    // The old order from the live shape is also still there.
    assertEquals((await rows(db, 'select 1 from public.orders where id = $1', [OLD_ORDER_ID])).length, 1);

    assertEquals(await call(db, `public.delete_product('1')`), false);
    assertEquals(await call(db, `public.delete_product('ghost')`), false);
    // The category it used is free once its last product is gone.
    assertEquals(await call(db, `public.delete_category('tshirts')`), { ok: true });
  });
});

// ---------------------------------------------------------------------------
// Close the shared databases once everything else has run.
// ---------------------------------------------------------------------------
Deno.test('teardown', async () => {
  if (postDb) await (await postDb).close();
  if (preDb) await (await preDb).close();
});
