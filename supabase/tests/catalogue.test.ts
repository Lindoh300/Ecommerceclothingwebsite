// Tests for supabase/migrations/20261030000000_catalogue.sql and the later
// migrations in LATER_MIGRATIONS, run against an
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
// Applied after NEW_MIGRATION, in order. Later sections append here. The pg_cron
// migration (20261030140000_order_expiry_cron.sql) is never in this list: PGlite has no pg_cron.
const LATER_MIGRATIONS = [
  '20261030100000_order_lifecycle.sql',
  '20261030110000_delivery.sql',
  '20261030120000_payments.sql',
  '20261030130000_place_order_v3.sql',
  '20261031100000_order_fulfilment.sql',
  '20261031110000_payment_links.sql',
];

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
let catalogueDb: Promise<Db> | undefined;
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

/** `pre` plus the catalogue migration only. */
function catalogueOnly(): Promise<Db> {
  catalogueDb ??= (async () => {
    const db = await (await pre()).clone();
    await db.exec(await readMigration(NEW_MIGRATION));
    return db;
  })();
  return catalogueDb;
}

/** `pre` plus the catalogue migration and then LATER_MIGRATIONS, each applied once. */
function post(): Promise<Db> {
  postDb ??= (async () => {
    const db = await (await catalogueOnly()).clone();
    for (const f of LATER_MIGRATIONS) await db.exec(await readMigration(f));
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
  // The catalogue migration alone: later migrations do change orders and order_json.
  const before = await pre();
  const after = await catalogueOnly();
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
// 20261030100000_order_lifecycle.sql: order columns, order_json, set_order_status.
// ---------------------------------------------------------------------------
const STATUSES = [
  'pending', 'awaiting_payment', 'paid', 'packed', 'shipped', 'delivered', 'expired', 'cancelled', 'refunded',
];
// Written out here, not derived from the migration, so the test checks the table.
const ALLOWED: [string, string][] = [
  ['pending', 'paid'], ['pending', 'cancelled'],
  ['awaiting_payment', 'paid'], ['awaiting_payment', 'cancelled'], ['awaiting_payment', 'expired'],
  ['paid', 'packed'], ['paid', 'refunded'],
  ['packed', 'shipped'], ['packed', 'refunded'],
  ['shipped', 'delivered'], ['shipped', 'refunded'],
  ['delivered', 'refunded'],
  ['expired', 'refunded'],
];
const isAllowed = (from: string, to: string) => ALLOWED.some(([f, t]) => f === from && t === to);
const DUE = '2030-01-01T00:00:00+00';

const setStatus = (db: Db, id: string, status: string, from: string | null = null) =>
  call(db, 'public.set_order_status($1::uuid, $2, $3)', id, status, from);

/** Insert an order straight into the table (so any status can be reached). Lines: 2 x Classic Tee M / Red. */
async function insertOrder(db: Db, status: string, extra: Record<string, unknown> = {}): Promise<string> {
  const id = newId();
  const cols: Record<string, unknown> = {
    id,
    ref: 'LIFECYCL',
    status,
    lines: j([{ productId: '1', name: 'Classic Tee', price: 250, size: 'M', color: 'Red', quantity: 2, subtotal: 500 }]),
    total: 500,
    customer: j({ name: 'Test', phone: '0' }),
    ...extra,
  };
  const names = Object.keys(cols);
  await db.query(
    `insert into public.orders (${names.join(', ')}) values (${names.map((n, i) => (['lines', 'customer', 'delivery_address'].includes(n) ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')})`,
    names.map((n) => cols[n]),
  );
  return id;
}

const orderRow = async (db: Db, id: string): Promise<Json> =>
  (await rows(db, 'select * from public.orders where id = $1', [id]))[0];

Deno.test('lifecycle columns: all exist with the right types, defaults and checks', async () => {
  await withDb(async (db) => {
    const cols = await rows(
      db,
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'orders' order by column_name`,
    );
    const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    const expected: Record<string, string> = {
      expires_at: 'timestamp with time zone', delivery_method: 'text', delivery_address: 'jsonb',
      delivery_locker: 'text', delivery_fee: 'numeric', payment_method: 'text', payment_reference: 'text',
      payment_url: 'text', paid_at: 'timestamp with time zone', payment_flag: 'text', tracking_courier: 'text',
      tracking_number: 'text', tracking_url: 'text',
    };
    for (const [name, type] of Object.entries(expected)) {
      assert(by[name], `column ${name}`);
      assertEquals(by[name].data_type, type, name);
      assertEquals(by[name].is_nullable, name === 'delivery_fee' ? 'NO' : 'YES', name);
    }
    assertEquals(by.delivery_fee.column_default, '0');
    // The old columns are still there.
    for (const name of ['id', 'ref', 'created_at', 'status', 'lines', 'total', 'customer']) assert(by[name], name);

    const fee = (await rows(
      db,
      `select numeric_precision, numeric_scale from information_schema.columns
       where table_name = 'orders' and column_name = 'delivery_fee'`,
    ))[0];
    assertEquals([fee.numeric_precision, fee.numeric_scale], [12, 2]);
  });
});

Deno.test('lifecycle columns: existing orders keep a NULL expires_at and a zero delivery fee', async () => {
  await withDb(async (db) => {
    const old = await orderRow(db, OLD_ORDER_ID);
    assertEquals(old.status, 'pending');
    assertEquals(old.expires_at, null);
    assertEquals(Number(old.delivery_fee), 0);
    for (const c of [
      'delivery_method', 'delivery_address', 'delivery_locker', 'payment_method', 'payment_reference',
      'payment_url', 'paid_at', 'payment_flag', 'tracking_courier', 'tracking_number', 'tracking_url',
    ]) assertEquals(old[c], null, c);
    // The old lines and customer are untouched.
    assertEquals(old.lines, oldOrderLines);
    assertEquals(Number(old.total), 750);
    // An order placed by the old functions gets the same empty columns.
    const id = newId();
    assertEquals((await placeV2(db, id, [{ productId: '2', size: 'One Size', quantity: 1 }])).ok, true);
    const fresh = await orderRow(db, id);
    assertEquals(fresh.expires_at, null);
    assertEquals(Number(fresh.delivery_fee), 0);
    assertEquals(fresh.status, 'pending');
  });
});

Deno.test('lifecycle columns: the status check allows exactly the nine statuses, and the other checks hold', async () => {
  await withDb(async (db) => {
    for (const status of STATUSES) await insertOrder(db, status);
    await assertRejects(() => insertOrder(db, 'bogus'), Error, 'orders_status_check');
    await assertRejects(() => insertOrder(db, 'pending', { payment_method: 'cash' }), Error, 'payment_method');
    await assertRejects(() => insertOrder(db, 'pending', { payment_flag: 'weird' }), Error, 'payment_flag');
    await insertOrder(db, 'pending', { payment_method: 'whatsapp' });
    await insertOrder(db, 'pending', { payment_method: 'online', payment_flag: 'amount_mismatch' });
    await insertOrder(db, 'pending', { payment_flag: 'refund_due' });
    await assertRejects(() => insertOrder(db, 'pending', { delivery_fee: null }), Error, 'null value');
  });
});

Deno.test('lifecycle columns: payment_reference is unique when set, NULL repeats freely; the expiry index is partial', async () => {
  await withDb(async (db) => {
    await insertOrder(db, 'pending');
    await insertOrder(db, 'pending');
    await insertOrder(db, 'awaiting_payment', { payment_reference: 'REF-1' });
    await assertRejects(() => insertOrder(db, 'awaiting_payment', { payment_reference: 'REF-1' }), Error, 'duplicate key');
    await insertOrder(db, 'awaiting_payment', { payment_reference: 'REF-2' });

    const idx = await rows(
      db,
      `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'orders'
       and indexname in ('orders_payment_reference_key', 'orders_expires_at_idx') order by indexname`,
    );
    assertEquals(idx.length, 2);
    const def = (name: string) => idx.find((i) => i.indexname === name).indexdef as string;
    assert(def('orders_payment_reference_key').includes('UNIQUE'));
    assert(def('orders_payment_reference_key').includes('payment_reference IS NOT NULL'));
    assert(def('orders_expires_at_idx').includes('expires_at IS NOT NULL'));
    assert(def('orders_expires_at_idx').includes('pending'));
    assert(def('orders_expires_at_idx').includes('awaiting_payment'));
  });
});

Deno.test('order_json: every old key is kept and the new ones are null when empty', async () => {
  await withDb(async (db) => {
    const o = await call(db, `public.order_json((select o from public.orders o where o.id = $1))`, OLD_ORDER_ID);
    assertEquals(Object.keys(o).sort(), [
      'createdAt', 'customer', 'delivery', 'deliveryFee', 'expiresAt', 'id', 'lines', 'paidAt', 'paymentFlag',
      'paymentMethod', 'ref', 'status', 'total', 'tracking',
    ]);
    assertEquals(o.id, OLD_ORDER_ID);
    assertEquals(o.ref, 'ABCD1234');
    assertEquals(o.status, 'pending');
    assertEquals(o.lines, oldOrderLines);
    assertEquals(o.total, 750);
    assertEquals(o.customer, { name: 'Old Customer', phone: '0820000000' });
    assertEquals(typeof o.createdAt, 'string');
    assertEquals(o.deliveryFee, 0);
    for (const k of ['delivery', 'paymentMethod', 'paymentFlag', 'paidAt', 'expiresAt', 'tracking']) {
      assertEquals(o[k], null, k);
      assert(k in o, k);
    }
  });
});

Deno.test('order_json: delivery, payment, expiry and tracking; payment_url and payment_reference are never exposed', async () => {
  await withDb(async (db) => {
    const id = await insertOrder(db, 'awaiting_payment', {
      total: 560,
      delivery_method: 'courier',
      delivery_address: j({ street: '1 Long St', city: 'Cape Town', note: null }),
      delivery_locker: 'LOCKER-9',
      delivery_fee: 60,
      payment_method: 'online',
      payment_reference: 'SECRET-REF',
      payment_url: 'https://pay.test/secret',
      payment_flag: 'refund_due',
      paid_at: '2026-10-30T10:00:00+00',
      expires_at: DUE,
      tracking_courier: 'Courier Guy',
      tracking_number: 'TCG123',
      tracking_url: 'https://track.test/TCG123',
    });
    const o = await call(db, `public.order_json((select o from public.orders o where o.id = $1))`, id);
    assertEquals(o.total, 560);
    assertEquals(o.deliveryFee, 60);
    assertEquals(o.delivery, {
      method: 'courier',
      address: { street: '1 Long St', city: 'Cape Town', note: null },
      locker: 'LOCKER-9',
      fee: 60,
    });
    assertEquals(o.paymentMethod, 'online');
    assertEquals(o.paymentFlag, 'refund_due');
    assertEquals(new Date(o.paidAt).toISOString(), '2026-10-30T10:00:00.000Z');
    assertEquals(new Date(o.expiresAt).toISOString(), '2030-01-01T00:00:00.000Z');
    assertEquals(o.tracking, { courier: 'Courier Guy', number: 'TCG123', url: 'https://track.test/TCG123' });
    const text = JSON.stringify(o);
    for (const secret of ['SECRET-REF', 'pay.test', 'payment_url', 'payment_reference', 'paymentUrl', 'paymentReference']) {
      assertEquals(text.includes(secret), false, secret);
    }

    // A null address and locker are left out of delivery; a partly filled tracking keeps nulls.
    const id2 = await insertOrder(db, 'pending', { delivery_method: 'collect', tracking_number: 'ONLY-NUMBER' });
    const o2 = await call(db, `public.order_json((select o from public.orders o where o.id = $1))`, id2);
    assertEquals(o2.delivery, { method: 'collect', fee: 0 });
    assertEquals(o2.tracking, { courier: null, number: 'ONLY-NUMBER', url: null });
  });
});

Deno.test('set_order_status: every allowed transition works and every other pair is refused', async () => {
  await withDb(async (db) => {
    const tee = await findVariant(db, '1', 'M', 'Red');
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const label = `${from} -> ${to}`;
        await setStock(db, tee.id, 20);
        const id = await insertOrder(db, from, { expires_at: DUE });
        const r = await setStatus(db, id, to);
        const row = await orderRow(db, id);
        const stock = (await findVariant(db, '1', 'M', 'Red')).stock;
        if (from === to) {
          assertEquals([r.ok, r.changed], [true, false], label);
          assertEquals(r.order.status, from, label);
          assertEquals(stock, 20, label);
          assertEquals(row.expires_at !== null, true, label);
        } else if (isAllowed(from, to)) {
          assertEquals([r.ok, r.changed], [true, true], label);
          assertEquals(r.order.status, to, label);
          assertEquals(row.status, to, label);
          assertEquals(r.order.id, id, label);
          assertEquals(stock, to === 'cancelled' || to === 'expired' ? 22 : 20, label);
          assertEquals(row.paid_at !== null, to === 'paid', label);
          const cleared = ['paid', 'packed', 'shipped', 'delivered', 'refunded'].includes(to);
          assertEquals(row.expires_at === null, cleared, label);
          assertEquals(r.order.expiresAt === null, cleared, label);
        } else {
          assertEquals(r.ok, false, label);
          assertEquals(r.reason, 'bad_transition', label);
          assertEquals([r.from, r.to], [from, to], label);
          assertEquals(r.order.status, from, label);
          assertEquals(row.status, from, label);
          assertEquals(row.expires_at !== null, true, label);
          assertEquals(row.paid_at, null, label);
          assertEquals(stock, 20, label);
        }
      }
    }
  });
});

Deno.test('set_order_status: unknown order, unknown or null status, and the shape of each result', async () => {
  await withDb(async (db) => {
    assertEquals(await setStatus(db, newId(), 'paid'), { ok: false, reason: 'not_found' });
    const id = await insertOrder(db, 'pending');
    const bogus = await setStatus(db, id, 'bogus');
    assertEquals([bogus.ok, bogus.reason, bogus.from, bogus.to], [false, 'bad_transition', 'pending', 'bogus']);
    const nul = await call(db, 'public.set_order_status($1::uuid, null)', id);
    assertEquals([nul.ok, nul.reason], [false, 'bad_transition']);
    assertEquals((await orderRow(db, id)).status, 'pending');

    const ok = await setStatus(db, id, 'paid');
    assertEquals(Object.keys(ok).sort(), ['changed', 'ok', 'order']);
    assertEquals(Object.keys(ok.order).sort(), Object.keys(await call(db, `public.order_json((select o from public.orders o where o.id = $1))`, id)).sort());
    const bad = await setStatus(db, id, 'pending');
    assertEquals(Object.keys(bad).sort(), ['from', 'ok', 'order', 'reason', 'to']);
  });
});

Deno.test('set_order_status: p_from must equal the current status', async () => {
  await withDb(async (db) => {
    const id = await insertOrder(db, 'awaiting_payment');
    const wrong = await setStatus(db, id, 'paid', 'pending');
    assertEquals([wrong.ok, wrong.reason, wrong.from, wrong.to], [false, 'bad_transition', 'awaiting_payment', 'paid']);
    assertEquals((await orderRow(db, id)).status, 'awaiting_payment');
    assertEquals((await orderRow(db, id)).paid_at, null);

    // Same status requested but p_from is something else: refused too.
    const sameWrong = await setStatus(db, id, 'awaiting_payment', 'pending');
    assertEquals([sameWrong.ok, sameWrong.reason], [false, 'bad_transition']);
    // Same status and matching p_from: a no-op.
    const same = await setStatus(db, id, 'awaiting_payment', 'awaiting_payment');
    assertEquals([same.ok, same.changed], [true, false]);

    const ok = await setStatus(db, id, 'paid', 'awaiting_payment');
    assertEquals([ok.ok, ok.changed, ok.order.status], [true, true, 'paid']);
    // The same guarded call again: the status has moved on.
    const replay = await setStatus(db, id, 'paid', 'awaiting_payment');
    assertEquals([replay.ok, replay.reason], [false, 'bad_transition']);
  });
});

Deno.test('set_order_status: cancelled and expired return stock exactly once; a second call does nothing', async () => {
  await withDb(async (db) => {
    const a = await findVariant(db, '1', 'L', 'Red');
    const b = await findVariant(db, '1', 'XL', 'Blue');
    const place = async () => {
      const id = newId();
      const r = await placeV2(db, id, [
        { productId: '1', size: 'L', color: 'Red', quantity: 2 },
        { productId: '1', size: 'XL', color: 'Blue', quantity: 1 },
      ]);
      assertEquals(r.ok, true);
      return id;
    };
    const stocksNow = async () => [(await findVariant(db, '1', 'L', 'Red')).stock, (await findVariant(db, '1', 'XL', 'Blue')).stock];

    const cancelId = await place();
    assertEquals(await stocksNow(), [a.stock - 2, b.stock - 1]);
    assertEquals((await setStatus(db, cancelId, 'cancelled')).changed, true);
    assertEquals(await stocksNow(), [a.stock, b.stock]);
    assertEquals((await setStatus(db, cancelId, 'cancelled')).changed, false);
    assertEquals((await cancelV2(db, cancelId)).status, 'cancelled');
    assertEquals(await stocksNow(), [a.stock, b.stock]);
    // Cancelled cannot become expired, so stock cannot come back a second time that way.
    assertEquals((await setStatus(db, cancelId, 'expired')).reason, 'bad_transition');
    assertEquals(await stocksNow(), [a.stock, b.stock]);

    const expireId = await place();
    await db.query(`update public.orders set status = 'awaiting_payment', expires_at = $2 where id = $1`, [expireId, DUE]);
    assertEquals(await stocksNow(), [a.stock - 2, b.stock - 1]);
    const ex = await setStatus(db, expireId, 'expired');
    assertEquals([ex.ok, ex.changed, ex.order.status], [true, true, 'expired']);
    assertEquals(await stocksNow(), [a.stock, b.stock]);
    assertEquals((await setStatus(db, expireId, 'expired')).changed, false);
    assertEquals(await stocksNow(), [a.stock, b.stock]);
    // expired -> refunded does not return it again either.
    assertEquals((await setStatus(db, expireId, 'refunded')).changed, true);
    assertEquals(await stocksNow(), [a.stock, b.stock]);
    // expires_at stays on expired and is cleared on the refund.
    const ordersRow = await orderRow(db, expireId);
    assertEquals(ordersRow.expires_at, null);
  });
});

Deno.test('set_order_status: expires_at is kept on cancelled and expired, paid_at is set once', async () => {
  await withDb(async (db) => {
    const c = await insertOrder(db, 'pending', { expires_at: DUE });
    await setStatus(db, c, 'cancelled');
    assertEquals((await orderRow(db, c)).expires_at !== null, true);

    const e = await insertOrder(db, 'awaiting_payment', { expires_at: DUE });
    await setStatus(db, e, 'expired');
    assertEquals((await orderRow(db, e)).expires_at !== null, true);

    const p = await insertOrder(db, 'pending', { expires_at: DUE });
    const first = await setStatus(db, p, 'paid');
    const paidAt = (await orderRow(db, p)).paid_at;
    assert(paidAt !== null);
    assertEquals(first.order.paidAt !== null && first.order.expiresAt === null, true);
    // An earlier paid_at survives a second payment (here: forced back to awaiting_payment).
    const early = '2026-01-01T00:00:00+00';
    const q = await insertOrder(db, 'awaiting_payment', { expires_at: DUE, paid_at: early });
    await setStatus(db, q, 'paid');
    assertEquals(new Date((await orderRow(db, q)).paid_at).toISOString(), '2026-01-01T00:00:00.000Z');
    // paid_at is not touched by later moves.
    await setStatus(db, p, 'packed');
    await setStatus(db, p, 'refunded');
    assertEquals(new Date((await orderRow(db, p)).paid_at).getTime(), new Date(paidAt).getTime());
  });
});

Deno.test('set_order_status: refunding never returns stock', async () => {
  await withDb(async (db) => {
    const v = await findVariant(db, '1', 'L', 'Red');
    const id = newId();
    assertEquals((await placeV2(db, id, [{ productId: '1', size: 'L', color: 'Red', quantity: 3 }])).ok, true);
    assertEquals((await findVariant(db, '1', 'L', 'Red')).stock, v.stock - 3);
    for (const next of ['paid', 'packed', 'shipped', 'delivered', 'refunded']) {
      assertEquals((await setStatus(db, id, next)).changed, true, next);
      assertEquals((await findVariant(db, '1', 'L', 'Red')).stock, v.stock - 3, next);
    }
    // Refunded orders cannot move, and a cancel changes nothing.
    assertEquals((await cancelV2(db, id)).status, 'refunded');
    assertEquals((await setStatus(db, id, 'cancelled')).reason, 'bad_transition');
    assertEquals((await findVariant(db, '1', 'L', 'Red')).stock, v.stock - 3);

    // Refund straight from paid and from expired as well.
    for (const from of ['paid', 'expired']) {
      const other = await insertOrder(db, from);
      const before = (await findVariant(db, '1', 'M', 'Red')).stock;
      assertEquals((await setStatus(db, other, 'refunded')).changed, true, from);
      assertEquals((await findVariant(db, '1', 'M', 'Red')).stock, before, from);
    }
  });
});

Deno.test('order_return_stock: one helper for the variant fallbacks, skipping deleted products', async () => {
  await withDb(async (db) => {
    const exact = await findVariant(db, '1', 'M', 'Red');
    const first = await findVariant(db, '1', 'S', 'Black');
    const byId = await findVariant(db, '1', 'XL', 'Blue');
    const lines = [
      { productId: '1', size: 'M', color: 'Red', quantity: 2 }, // exact size and colour
      { productId: '1', size: 'XXS', color: 'Pink', quantity: 3 }, // first variant
      { productId: '1', size: 'M', color: 'Red', variantId: byId.id, quantity: 4 }, // its own variant wins
      { productId: 'gone', size: 'M', quantity: 5 }, // product deleted: skipped
    ];
    await call(db, 'public.order_return_stock($1::jsonb)', j(lines));
    assertEquals((await findVariant(db, '1', 'M', 'Red')).stock, exact.stock + 2);
    assertEquals((await findVariant(db, '1', 'S', 'Black')).stock, first.stock + 3);
    assertEquals((await findVariant(db, '1', 'XL', 'Blue')).stock, byId.stock + 4);
  });
});

Deno.test('cancel_order_v2: same signature and shape, delegates to set_order_status, works on awaiting_payment', async () => {
  await withDb(async (db) => {
    const sig = await rows(
      db,
      `select pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as res, p.prosecdef
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'cancel_order_v2'`,
    );
    assertEquals(sig.length, 1);
    assertEquals([sig[0].args, sig[0].res, sig[0].prosecdef], ['p_id uuid', 'jsonb', true]);

    assertEquals(await cancelV2(db, newId()), null);

    // awaiting_payment is cancelled and its stock comes back.
    const v = await findVariant(db, '1', 'L', 'Red');
    const id = newId();
    assertEquals((await placeV2(db, id, [{ productId: '1', size: 'L', color: 'Red', quantity: 2 }])).ok, true);
    await db.query(`update public.orders set status = 'awaiting_payment', expires_at = $2 where id = $1`, [id, DUE]);
    const c = await cancelV2(db, id);
    assertEquals(c.status, 'cancelled');
    assertEquals(c, await call(db, `public.order_json((select o from public.orders o where o.id = $1))`, id));
    assertEquals((await findVariant(db, '1', 'L', 'Red')).stock, v.stock);

    // Anything that cannot be cancelled comes back unchanged, with no stock change.
    for (const status of ['paid', 'packed', 'shipped', 'delivered', 'expired', 'refunded']) {
      const o = await insertOrder(db, status);
      const before = await call(db, `public.order_json((select o from public.orders o where o.id = $1))`, o);
      const stock = (await findVariant(db, '1', 'M', 'Red')).stock;
      assertEquals(await cancelV2(db, o), before, status);
      assertEquals((await findVariant(db, '1', 'M', 'Red')).stock, stock, status);
    }
  });
});

Deno.test('lifecycle grants: the new functions are for service_role only', async () => {
  await withDb(async (db) => {
    const sigs = [
      'public.order_return_stock(jsonb)',
      'public.set_order_status(uuid, text, text)',
      'public.order_json(public.orders)',
      'public.cancel_order_v2(uuid)',
    ];
    for (const sig of sigs) {
      for (const role of ['anon', 'authenticated']) {
        assertEquals(
          (await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]))[0].ok,
          false,
          `${role} must not execute ${sig}`,
        );
      }
      assertEquals(
        (await rows(db, `select has_function_privilege('service_role', $1, 'execute') as ok`, [sig]))[0].ok,
        true,
        `service_role executes ${sig}`,
      );
    }
    // PUBLIC has no execute right either.
    const acl = await rows(
      db,
      `select p.proname, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('order_return_stock', 'set_order_status')`,
    );
    assertEquals(acl.length, 2);
    for (const a of acl) {
      // A grant to PUBLIC is an entry with an empty grantee, like "=X/postgres".
      assertEquals((a.acl as string).replace(/^\{|\}$/g, '').split(',').some((e) => e.startsWith('=')), false, `${a.proname} acl ${a.acl}`);
      assert(a.acl.includes('service_role=X'), `${a.proname} acl ${a.acl}`);
    }

    const id = await insertOrder(db, 'pending');
    await db.exec('set role anon');
    try {
      await assertRejects(() => setStatus(db, id, 'paid'), Error, 'permission denied');
      await assertRejects(() => call(db, 'public.order_return_stock($1::jsonb)', '[]'), Error, 'permission denied');
      await assertRejects(() => db.query('select * from public.orders'), Error, 'permission denied');
    } finally {
      await db.exec('reset role');
    }
    await db.exec('set role authenticated');
    try {
      await assertRejects(() => setStatus(db, id, 'paid'), Error, 'permission denied');
    } finally {
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    try {
      assertEquals((await setStatus(db, id, 'paid')).changed, true);
    } finally {
      await db.exec('reset role');
    }
    // anon and authenticated still have no rights on the orders table, new columns included.
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        assertEquals(
          (await rows(db, `select has_table_privilege($1, 'public.orders', $2) as ok`, [role, priv]))[0].ok,
          false,
          `${role} ${priv} on orders`,
        );
      }
      for (const col of ['expires_at', 'payment_url', 'payment_reference', 'paid_at']) {
        assertEquals(
          (await rows(db, `select has_column_privilege($1, 'public.orders', $2, 'select') as ok`, [role, col]))[0].ok,
          false,
          `${role} select ${col}`,
        );
      }
    }
  });
});

/** Everything the lifecycle migration touches, as one comparable value. */
async function dumpLifecycle(db: Db): Promise<Json> {
  return {
    orders: await rows(db, 'select to_jsonb(o) as r from public.orders o order by o.id'),
    columns: await rows(
      db,
      `select column_name, data_type, is_nullable, column_default, numeric_precision, numeric_scale
       from information_schema.columns where table_schema = 'public' and table_name = 'orders' order by ordinal_position`,
    ),
    constraints: await rows(
      db,
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.orders'::regclass order by conname`,
    ),
    indexes: await rows(db, `select indexname, indexdef from pg_indexes where tablename = 'orders' order by indexname`),
    functions: await rows(
      db,
      `select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('order_json', 'order_return_stock', 'set_order_status', 'cancel_order_v2')
       order by sig`,
    ),
  };
}

Deno.test('lifecycle migration is idempotent: a second run changes nothing and keeps the data', async () => {
  await withDb(async (db) => {
    const sql = await readMigration('20261030100000_order_lifecycle.sql');
    // Re-running the lifecycle migration alone would put the old set_order_status back, so a re-run applies
    // it and then the later migration that replaces that function, as running them all in order does.
    const fulfilment = await readMigration('20261031100000_order_fulfilment.sql');
    const rerun = async () => {
      await db.exec(sql);
      await db.exec(fulfilment);
    };
    const first = await dumpLifecycle(db);
    assertEquals(first.functions.length, 4);
    await rerun();
    assertEquals(await dumpLifecycle(db), first);

    // Orders in every status, with new-column data, survive a re-run (the status check is dropped and re-added).
    for (const status of STATUSES) {
      await insertOrder(db, status, { expires_at: DUE, delivery_method: 'courier', delivery_fee: 25, payment_method: 'online', tracking_number: 'T1' });
    }
    const edited = await dumpLifecycle(db);
    await rerun();
    assertEquals(await dumpLifecycle(db), edited);
    // And the status check still rejects an unknown status afterwards.
    await assertRejects(() => insertOrder(db, 'bogus'), Error, 'orders_status_check');
  });
});

Deno.test('lifecycle migration: place_order, cancel_order and place_order_v2 are not redefined', async () => {
  const defs = (db: Db) =>
    rows(
      db,
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('place_order', 'cancel_order', 'place_order_v2') order by p.proname`,
    );
  const before = await defs(await catalogueOnly());
  assertEquals(before.length, 3);
  assertEquals(await defs(await post()), before);
});

Deno.test('lifecycle migration: the old kv place_order and cancel_order still work on the widened table', async () => {
  await withDb(async (db) => {
    const id = newId();
    const r = await call(db, 'public.place_order($1::uuid, $2::jsonb, $3::jsonb)', id, j([{ productId: '1', size: 'M', quantity: 2 }]), j({ name: 'A', phone: '1' }));
    assertEquals(r.ok, true);
    assertEquals(r.order.status, 'pending');
    assertEquals(r.order.deliveryFee, 0);
    assertEquals(r.order.delivery, null);
    const c = await call(db, 'public.cancel_order($1::uuid)', id);
    assertEquals(c.status, 'cancelled');
    assertEquals((await rows(db, `select value->>'stock' as s from public.kv_store_fbb8f0e1 where key = 'product:1'`))[0].s, '59');
  });
});

// ---------------------------------------------------------------------------
// 20261030110000_delivery.sql and 20261030130000_place_order_v3.sql.
// ---------------------------------------------------------------------------
const placeV3 = (db: Db, id: string, items: unknown[], opts: unknown = {}, customer: unknown = { name: 'Test', phone: '0' }) =>
  call(db, 'public.place_order_v3($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb)', id, j(items), j(customer), j(opts));
const teeStock = async (db: Db): Promise<number> =>
  Number((await rows(db, `select stock from public.product_variants where product_id = '1' and size = 'M' and color = 'Red'`))[0].stock);
const plentyOfTees = (db: Db) => db.exec(`update public.product_variants set stock = 100 where product_id = '1'`);
const ORDER_2_TEES = [{ productId: '1', size: 'M', color: 'Red', quantity: 2 }]; // 2 x 250 = 500
const ADDR = { line1: '12 Main Rd', suburb: 'Sea Point', city: 'Cape Town', postalCode: '8005' };

Deno.test('delivery options: seeded, listed in sort order with prices, inactive ones hidden', async () => {
  await withDb(async (db) => {
    assertEquals(await call(db, 'public.list_delivery_options()'), [
      { id: 'door', name: 'Door delivery', price: 85 },
      { id: 'locker', name: 'Locker', price: 55 },
      { id: 'collect', name: 'Collect', price: 0 },
    ]);
    await db.exec(`update public.delivery_options set active = false where id = 'locker'; update public.delivery_options set sort = 0 where id = 'collect'`);
    assertEquals((await call(db, 'public.list_delivery_options()')).map((o: Json) => o.id), ['collect', 'door']);
    await assertRejects(() => db.exec(`update public.delivery_options set price = -1 where id = 'door'`), Error, 'check');
  });
});

Deno.test('delivery migration is idempotent and keeps edited rows', async () => {
  await withDb(async (db) => {
    await db.exec(`update public.delivery_options set price = 99, name = 'Courier' where id = 'door'`);
    await db.exec(await readMigration('20261030110000_delivery.sql'));
    await db.exec(await readMigration('20261030130000_place_order_v3.sql'));
    assertEquals(await rows(db, 'select count(*)::int as n from public.delivery_options'), [{ n: 3 }]);
    assertEquals((await call(db, 'public.list_delivery_options()'))[0], { id: 'door', name: 'Courier', price: 99 });
  });
});

Deno.test('place_order_v3: without delivery it behaves like v2 (pending, no fee, whatsapp)', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const before = await teeStock(db);
    const r = await placeV3(db, newId(), ORDER_2_TEES);
    assertEquals(r.ok, true);
    assertEquals(r.created, true);
    assertEquals(r.order.status, 'pending');
    assertEquals(r.order.total, 500);
    assertEquals(r.order.deliveryFee, 0);
    assertEquals(r.order.delivery, null);
    assertEquals(r.order.paymentMethod, 'whatsapp');
    assertEquals(await teeStock(db), before - 2);
    // Same result shape as v2 for the lines.
    const v2 = await placeV2(db, newId(), ORDER_2_TEES);
    assertEquals(v2.order.lines, r.order.lines);
  });
});

Deno.test('place_order_v3: the fee is read from delivery_options, never from p_opts', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const door = await placeV3(db, newId(), ORDER_2_TEES, { delivery: { method: 'door', address: ADDR, fee: 0, price: 0 }, fee: 0, total: 1 });
    assertEquals(door.ok, true);
    assertEquals(door.order.deliveryFee, 85);
    assertEquals(door.order.total, 585);
    assertEquals(door.order.delivery, { method: 'door', address: ADDR, fee: 85 });
    assertEquals(door.order.status, 'pending');

    const locker = await placeV3(db, newId(), ORDER_2_TEES, { delivery: { method: 'locker', locker: 'PUDO Sea Point' } });
    assertEquals(locker.order.total, 555);
    assertEquals(locker.order.delivery, { method: 'locker', locker: 'PUDO Sea Point', fee: 55 });

    const collect = await placeV3(db, newId(), ORDER_2_TEES, { delivery: { method: 'collect' } });
    assertEquals(collect.order.total, 500);
    assertEquals(collect.order.delivery, { method: 'collect', fee: 0 });

    // An edited price applies to the next order only.
    await db.exec(`update public.delivery_options set price = 120.5 where id = 'door'`);
    const again = await placeV3(db, newId(), ORDER_2_TEES, { delivery: { method: 'door', address: ADDR } });
    assertEquals(again.order.total, 620.5);
    assertEquals((await orderRow(db, door.order.id)).total, '585.00');
    // The columns hold the choice.
    const row = await orderRow(db, locker.order.id);
    assertEquals([row.delivery_method, row.delivery_locker, row.delivery_address, Number(row.delivery_fee)], ['locker', 'PUDO Sea Point', null, 55]);
  });
});

Deno.test('place_order_v3: unknown or inactive delivery gives unknown_delivery and changes nothing', async () => {
  await withDb(async (db) => {
    const before = await teeStock(db);
    const orders = (await rows(db, 'select count(*)::int as n from public.orders'))[0].n;
    await db.exec(`update public.delivery_options set active = false where id = 'locker'`);
    for (const method of ['drone', 'locker', '', 'DOOR']) {
      const id = newId();
      assertEquals(await placeV3(db, id, ORDER_2_TEES, { delivery: { method } }), { ok: false, reason: 'unknown_delivery' });
      assertEquals((await rows(db, 'select 1 from public.orders where id = $1', [id])).length, 0);
    }
    assertEquals(await teeStock(db), before);
    assertEquals((await rows(db, 'select count(*)::int as n from public.orders'))[0].n, orders);
  });
});

Deno.test('place_order_v3: a replay returns the stored order and does not add the fee or take stock again', async () => {
  await withDb(async (db) => {
    const id = newId();
    const before = await teeStock(db);
    const first = await placeV3(db, id, ORDER_2_TEES, { delivery: { method: 'door', address: ADDR } });
    assertEquals(first.created, true);
    const again = await placeV3(db, id, ORDER_2_TEES, { delivery: { method: 'door', address: ADDR } });
    assertEquals(again.created, false);
    assertEquals(again.order, first.order);
    assertEquals(again.order.total, 585);
    // A replay with another choice changes nothing, and v2 can replay it too.
    const other = await placeV3(db, id, ORDER_2_TEES, { delivery: { method: 'collect' }, paymentMethod: 'online' });
    assertEquals(other.order, first.order);
    assertEquals((await placeV2(db, id, ORDER_2_TEES)).order, first.order);
    assertEquals(await teeStock(db), before - 2);
    assertEquals(Number((await orderRow(db, id)).total), 585);
  });
});

Deno.test('place_order_v3: online orders start as awaiting_payment, others as pending', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const online = await placeV3(db, newId(), ORDER_2_TEES, { paymentMethod: 'online', delivery: { method: 'door', address: ADDR } });
    assertEquals(online.order.status, 'awaiting_payment');
    assertEquals(online.order.paymentMethod, 'online');
    assertEquals(online.order.total, 585);
    const wa = await placeV3(db, newId(), ORDER_2_TEES, { paymentMethod: 'whatsapp' });
    assertEquals(wa.order.status, 'pending');
    assertEquals(wa.order.paymentMethod, 'whatsapp');
    // An awaiting_payment order can be cancelled and its stock returns.
    const before = await teeStock(db);
    assertEquals((await cancelV2(db, online.order.id)).status, 'cancelled');
    assertEquals(await teeStock(db), before + 2);
    // An unknown payment method is refused by the table check and rolls everything back.
    const stock = await teeStock(db);
    await assertRejects(() => placeV3(db, newId(), ORDER_2_TEES, { paymentMethod: 'cash' }), Error, 'payment_method');
    assertEquals(await teeStock(db), stock);
  });
});

Deno.test('place_order_v3: missing and short stock are reported like v2 and nothing changes', async () => {
  await withDb(async (db) => {
    const before = await teeStock(db);
    const orders = (await rows(db, 'select count(*)::int as n from public.orders'))[0].n;
    const opts = { delivery: { method: 'door', address: ADDR }, paymentMethod: 'online' };
    const short = await placeV3(db, newId(), [{ productId: '1', size: 'M', color: 'Red', quantity: before + 1 }], opts);
    assertEquals(short.ok, false);
    assertEquals(short.reason, 'stock');
    assertEquals(short.short[0].available, before);
    assertEquals(await placeV3(db, newId(), [{ productId: 'nope', quantity: 1 }], opts), { ok: false, reason: 'missing', missing: ['nope'] });
    // One good line and one short line: the good line's stock is not taken either.
    const mixed = await placeV3(db, newId(), [...ORDER_2_TEES, { productId: '5', quantity: 1 }], opts);
    assertEquals(mixed.reason, 'stock');
    assertEquals(await teeStock(db), before);
    assertEquals((await rows(db, 'select count(*)::int as n from public.orders'))[0].n, orders);
  });
});

Deno.test('delivery and place_order_v3: only service_role may use them; the table is locked down', async () => {
  await withDb(async (db) => {
    const sigs = ['public.place_order_v3(uuid, jsonb, jsonb, jsonb)', 'public.list_delivery_options()'];
    for (const sig of sigs) {
      for (const role of ['public', 'anon', 'authenticated']) {
        const ok = role === 'public'
          ? (await rows(db, `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as ok`, [sig]))[0].ok
          : (await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]))[0].ok;
        assertEquals(ok, false, `${role} ${sig}`);
      }
      assertEquals((await rows(db, `select has_function_privilege('service_role', $1, 'execute') as ok`, [sig]))[0].ok, true, sig);
    }
    assertEquals((await rows(db, `select relrowsecurity as rls from pg_class where oid = 'public.delivery_options'::regclass`))[0].rls, true);
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        assertEquals(
          (await rows(db, `select has_table_privilege($1, 'public.delivery_options', $2) as ok`, [role, priv]))[0].ok,
          false,
          `${role} ${priv}`,
        );
      }
    }
    assertEquals(
      (await rows(db, `select count(*)::int as n from pg_policies where tablename = 'delivery_options'`))[0].n,
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// 20261030120000_payments.sql: get_order, order_payment_info, attach_payment, record_payment.
// ---------------------------------------------------------------------------
const getOrder = (db: Db, id: string) => call(db, 'public.get_order($1::uuid)', id);
const payInfo = (db: Db, id: string) => call(db, 'public.order_payment_info($1::uuid)', id);
const attach = (db: Db, id: string, ref: string | null, url: string | null) =>
  call(db, 'public.attach_payment($1::uuid, $2, $3)', id, ref, url);
const record = (db: Db, ref: string | null, cents: number | null, currency: string | null = 'ZAR') =>
  call(db, 'public.record_payment($1, $2::bigint, $3)', ref, cents, currency);
const payUrl = (id: string) => `https://pay.test/${id}`;
const EMAIL_CUSTOMER = { name: 'Test', phone: '0', email: 't@example.com' };

/** An online order (2 x Classic Tee M / Red = 500 + door 85 = 585) whose payment has been started. */
async function startedOnline(db: Db, items: unknown[] = ORDER_2_TEES, customer: unknown = EMAIL_CUSTOMER): Promise<string> {
  const id = newId();
  const r = await placeV3(db, id, items, { paymentMethod: 'online', delivery: { method: 'door', address: ADDR } }, customer);
  assertEquals(r.ok, true);
  assertEquals(await attach(db, id, id, payUrl(id)), true);
  return id;
}

const teeM = async (db: Db) => (await findVariant(db, '1', 'M', 'Red')).stock;

Deno.test('get_order and order_payment_info: the order, or NULL; the checkout URL only through order_payment_info', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    assertEquals(await getOrder(db, newId()), null);
    assertEquals(await payInfo(db, newId()), null);

    const id = newId();
    const placed = await placeV3(db, id, ORDER_2_TEES, { paymentMethod: 'online', delivery: { method: 'door', address: ADDR } }, EMAIL_CUSTOMER);
    assertEquals(await getOrder(db, id), placed.order);
    assertEquals(await call(db, `(select public.order_json(o) from public.orders o where o.id = $1::uuid)`, id), placed.order);
    assertEquals(await payInfo(db, id), {
      id, ref: id.slice(0, 8).toUpperCase(), status: 'awaiting_payment', total: 585, email: 't@example.com', paymentUrl: null,
    });

    assertEquals(await attach(db, id, id, payUrl(id)), true);
    assertEquals((await payInfo(db, id)).paymentUrl, payUrl(id));
    // The order JSON never shows the URL or the reference.
    const shown = JSON.stringify(await getOrder(db, id));
    assert(!shown.includes('pay.test') && !shown.includes('paymentUrl') && !shown.includes('paymentReference'));
    assertEquals(await getOrder(db, id), placed.order);

    // No email, a blank email, and a fractional total (trailing zeros are trimmed).
    const bare = newId();
    await placeV3(db, bare, ORDER_2_TEES, {}, { name: 'N', phone: '0', email: '' });
    assertEquals((await payInfo(db, bare)).email, null);
    const cheap = await insertOrder(db, 'awaiting_payment', { total: 100.5, customer: j({ name: 'N', phone: '0' }) });
    assertEquals((await payInfo(db, cheap)).total, 100.5);
    assertEquals((await payInfo(db, cheap)).email, null);
  });
});

Deno.test('attach_payment: stores once, while awaiting_payment, under the first values', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const id = newId();
    await placeV3(db, id, ORDER_2_TEES, { paymentMethod: 'online' }, EMAIL_CUSTOMER);
    // Empty values are refused and store nothing.
    for (const [ref, url] of [[null, payUrl(id)], ['', payUrl(id)], [id, null], [id, '']] as const) {
      assertEquals(await attach(db, id, ref, url), false, `${ref}/${url}`);
    }
    assertEquals((await orderRow(db, id)).payment_reference, null);

    assertEquals(await attach(db, id, id, payUrl(id)), true);
    const row = await orderRow(db, id);
    assertEquals([row.payment_reference, row.payment_url, row.status], [id, payUrl(id), 'awaiting_payment']);
    // The same values again are fine (a repeat); other values do not replace them.
    assertEquals(await attach(db, id, id, payUrl(id)), true);
    assertEquals(await attach(db, id, id, 'https://pay.test/other'), false);
    assertEquals(await attach(db, id, 'other-ref', payUrl(id)), false);
    const after = await orderRow(db, id);
    assertEquals([after.payment_reference, after.payment_url], [id, payUrl(id)]);

    // Unknown order; an order that is not awaiting_payment (pending on WhatsApp, paid, expired, cancelled).
    assertEquals(await attach(db, newId(), 'r', 'u'), false);
    for (const status of ['pending', 'paid', 'packed', 'expired', 'cancelled', 'refunded']) {
      const other = await insertOrder(db, status);
      assertEquals(await attach(db, other, `ref-${status}`, 'https://pay.test/x'), false, status);
      assertEquals((await orderRow(db, other)).payment_reference, null, status);
    }
    // A reference can belong to one order only.
    const second = await insertOrder(db, 'awaiting_payment');
    await assertRejects(() => attach(db, second, id, 'https://pay.test/dup'), Error, 'orders_payment_reference_key');
    assertEquals((await orderRow(db, second)).payment_reference, null);
  });
});

Deno.test('record_payment: awaiting_payment becomes paid once; repeats change nothing', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const id = await startedOnline(db);
    await db.query(`update public.orders set expires_at = $2 where id = $1`, [id, DUE]);
    const stock = await teeM(db);
    const r = await record(db, id, 58500);
    assertEquals(r, { ok: true, changed: true, outcome: 'paid' });
    const row = await orderRow(db, id);
    assertEquals([row.status, row.payment_flag, row.expires_at], ['paid', null, null]);
    assert(row.paid_at);
    assertEquals(await teeM(db), stock, 'stock was already taken when the order was placed');

    for (let i = 0; i < 3; i++) {
      assertEquals(await record(db, id, 58500), { ok: true, changed: false, outcome: 'already' });
      assertEquals(await orderRow(db, id), row);
      assertEquals(await teeM(db), stock);
    }
    // After the order moves on, a repeat does not undo it.
    await setStatus(db, id, 'packed');
    assertEquals((await record(db, id, 58500)).outcome, 'already');
    assertEquals((await orderRow(db, id)).status, 'packed');
    assertEquals((await orderRow(db, id)).paid_at, row.paid_at);
  });
});

Deno.test('record_payment: unknown references, and amounts or currencies that do not match the order', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const id = await startedOnline(db);
    for (const ref of [newId(), 'nope', '', null]) {
      assertEquals(await record(db, ref, 58500), { ok: false, reason: 'not_found' }, String(ref));
    }
    const stock = await teeM(db);
    const before = await orderRow(db, id);
    const bad: [number | null, string | null][] = [
      [58499, 'ZAR'], [58501, 'ZAR'], [585, 'ZAR'], [29250, 'ZAR'], [0, 'ZAR'], [null, 'ZAR'],
      [58500, 'USD'], [58500, 'zar'], [58500, ''], [58500, null],
    ];
    for (const [cents, cur] of bad) {
      assertEquals(await record(db, id, cents, cur), { ok: false, reason: 'amount_mismatch' }, `${cents}/${cur}`);
      const row = await orderRow(db, id);
      assertEquals([row.status, row.payment_flag, row.paid_at], ['awaiting_payment', 'amount_mismatch', null], `${cents}/${cur}`);
      assertEquals(await teeM(db), stock);
    }
    // Only the flag changed.
    assertEquals({ ...(await orderRow(db, id)), payment_flag: null }, before);
    // The correct, verified payment still goes through and clears the flag.
    assertEquals((await record(db, id, 58500)).outcome, 'paid');
    assertEquals(await orderRow(db, id).then((r) => [r.status, r.payment_flag]), ['paid', null]);
  });
});

Deno.test('record_payment: a refund_due flag is not replaced by a mismatch', async () => {
  await withDb(async (db) => {
    const id = await insertOrder(db, 'expired', { payment_reference: 'RD-1', payment_flag: 'refund_due', total: 500 });
    assertEquals(await record(db, 'RD-1', 1), { ok: false, reason: 'amount_mismatch' });
    assertEquals((await orderRow(db, id)).payment_flag, 'refund_due');
  });
});

Deno.test('record_payment: already-paid statuses and refund_due orders are left alone', async () => {
  await withDb(async (db) => {
    for (const status of ['paid', 'packed', 'shipped', 'delivered', 'refunded']) {
      const id = await insertOrder(db, status, { payment_reference: `ref-${status}`, paid_at: DUE, total: 500 });
      const before = await orderRow(db, id);
      assertEquals(await record(db, `ref-${status}`, 50000), { ok: true, changed: false, outcome: 'already' }, status);
      assertEquals(await orderRow(db, id), before, status);
    }
    const flagged = await insertOrder(db, 'expired', { payment_reference: 'ref-flagged', payment_flag: 'refund_due', paid_at: DUE, total: 500 });
    const before = await orderRow(db, flagged);
    assertEquals((await record(db, 'ref-flagged', 50000)).outcome, 'already');
    assertEquals(await orderRow(db, flagged), before);
  });
});

Deno.test('record_payment: a pending order that has a reference becomes paid', async () => {
  await withDb(async (db) => {
    const id = await insertOrder(db, 'pending', { payment_reference: 'ref-pending', total: 500, expires_at: DUE });
    assertEquals(await record(db, 'ref-pending', 50000), { ok: true, changed: true, outcome: 'paid' });
    const row = await orderRow(db, id);
    assertEquals([row.status, row.expires_at], ['paid', null]);
    assert(row.paid_at);
  });
});

Deno.test('record_payment: a late payment on an expired or cancelled order retakes the stock and pays', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    // Two lines on one variant: 1 + 2 = 3 units.
    const items = [
      { productId: '1', size: 'M', color: 'Red', quantity: 1 },
      { productId: '1', size: 'M', color: 'Red', quantity: 2 },
    ];
    for (const how of ['expired', 'cancelled']) {
      const start = await teeM(db);
      const id = await startedOnline(db, items);
      assertEquals(await teeM(db), start - 3);
      await db.query(`update public.orders set expires_at = $2 where id = $1`, [id, DUE]);
      assertEquals((await setStatus(db, id, how)).changed, true);
      assertEquals(await teeM(db), start, `${how}: stock came back`);
      assertEquals((await orderRow(db, id)).expires_at !== null, true);

      assertEquals(await record(db, id, 83500), { ok: true, changed: true, outcome: 'paid_late' }, how); // 3 x 250 + 85
      const row = await orderRow(db, id);
      assertEquals([row.status, row.payment_flag, row.expires_at], ['paid', null, null], how);
      assert(row.paid_at, how);
      assertEquals(await teeM(db), start - 3, `${how}: stock was taken again`);

      // Repeats change nothing, stock included.
      assertEquals((await record(db, id, 83500)).outcome, 'already');
      assertEquals(await orderRow(db, id), row);
      assertEquals(await teeM(db), start - 3);
      // And the order carries on as a paid one.
      assertEquals((await setStatus(db, id, 'packed')).changed, true);
    }
  });
});

Deno.test('record_payment: when the stock is gone the order stays as it is and is flagged refund_due', async () => {
  const cases: [string, (db: Db) => Promise<void>][] = [
    ['stock taken by another order', async (d) => {
      await setStock(d, (await findVariant(d, '1', 'M', 'Red')).id, 0);
    }],
    ['stock one short', async (d) => {
      await setStock(d, (await findVariant(d, '1', 'M', 'Red')).id, 1); // the order needs 2
    }],
    ['variant deleted', async (d) => {
      await d.query(`delete from public.product_variants where product_id = '1' and size = 'M' and color = 'Red'`);
    }],
    ['product deleted', async (d) => {
      assertEquals(await call(d, `public.delete_product('1')`), true);
    }],
  ];
  for (const status of ['expired', 'cancelled']) {
    for (const [label, disturb] of cases) {
      await withDb(async (db) => {
        const at = `${status}: ${label}`;
        await plentyOfTees(db);
        const id = await startedOnline(db);
        assertEquals((await setStatus(db, id, status)).changed, true, at);
        await disturb(db);
        const stocks = await rows(db, `select id, stock from public.product_variants order by id`);
        const before = await orderRow(db, id);

        assertEquals(await record(db, id, 58500), { ok: true, changed: true, outcome: 'refund_due' }, at);
        const row = await orderRow(db, id);
        assertEquals([row.status, row.payment_flag], [status, 'refund_due'], at);
        assert(row.paid_at, at);
        assertEquals(await rows(db, `select id, stock from public.product_variants order by id`), stocks, at);
        // Nothing but paid_at and the flag changed.
        assertEquals({ ...row, paid_at: null, payment_flag: null }, { ...before, paid_at: null, payment_flag: null }, at);

        // A repeat changes nothing, paid_at included.
        assertEquals((await record(db, id, 58500)).outcome, 'already', at);
        assertEquals(await orderRow(db, id), row, at);
      });
    }
  }
});

Deno.test('record_payment: lines are served all together or not at all; a line with no variantId is not served', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const shorts = await findVariant(db, UUID_ID, 'S', 'Black');
    await setStock(db, shorts.id, 5);
    const id = await startedOnline(db, [
      { productId: '1', size: 'M', color: 'Red', quantity: 1 },
      { productId: UUID_ID, size: 'S', color: 'Black', quantity: 2 },
    ]);
    assertEquals((await setStatus(db, id, 'expired')).changed, true);
    // The shorts run out while the tee is plentiful.
    await setStock(db, shorts.id, 1);
    const teeBefore = await teeM(db);
    const cents = Math.round((await payInfo(db, id)).total * 100);
    assertEquals((await record(db, id, cents)).outcome, 'refund_due');
    assertEquals(await teeM(db), teeBefore, 'the line that could be served was not taken');
    assertEquals((await findVariant(db, UUID_ID, 'S', 'Black')).stock, 1);

    // With enough of both, both are taken.
    const ok = await startedOnline(db, [
      { productId: '1', size: 'M', color: 'Red', quantity: 1 },
      { productId: UUID_ID, size: 'S', color: 'Black', quantity: 1 },
    ]);
    await setStatus(db, ok, 'expired');
    const [t, s0] = [await teeM(db), (await findVariant(db, UUID_ID, 'S', 'Black')).stock];
    assertEquals((await record(db, ok, Math.round((await payInfo(db, ok)).total * 100))).outcome, 'paid_late');
    assertEquals([await teeM(db), (await findVariant(db, UUID_ID, 'S', 'Black')).stock], [t - 1, s0 - 1]);

    // An older line without variantId: never matched by size and colour, so it is not served.
    const old = await insertOrder(db, 'expired', { payment_reference: 'old-1', total: 500 });
    const teeNow = await teeM(db);
    assertEquals(await record(db, 'old-1', 50000), { ok: true, changed: true, outcome: 'refund_due' });
    assertEquals(await teeM(db), teeNow);
    assertEquals((await orderRow(db, old)).status, 'expired');
  });
});

Deno.test('payment functions: only service_role may call them', async () => {
  await withDb(async (db) => {
    const sigs = [
      'public.get_order(uuid)',
      'public.order_payment_info(uuid)',
      'public.attach_payment(uuid, text, text)',
      'public.record_payment(text, bigint, text)',
    ];
    for (const sig of sigs) {
      for (const role of ['anon', 'authenticated']) {
        assertEquals(
          (await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]))[0].ok,
          false,
          `${role} ${sig}`,
        );
      }
      assertEquals((await rows(db, `select has_function_privilege('service_role', $1, 'execute') as ok`, [sig]))[0].ok, true, sig);
      assertEquals(
        (await rows(db, `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as ok`, [sig]))[0].ok,
        false,
        `PUBLIC ${sig}`,
      );
      // They run as their owner, with a fixed search_path.
      const def = (await rows(db, `select prosecdef, proconfig from pg_proc where oid = $1::regprocedure`, [sig]))[0];
      assertEquals(def.prosecdef, true, sig);
      assert(String(def.proconfig).includes('search_path=public'), sig);
    }
    await plentyOfTees(db);
    const id = await startedOnline(db);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await assertRejects(() => getOrder(db, id), Error, 'permission denied');
        await assertRejects(() => payInfo(db, id), Error, 'permission denied');
        await assertRejects(() => attach(db, id, 'x', 'y'), Error, 'permission denied');
        await assertRejects(() => record(db, id, 58500), Error, 'permission denied');
      } finally {
        await db.exec('reset role');
      }
    }
    assertEquals((await orderRow(db, id)).status, 'awaiting_payment');
    await db.exec('set role service_role');
    try {
      assertEquals((await record(db, id, 58500)).outcome, 'paid');
      assertEquals((await getOrder(db, id)).status, 'paid');
    } finally {
      await db.exec('reset role');
    }
  });
});

Deno.test('record_payment: the order row is locked first, then the variants in ONE query ordered by id', async () => {
  await withDb(async (db) => {
    const def: string = (await rows(db, `select pg_get_functiondef('public.record_payment(text, bigint, text)'::regprocedure) as d`))[0].d;
    const locks = [...def.matchAll(/for update/g)].map((m) => m.index!);
    assertEquals(locks.length, 2, 'one lock on the order row, one on the variants');
    const orderLock = def.indexOf('from public.orders where payment_reference = p_reference for update');
    assert(orderLock >= 0 && orderLock < locks[0] + 1);
    const variantQuery = def.slice(def.indexOf('from public.product_variants'), locks[1]);
    assert(/order by id\s*$/.test(variantQuery), 'the variant lock is "order by id for update"');
    // Nothing reads stock before the variants are locked.
    assert(def.indexOf('v.stock >=') > locks[1], 'stock is read after the lock');
  });
});

/** The payment functions, orders and variants as one comparable value. */
async function dumpPayments(db: Db): Promise<Json> {
  return {
    functions: await rows(
      db,
      `select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('get_order', 'order_payment_info', 'attach_payment', 'record_payment')
       order by sig`,
    ),
    orders: await rows(db, 'select to_jsonb(o) as r from public.orders o order by o.id'),
    variants: await rows(db, 'select id, stock from public.product_variants order by id'),
    columns: await rows(db, `select column_name from information_schema.columns where table_name = 'orders' order by ordinal_position`),
    tables: await rows(db, `select table_name from information_schema.tables where table_schema = 'public' order by table_name`),
  };
}

Deno.test('payments migration is idempotent: a second run changes nothing and keeps the data', async () => {
  await withDb(async (db) => {
    const sql = await readMigration('20261030120000_payments.sql');
    await plentyOfTees(db);
    const first = await dumpPayments(db);
    assertEquals(first.functions.length, 4);
    await db.exec(sql);
    assertEquals(await dumpPayments(db), first);

    const id = await startedOnline(db);
    const late = await startedOnline(db);
    await setStatus(db, late, 'expired');
    assertEquals((await record(db, id, 58500)).outcome, 'paid');
    assertEquals((await record(db, late, 58500)).outcome, 'paid_late');
    const used = await dumpPayments(db);
    await db.exec(sql);
    assertEquals(await dumpPayments(db), used);
    assertEquals((await record(db, id, 58500)).outcome, 'already');
  });
});

// ---------------------------------------------------------------------------
// Section 4, abuse limits: the per-address order limit and expires_at in
// 20261030130000_place_order_v3.sql, order expiry (expire_one_order,
// expire_due_orders), and 20261030140000_order_expiry_cron.sql (read as text).
// ---------------------------------------------------------------------------
const IP_A = '203.0.113.9';
const IP_B = '2001:db8::17';
const logCount = async (db: Db): Promise<number> => (await rows(db, 'select count(*)::int as n from public.order_ip_log'))[0].n;
const orderCount = async (db: Db): Promise<number> => (await rows(db, 'select count(*)::int as n from public.orders'))[0].n;
const placeFrom = (db: Db, ip: unknown, extra: Record<string, unknown> = {}, items: unknown[] = ORDER_2_TEES) =>
  placeV3(db, newId(), items, { ip, ...extra });
const expireDue = (db: Db) => db.exec('call public.expire_due_orders()');
const expireOne = (db: Db, id: string) => call(db, 'public.expire_one_order($1::uuid)', id);
const setExpiry = (db: Db, id: string, sql: string) => db.query(`update public.orders set expires_at = ${sql} where id = $1`, [id]);

Deno.test('rate limit: 5 orders per address in a rolling hour pass; the 6th is rate_limited and keeps nothing', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const before = await teeStock(db);
    for (let i = 0; i < 5; i++) assertEquals((await placeFrom(db, IP_A)).ok, true, `order ${i + 1}`);
    assertEquals(await teeStock(db), before - 10);
    const orders = await orderCount(db);

    // The 6th: with delivery and online payment too, so every step of the block has run before the limit.
    const id = newId();
    const r = await placeV3(db, id, ORDER_2_TEES, { ip: IP_A, paymentMethod: 'online', delivery: { method: 'door', address: ADDR } });
    assertEquals(r, { ok: false, reason: 'rate_limited' });
    assertEquals(await teeStock(db), before - 10); // stock is back
    assertEquals((await rows(db, 'select 1 from public.orders where id = $1', [id])).length, 0); // no order row
    assertEquals(await orderCount(db), orders);
    assertEquals(await logCount(db), 5); // and no log row
    // Still blocked, and the same id can be tried again later.
    assertEquals((await placeV3(db, id, ORDER_2_TEES, { ip: IP_A })).reason, 'rate_limited');

    // Another address is independent, in either family.
    assertEquals((await placeFrom(db, '203.0.113.10')).ok, true);
    assertEquals((await placeFrom(db, IP_B)).ok, true);
    assertEquals(await logCount(db), 7);
  });
});

Deno.test('rate limit: the hour rolls; a row older than an hour does not count and is deleted', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    for (let i = 0; i < 5; i++) await placeFrom(db, IP_A);
    assertEquals((await placeFrom(db, IP_A)).reason, 'rate_limited');
    // Two rows move to 61 minutes ago, one to 59 minutes ago.
    await db.exec(`
      update public.order_ip_log set created_at = now() - interval '61 minutes'
        where ctid in (select ctid from public.order_ip_log order by ctid limit 2);
      update public.order_ip_log set created_at = now() - interval '59 minutes'
        where ctid in (select ctid from public.order_ip_log where created_at > now() - interval '1 minute' order by ctid limit 1);
    `);
    assertEquals((await placeFrom(db, IP_A)).ok, true); // 3 count (2 fresh, 1 at 59 minutes), so this is the 4th
    assertEquals(
      (await rows(db, `select count(*)::int as n from public.order_ip_log where created_at < now() - interval '1 hour'`))[0].n,
      0,
      'the old rows are deleted',
    );
    assertEquals(await logCount(db), 4);
    assertEquals((await placeFrom(db, IP_A)).ok, true); // the 5th counted
    assertEquals((await placeFrom(db, IP_A)).reason, 'rate_limited');
    // Only this address's old rows are deleted by a check; another address's are left for the job.
    await placeFrom(db, IP_B);
    await db.exec(`update public.order_ip_log set created_at = now() - interval '3 hours'`);
    assertEquals((await placeFrom(db, IP_A)).ok, true);
    assertEquals(await logCount(db), 2); // IP_A's old rows went; IP_B's old row stays until the job runs
    assertEquals((await rows(db, `select count(*)::int as n from public.order_ip_log where created_at < now() - interval '1 hour'`))[0].n, 1);
  });
});

Deno.test('rate limit: idempotent replays and stock rejections do not count, and are not blocked at the limit', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const first = newId();
    assertEquals((await placeV3(db, first, ORDER_2_TEES, { ip: IP_A })).created, true);
    for (let i = 0; i < 8; i++) assertEquals((await placeV3(db, first, ORDER_2_TEES, { ip: IP_A })).created, false);
    const short = [{ productId: '1', size: 'M', color: 'Red', quantity: 1000 }];
    for (let i = 0; i < 8; i++) assertEquals((await placeV3(db, newId(), short, { ip: IP_A })).reason, 'stock');
    for (let i = 0; i < 8; i++) assertEquals((await placeV3(db, newId(), [{ productId: 'nope', quantity: 1 }], { ip: IP_A })).reason, 'missing');
    for (let i = 0; i < 8; i++) assertEquals((await placeV3(db, newId(), ORDER_2_TEES, { ip: IP_A, delivery: { method: 'drone' } })).reason, 'unknown_delivery');
    assertEquals(await logCount(db), 1);
    for (let i = 0; i < 4; i++) assertEquals((await placeFrom(db, IP_A)).ok, true);
    assertEquals((await placeFrom(db, IP_A)).reason, 'rate_limited');
    // At the limit, a replay is still answered and a stock rejection is still a stock rejection.
    assertEquals((await placeV3(db, first, ORDER_2_TEES, { ip: IP_A })).created, false);
    assertEquals((await placeV3(db, newId(), short, { ip: IP_A })).reason, 'stock');
    assertEquals(await logCount(db), 5);
  });
});

Deno.test('rate limit: no ip, an empty or non-text ip never blocks and writes no log row', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    for (let i = 0; i < 8; i++) assertEquals((await placeV3(db, newId(), ORDER_2_TEES, {})).ok, true);
    for (const ip of [null, '', '   ', 42, true, { a: 1 }]) {
      for (let i = 0; i < 2; i++) assertEquals((await placeFrom(db, ip)).ok, true, JSON.stringify(ip));
    }
    assertEquals((await placeV3(db, newId(), ORDER_2_TEES)).ok, true); // p_opts left at its default
    assertEquals(await logCount(db), 0);
  });
});

Deno.test('rate limit: the log holds only a salted hash; the raw address is never stored', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const ips = ['198.51.100.23', '2001:db8:abcd::42'];
    for (const ip of ips) for (let i = 0; i < 3; i++) await placeFrom(db, ip);
    assertEquals((await placeFrom(db, ips[0])).ok, true);
    assertEquals((await placeFrom(db, ips[0])).ok, true);
    assertEquals((await placeFrom(db, ips[0])).reason, 'rate_limited');

    const log = await rows(db, 'select * from public.order_ip_log');
    assertEquals(log.length, 5 + 3);
    assertEquals(Object.keys(log[0]).sort(), ['created_at', 'ip_hash']);
    const salt = (await rows(db, 'select salt from public.order_rate_salt'))[0].salt as string;
    assert(salt.length >= 64);
    const expected = async (ip: string) =>
      (await rows(db, `select encode(sha256(convert_to($1 || $2, 'UTF8')), 'hex') as h`, [salt, ip]))[0].h as string;
    const hashA = await expected(ips[0]);
    const hashB = await expected(ips[1]);
    assertEquals(log.filter((l) => l.ip_hash === hashA).length, 5);
    assertEquals(log.filter((l) => l.ip_hash === hashB).length, 3);
    for (const l of log) assert(/^[0-9a-f]{64}$/.test(l.ip_hash));
    // No salt, no match: a bare sha256 of the address is not what is stored.
    const bare = (await rows(db, `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`, [ips[0]]))[0].h;
    assert(!log.some((l) => l.ip_hash === bare));

    // The address appears in no stored row: the log, the salt table or the orders.
    const dump = JSON.stringify({
      log,
      salt: await rows(db, 'select * from public.order_rate_salt'),
      orders: await rows(db, 'select to_jsonb(o) as r from public.orders o'),
    });
    for (const ip of ips) assert(!dump.includes(ip), `${ip} is stored`);
  });
});

Deno.test('rate limit: the tables are locked down, and the salt is a singleton', async () => {
  await withDb(async (db) => {
    for (const t of ['order_rate_salt', 'order_ip_log']) {
      assertEquals((await rows(db, `select relrowsecurity as rls from pg_class where oid = $1::regclass`, [`public.${t}`]))[0].rls, true, t);
      assertEquals((await rows(db, `select count(*)::int as n from pg_policies where tablename = $1`, [t]))[0].n, 0, t);
      for (const role of ['anon', 'authenticated']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          assertEquals((await rows(db, `select has_table_privilege($1, $2, $3) as ok`, [role, `public.${t}`, priv]))[0].ok, false, `${role} ${priv} ${t}`);
        }
      }
    }
    assertEquals((await rows(db, 'select count(*)::int as n from public.order_rate_salt'))[0].n, 1);
    await assertRejects(() => db.exec(`insert into public.order_rate_salt (id) values (false)`), Error, 'check');
    await assertRejects(() => db.exec(`insert into public.order_rate_salt (id) values (true)`), Error, 'duplicate');
  });
});

Deno.test('place_order_v3: the limit is the last step, in the same block as v2, caught by NG429', async () => {
  await withDb(async (db) => {
    const def: string = (await rows(db, `select pg_get_functiondef('public.place_order_v3(uuid, jsonb, jsonb, jsonb)'::regprocedure) as d`))[0].d;
    const at = (needle: string) => {
      const i = def.indexOf(needle);
      assert(i >= 0, needle);
      return i;
    };
    const begin = at('place_order_v2(p_id');
    const update = at('update public.orders');
    const lock = at('pg_advisory_xact_lock');
    const raise = at("errcode = 'NG429'");
    const insert = at('insert into public.order_ip_log');
    const handler = at("when sqlstate 'NG429'");
    assert(begin < update && update < lock && lock < raise && raise < insert && insert < handler);
    assert(!def.slice(handler).includes('place_order_v2'));
    assert(!def.includes('pgcrypto') && !def.includes('digest('));
  });
});

Deno.test('expires_at: 48 hours for pending, 30 minutes for awaiting_payment, set once', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const secs = async (id: string) =>
      Number((await rows(db, `select extract(epoch from expires_at - created_at) as s from public.orders where id = $1`, [id]))[0].s);
    const wa = await placeV3(db, newId(), ORDER_2_TEES, {});
    const withIp = await placeV3(db, newId(), ORDER_2_TEES, { ip: IP_A, paymentMethod: 'whatsapp' });
    const online = await placeV3(db, newId(), ORDER_2_TEES, { paymentMethod: 'online', delivery: { method: 'collect' } });
    assertEquals(await secs(wa.order.id), 48 * 3600);
    assertEquals(await secs(withIp.order.id), 48 * 3600);
    assertEquals(await secs(online.order.id), 30 * 60);
    assertEquals(wa.order.expiresAt !== null && online.order.expiresAt !== null, true);
    // A replay changes nothing, the expiry included.
    const before = (await orderRow(db, wa.order.id)).expires_at;
    await placeV3(db, wa.order.id, ORDER_2_TEES, { paymentMethod: 'online' });
    assertEquals((await orderRow(db, wa.order.id)).expires_at, before);
    // The seeded old order has none and gets none.
    assertEquals((await orderRow(db, OLD_ORDER_ID)).expires_at, null);
  });
});

Deno.test('place_order_v3 migration is idempotent: a second run keeps the salt and the log', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    await placeFrom(db, IP_A);
    const salt = await rows(db, 'select * from public.order_rate_salt');
    const log = await rows(db, 'select * from public.order_ip_log');
    await db.exec(await readMigration('20261030130000_place_order_v3.sql'));
    assertEquals(await rows(db, 'select * from public.order_rate_salt'), salt);
    assertEquals(await rows(db, 'select * from public.order_ip_log'), log);
    for (let i = 0; i < 4; i++) await placeFrom(db, IP_A);
    assertEquals((await placeFrom(db, IP_A)).reason, 'rate_limited');
  });
});

Deno.test('expiry: a due pending order is cancelled, a due awaiting_payment order expires, stock returns exactly once', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const before = await teeStock(db);
    const wa = (await placeV3(db, newId(), ORDER_2_TEES, {})).order.id;
    const online = (await placeV3(db, newId(), ORDER_2_TEES, { paymentMethod: 'online' })).order.id;
    assertEquals(await teeStock(db), before - 4);
    await setExpiry(db, wa, `now() - interval '1 minute'`);
    await setExpiry(db, online, `now() - interval '1 second'`);

    await expireDue(db);
    assertEquals([(await orderRow(db, wa)).status, (await orderRow(db, online)).status], ['cancelled', 'expired']);
    assertEquals(await teeStock(db), before);

    // A second run does nothing at all.
    const snapshot = JSON.stringify([await rows(db, 'select to_jsonb(o) as r from public.orders o order by id'), await rows(db, 'select id, stock from public.product_variants order by id')]);
    await expireDue(db);
    await expireDue(db);
    assertEquals(JSON.stringify([await rows(db, 'select to_jsonb(o) as r from public.orders o order by id'), await rows(db, 'select id, stock from public.product_variants order by id')]), snapshot);
    assertEquals(await teeStock(db), before);
    // And expire_one_order on a finished order skips it.
    assertEquals(await expireOne(db, wa), 'skipped');
    assertEquals(await teeStock(db), before);
  });
});

Deno.test('expiry: not-yet-due, NULL expires_at, paid and other statuses are untouched; the seeded old order stays pending', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const mk = async (opts: unknown = {}) => (await placeV3(db, newId(), ORDER_2_TEES, opts)).order.id;
    const notDue = await mk();
    const notDueOnline = await mk({ paymentMethod: 'online' });
    const nullExpiry = await mk();
    await setExpiry(db, nullExpiry, 'null');
    const paid = await mk();
    await setStatus(db, paid, 'paid', 'pending');
    const packed = await mk();
    await setStatus(db, packed, 'paid');
    await setStatus(db, packed, 'packed');
    // Past dates forced on orders whose status says they are not waiting.
    await setExpiry(db, paid, `now() - interval '1 day'`);
    await setExpiry(db, packed, `now() - interval '1 day'`);
    const cancelled = await mk();
    await cancelV2(db, cancelled);
    await setExpiry(db, cancelled, `now() - interval '1 day'`);
    await setExpiry(db, notDue, `now() + interval '1 minute'`);
    await setExpiry(db, notDueOnline, `now() + interval '1 minute'`);

    const before = JSON.stringify(await rows(db, 'select to_jsonb(o) as r from public.orders o order by id'));
    const stock = await teeStock(db);
    await expireDue(db);
    assertEquals(JSON.stringify(await rows(db, 'select to_jsonb(o) as r from public.orders o order by id')), before);
    assertEquals(await teeStock(db), stock);
    assertEquals((await orderRow(db, OLD_ORDER_ID)).status, 'pending');
    assertEquals((await orderRow(db, OLD_ORDER_ID)).expires_at, null);
    for (const id of [notDue, notDueOnline, nullExpiry, paid, packed, cancelled, OLD_ORDER_ID]) assertEquals(await expireOne(db, id), 'skipped');
    assertEquals(await expireOne(db, newId()), 'skipped');
    assertEquals((await orderRow(db, paid)).status, 'paid');
  });
});

Deno.test('expiry: expire_one_order returns the new status', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const wa = (await placeV3(db, newId(), ORDER_2_TEES, {})).order.id;
    const online = (await placeV3(db, newId(), ORDER_2_TEES, { paymentMethod: 'online' })).order.id;
    assertEquals(await expireOne(db, wa), 'skipped'); // not due
    await setExpiry(db, wa, 'now()');
    await setExpiry(db, online, 'now()');
    assertEquals(await expireOne(db, wa), 'cancelled');
    assertEquals(await expireOne(db, online), 'expired');
    assertEquals(await expireOne(db, online), 'skipped');
  });
});

Deno.test('expiry: one order that fails does not stop the others', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const before = await teeStock(db);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await placeV3(db, newId(), ORDER_2_TEES, i % 2 ? { paymentMethod: 'online' } : {})).order.id);
    // The earliest due order is the one that fails, so the others come after it.
    for (const [i, id] of ids.entries()) await setExpiry(db, id, `now() - interval '${10 - i} minutes'`);
    const bad = ids[0];
    await db.exec(`
      create function public.test_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
      create trigger test_boom before update on public.orders for each row
        when (new.id = '${bad}' and new.status in ('cancelled', 'expired')) execute function public.test_boom();
    `);
    await expireDue(db); // does not throw
    assertEquals((await orderRow(db, bad)).status, 'pending');
    assertEquals(await Promise.all(ids.slice(1).map(async (id) => (await orderRow(db, id)).status)), ['expired', 'cancelled', 'expired']);
    // The failed order's own work rolled back: its stock is still held; the three others are back.
    assertEquals(await teeStock(db), before - 2);
    // Once the fault is gone the next run finishes it, and nothing is returned twice.
    await db.exec('drop trigger test_boom on public.orders');
    await expireDue(db);
    assertEquals((await orderRow(db, bad)).status, 'cancelled');
    assertEquals(await teeStock(db), before);
  });
});

Deno.test('expiry: expire_due_orders also deletes rate-limit rows older than an hour, for every address', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    for (const ip of [IP_A, IP_B]) for (let i = 0; i < 2; i++) await placeFrom(db, ip);
    await db.exec(`update public.order_ip_log set created_at = now() - interval '61 minutes' where ctid in (select ctid from public.order_ip_log order by ctid limit 3)`);
    assertEquals(await logCount(db), 4);
    await expireDue(db);
    assertEquals(await logCount(db), 1);
    assertEquals((await rows(db, `select count(*)::int as n from public.order_ip_log where created_at < now() - interval '1 hour'`))[0].n, 0);
  });
});

Deno.test('expiry: a payment after the order expired still goes through the late path', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const id = await startedOnline(db);
    const before = await teeStock(db);
    await setExpiry(db, id, `now() - interval '1 minute'`);
    await expireDue(db);
    assertEquals((await orderRow(db, id)).status, 'expired');
    assertEquals(await teeStock(db), before + 2);
    const paid = await record(db, id, 58500);
    assertEquals(paid, { ok: true, changed: true, outcome: 'paid_late' });
    const row = await orderRow(db, id);
    assertEquals([row.status, row.expires_at, row.payment_flag], ['paid', null, null]);
    assertEquals(await teeStock(db), before);
    await expireDue(db);
    assertEquals((await orderRow(db, id)).status, 'paid');
  });
});

Deno.test('expiry: expire_due_orders is a procedure that runs with call; expire_one_order is a security definer function', async () => {
  await withDb(async (db) => {
    const info = async (sig: string) =>
      (await rows(db, `select prokind, prosecdef, proconfig, pg_get_functiondef(oid) as def from pg_proc where oid = $1::regprocedure`, [sig]))[0];
    const proc = await info('public.expire_due_orders()');
    assertEquals([proc.prokind, proc.prosecdef, proc.proconfig], ['p', false, null]);
    assert(/\bcommit\b/i.test(proc.def));
    assert(/exception\s+when others/i.test(proc.def));
    const one = await info('public.expire_one_order(uuid)');
    assertEquals([one.prokind, one.prosecdef], ['f', true]);
    assert(!/\bcommit\b/i.test(one.def.replace(/--.*$/gm, '')));
    await db.exec('call public.expire_due_orders()');
  });
});

Deno.test('expiry grants: expire_one_order is service_role only; expire_due_orders is not executable by anon or authenticated', async () => {
  await withDb(async (db) => {
    const publicCan = async (sig: string) =>
      (await rows(db, `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as ok`, [sig]))[0].ok;
    const can = async (role: string, sig: string) =>
      (await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]))[0].ok;
    const one = 'public.expire_one_order(uuid)';
    const many = 'public.expire_due_orders()';
    for (const sig of [one, many]) {
      assertEquals(await publicCan(sig), false, `public ${sig}`);
      assertEquals(await can('anon', sig), false, `anon ${sig}`);
      assertEquals(await can('authenticated', sig), false, `authenticated ${sig}`);
    }
    assertEquals(await can('service_role', one), true);
    // anon and authenticated cannot call it for real, either.
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await assertRejects(() => db.exec('call public.expire_due_orders()'), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.expire_one_order($1::uuid)`, [newId()]), Error, 'permission denied');
      } finally {
        await db.exec('reset role');
      }
    }
  });
});

Deno.test('cron migration: schedules expire-orders every 5 minutes, is not loaded by these tests, and no other migration schedules', async () => {
  const CRON = '20261030140000_order_expiry_cron.sql';
  const text = await readMigration(CRON);
  assert(text.includes(`'expire-orders'`));
  assert(text.includes(`'*/5 * * * *'`));
  assert(text.includes('$$call public.expire_due_orders()$$'));
  assert(/create extension if not exists pg_cron/i.test(text));
  assertEquals(LATER_MIGRATIONS.includes(CRON), false);
  const names: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) if (e.isFile && e.name.endsWith('.sql')) names.push(e.name);
  assert(names.includes(CRON));
  for (const name of names.filter((n) => n !== CRON)) {
    assert(!(await readMigration(name)).includes('cron.schedule'), `${name} mentions cron.schedule`);
  }
});


// ---------------------------------------------------------------------------
// 20261031100000_order_fulfilment.sql: cancelled -> refunded, set_order_tracking, extend_order,
// lookup_order and order_lookup_log.
// ---------------------------------------------------------------------------
Deno.test('refund_due: cancelled -> refunded is allowed only with the flag, which it clears; nothing else changes', async () => {
  await withDb(async (db) => {
    const tee = await findVariant(db, '1', 'M', 'Red');
    await setStock(db, tee.id, 20);
    // The whole pair table, with the flag set on every order: only cancelled -> refunded is new.
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const label = `${from} -> ${to} (refund_due)`;
        const id = await insertOrder(db, from, { payment_flag: 'refund_due', expires_at: DUE });
        const r = await setStatus(db, id, to);
        const row = await orderRow(db, id);
        if (from === to) {
          assertEquals([r.ok, r.changed], [true, false], label);
          assertEquals(row.payment_flag, 'refund_due', label);
        } else if (isAllowed(from, to) || (from === 'cancelled' && to === 'refunded')) {
          assertEquals([r.ok, r.changed, row.status], [true, true, to], label);
          // The flag is cleared by any move to refunded, and kept by the other moves.
          assertEquals(row.payment_flag, to === 'refunded' ? null : 'refund_due', label);
          assertEquals(r.order.paymentFlag, to === 'refunded' ? null : 'refund_due', label);
        } else {
          assertEquals([r.ok, r.reason, row.status, row.payment_flag], [false, 'bad_transition', from, 'refund_due'], label);
        }
      }
    }

    // Without the flag, or with the other flag, a cancelled order cannot be refunded.
    for (const flag of [null, 'amount_mismatch']) {
      const id = await insertOrder(db, 'cancelled', { payment_flag: flag });
      const r = await setStatus(db, id, 'refunded');
      assertEquals([r.ok, r.reason, r.from, r.to], [false, 'bad_transition', 'cancelled', 'refunded'], String(flag));
      assertEquals((await orderRow(db, id)).status, 'cancelled');
      assertEquals((await orderRow(db, id)).payment_flag, flag);
    }

    // p_from is honoured, and the stock does not move.
    await setStock(db, tee.id, 20);
    const id = await insertOrder(db, 'cancelled', { payment_flag: 'refund_due' });
    const wrong = await setStatus(db, id, 'refunded', 'expired');
    assertEquals([wrong.ok, wrong.reason], [false, 'bad_transition']);
    assertEquals((await orderRow(db, id)).status, 'cancelled');
    const ok = await setStatus(db, id, 'refunded', 'cancelled');
    assertEquals([ok.ok, ok.changed, ok.order.status, ok.order.paymentFlag], [true, true, 'refunded', null]);
    assertEquals((await findVariant(db, '1', 'M', 'Red')).stock, 20);
    // Refunded stays final, and another refund is a no-op.
    assertEquals((await setStatus(db, id, 'refunded')).changed, false);
    assertEquals((await setStatus(db, id, 'cancelled')).reason, 'bad_transition');

    // An amount_mismatch flag survives a refund of a paid order.
    const mism = await insertOrder(db, 'paid', { payment_flag: 'amount_mismatch' });
    assertEquals((await setStatus(db, mism, 'refunded')).changed, true);
    assertEquals((await orderRow(db, mism)).payment_flag, 'amount_mismatch');
  });
});

Deno.test('refund_due: a late payment with no stock left, then the refund, through the real functions', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const id = await startedOnline(db);
    assertEquals((await setStatus(db, id, 'cancelled')).changed, true);
    await db.exec(`update public.product_variants set stock = 0 where product_id = '1' and size = 'M' and color = 'Red'`);
    assertEquals((await record(db, id, 58500)).outcome, 'refund_due');
    let row = await orderRow(db, id);
    assertEquals([row.status, row.payment_flag], ['cancelled', 'refund_due']);
    // cancel_order_v2 leaves it alone.
    assertEquals((await cancelV2(db, id)).status, 'cancelled');
    assertEquals(await teeM(db), 0);

    const r = await setStatus(db, id, 'refunded');
    assertEquals([r.ok, r.changed, r.order.status, r.order.paymentFlag], [true, true, 'refunded', null]);
    row = await orderRow(db, id);
    assertEquals([row.status, row.payment_flag, row.expires_at], ['refunded', null, null]);
    assertEquals(await teeM(db), 0); // refunding does not return stock
    // A repeated payment event changes nothing.
    assertEquals((await record(db, id, 58500)).outcome, 'already');
  });
});

const setTracking = (db: Db, id: string, t: unknown) => call(db, 'public.set_order_tracking($1::uuid, $2::jsonb)', id, j(t));
const trackingRow = async (db: Db, id: string) => {
  const r = await orderRow(db, id);
  return [r.tracking_courier, r.tracking_number, r.tracking_url];
};

Deno.test('set_order_tracking: packed and shipped only; trims, keeps missing keys and clears empty ones', async () => {
  await withDb(async (db) => {
    for (const status of STATUSES) {
      const id = await insertOrder(db, status);
      const r = await setTracking(db, id, { courier: 'Courier Guy', number: 'T1', url: 'https://t.example/T1' });
      if (status === 'packed' || status === 'shipped') {
        assertEquals(r.ok, true, status);
        assertEquals(Object.keys(r).sort(), ['ok', 'order']);
        assertEquals(r.order.tracking, { courier: 'Courier Guy', number: 'T1', url: 'https://t.example/T1' }, status);
        assertEquals(r.order.status, status);
      } else {
        assertEquals([r.ok, r.reason, r.order.status], [false, 'bad_status', status], status);
        assertEquals(await trackingRow(db, id), [null, null, null], status);
      }
    }
    assertEquals(await setTracking(db, newId(), { number: 'x' }), { ok: false, reason: 'not_found' });

    const id = await insertOrder(db, 'packed');
    await setTracking(db, id, { courier: '  Aramex  ', number: ' 123 ', url: ' https://a.example/1 ' });
    assertEquals(await trackingRow(db, id), ['Aramex', '123', 'https://a.example/1']);
    // A missing key keeps the stored value.
    await setTracking(db, id, { number: '456' });
    assertEquals(await trackingRow(db, id), ['Aramex', '456', 'https://a.example/1']);
    // An empty string or null clears it.
    await setTracking(db, id, { courier: '', url: null });
    assertEquals(await trackingRow(db, id), [null, '456', null]);
    const none = await setTracking(db, id, { number: '   ' });
    assertEquals(none.order.tracking, null);
    assertEquals(await trackingRow(db, id), [null, null, null]);
    // The status is untouched, and a non-object does nothing.
    assertEquals((await setTracking(db, id, 'nope')).ok, true);
    assertEquals((await orderRow(db, id)).status, 'packed');
  });
});

Deno.test('extend_order: a waiting pending order gets greatest(expires_at, now) + 48 hours; other orders are refused', async () => {
  await withDb(async (db) => {
    const secs = async (id: string, from: string) =>
      Number((await rows(db, `select extract(epoch from (expires_at - ${from}))::int as s from public.orders where id = $1`, [id]))[0].s);
    const HOURS_48 = 48 * 3600;
    const approx = (n: number, want: number, label: string) => assert(Math.abs(n - want) <= 5, `${label}: ${n} vs ${want}`);

    // Time left: 48 hours are added to the old expiry.
    const left = await insertOrder(db, 'pending', { expires_at: '2030-01-01T00:00:00+00' });
    const a = await call(db, 'public.extend_order($1::uuid)', left);
    assertEquals([a.ok, a.order.status], [true, 'pending']);
    assertEquals(await secs(left, `timestamptz '2030-01-01T00:00:00+00'`), HOURS_48);
    await call(db, 'public.extend_order($1::uuid)', left);
    assertEquals(await secs(left, `timestamptz '2030-01-01T00:00:00+00'`), 2 * HOURS_48);

    // Time already up (the job has not run yet): 48 hours from now.
    const late = await insertOrder(db, 'pending', { expires_at: '2020-01-01T00:00:00+00' });
    const b = await call(db, 'public.extend_order($1::uuid)', late);
    approx(await secs(late, 'now()'), HOURS_48, 'late order');
    assertEquals(b.ok, true);
    assertEquals(Date.parse(b.order.expiresAt) > Date.now() + 47 * 3600 * 1000, true);
    // And the expiry job leaves it alone now.
    await expireDue(db);
    assertEquals((await orderRow(db, late)).status, 'pending');

    // Everything else is refused and unchanged.
    for (const status of STATUSES.filter((s) => s !== 'pending')) {
      const id = await insertOrder(db, status, { expires_at: DUE });
      const r = await call(db, 'public.extend_order($1::uuid)', id);
      assertEquals([r.ok, r.reason, r.order.status], [false, 'not_extendable', status], status);
      assertEquals(await secs(id, `timestamptz '${DUE}'`), 0, status);
    }
    const noExpiry = await insertOrder(db, 'pending'); // an order from before expiry existed
    const r = await call(db, 'public.extend_order($1::uuid)', noExpiry);
    assertEquals([r.ok, r.reason], [false, 'not_extendable']);
    assertEquals((await orderRow(db, noExpiry)).expires_at, null);
    assertEquals(await call(db, 'public.extend_order($1::uuid)', newId()), { ok: false, reason: 'not_found' });
  });
});

const lookup = (db: Db, ref: unknown, phone: unknown, ip: unknown = null) =>
  call(db, 'public.lookup_order($1, $2, $3)', ref, phone, ip);
const lookupLogCount = async (db: Db): Promise<number> =>
  (await rows(db, 'select count(*)::int as n from public.order_lookup_log'))[0].n;
const NOT_FOUND = { ok: false, reason: 'not_found' };
const LOOKUP_IP = '198.51.100.20';

/** An order whose ref and phone we choose (insertOrder gives ref LIFECYCL, phone '0'). */
const orderFor = (db: Db, ref: string, phone: string, extra: Record<string, unknown> = {}) =>
  insertOrder(db, 'pending', { ref, customer: j({ name: 'Thandi', phone }), ...extra });

Deno.test('lookup_order: ref in any case, phone by its last 9 digits in any format; every miss is the same answer', async () => {
  await withDb(async (db) => {
    const id = await orderFor(db, 'ABCD1234', '082 123 4567');
    const hit = { ok: true, id };
    for (const phone of ['0821234567', '+27821234567', '+27 82 123 4567', '27821234567', '(082) 123-4567', '821234567', ' 082 123 4567 ']) {
      assertEquals(await lookup(db, 'ABCD1234', phone), hit, phone);
    }
    for (const ref of ['abcd1234', 'AbCd1234', ' ABCD1234 ']) assertEquals(await lookup(db, ref, '0821234567'), hit, ref);

    // Wrong ref and wrong phone (the last 9 digits differ) are the same answer, as are malformed inputs.
    assertEquals(await lookup(db, 'ABCD1235', '0821234567'), NOT_FOUND);
    assertEquals(await lookup(db, 'ABCD1234', '0821234568'), NOT_FOUND);
    assertEquals(await lookup(db, 'ABCD1234', '0711234567'), NOT_FOUND);
    for (const [ref, phone] of [['', ''], ['ABCD123', '0821234567'], ['ABCD12345', '0821234567'], ['ABCD1234', ''], ['ABCD1234', '12345'], ['ABCD1234', 'phone'], [null, null]]) {
      assertEquals(await lookup(db, ref, phone), NOT_FOUND, `${ref} / ${phone}`);
    }
    // Fewer digits than the stored phone's last 9 never match by accident.
    assertEquals(await lookup(db, 'ABCD1234', '1234567'), NOT_FOUND);
    assertEquals(await lookup(db, 'ABCD1234', '21234567'), NOT_FOUND);
    // Any status can be found, and the seeded old order too.
    assertEquals((await lookup(db, 'ABCD1234', '0820000000')).ok, true);

    // Two orders with the same ref and phone: the newest.
    const older = await orderFor(db, 'DUPE0001', '0829999999', { created_at: '2026-01-01T00:00:00+00' });
    const newer = await orderFor(db, 'DUPE0001', '+27829999999', { created_at: '2026-02-01T00:00:00+00' });
    assert(older !== newer);
    assertEquals(await lookup(db, 'dupe0001', '0829999999'), { ok: true, id: newer });
  });
});

Deno.test('lookup_order: 10 lookups per address in a rolling hour, the 11th is rate_limited; found or not, all count', async () => {
  await withDb(async (db) => {
    const id = await orderFor(db, 'ABCD1234', '0821234567');
    for (let i = 0; i < 10; i++) {
      const r = await lookup(db, 'ABCD1234', i % 2 === 0 ? '0821234567' : '0000000000', LOOKUP_IP);
      assertEquals(r, i % 2 === 0 ? { ok: true, id } : NOT_FOUND, `lookup ${i + 1}`);
    }
    assertEquals(await lookupLogCount(db), 10);
    // The 11th is refused even with the right answer, and a refused one is not logged.
    assertEquals(await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP), { ok: false, reason: 'rate_limited' });
    assertEquals(await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP), { ok: false, reason: 'rate_limited' });
    assertEquals(await lookupLogCount(db), 10);
    // Another address, in either family, is independent.
    assertEquals(await lookup(db, 'ABCD1234', '0821234567', '198.51.100.21'), { ok: true, id });
    assertEquals(await lookup(db, 'ABCD1234', '0821234567', '2001:db8::17'), { ok: true, id });
    assertEquals(await lookupLogCount(db), 12);
    // The order limit is a separate counter.
    assertEquals(await logCount(db), 0);
  });
});

Deno.test('lookup_order: the hour rolls; no ip, a blank ip never blocks and logs nothing', async () => {
  await withDb(async (db) => {
    const id = await orderFor(db, 'ABCD1234', '0821234567');
    for (let i = 0; i < 10; i++) await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP);
    assertEquals((await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP)).reason, 'rate_limited');
    // Four of the ten are older than an hour: four more are allowed, the fifth is not.
    await db.exec(`update public.order_lookup_log set created_at = now() - interval '61 minutes'
                   where ctid in (select ctid from public.order_lookup_log order by ctid limit 4)`);
    for (let i = 0; i < 4; i++) assertEquals((await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP)).ok, true, `after the window ${i}`);
    assertEquals((await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP)).reason, 'rate_limited');
    assertEquals(await lookupLogCount(db), 10); // the stale rows were deleted
    // A row just inside the hour still counts.
    await db.exec(`update public.order_lookup_log set created_at = now() - interval '59 minutes'`);
    assertEquals((await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP)).reason, 'rate_limited');

    // Stale rows of other addresses are cleaned up by any limited lookup.
    await db.exec(`update public.order_lookup_log set created_at = now() - interval '3 hours'`);
    assertEquals((await lookup(db, 'ABCD1234', '0821234567', '198.51.100.99')).ok, true);
    assertEquals(await lookupLogCount(db), 1);

    // No address, no limit.
    const before = await lookupLogCount(db);
    for (const ip of [null, '', '   ']) {
      for (let i = 0; i < 15; i++) assertEquals(await lookup(db, 'ABCD1234', '0821234567', ip), { ok: true, id }, `ip ${JSON.stringify(ip)}`);
    }
    assertEquals(await lookupLogCount(db), before);
  });
});

Deno.test('lookup_order: the log holds only a salted hash of the address, the table is locked down, and the function is service_role only', async () => {
  await withDb(async (db) => {
    await orderFor(db, 'ABCD1234', '0821234567');
    await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP);
    await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP);
    const log = await rows(db, 'select * from public.order_lookup_log');
    assertEquals(log.length, 2);
    assertEquals(Object.keys(log[0]).sort(), ['created_at', 'ip_hash']);
    assertEquals(log[0].ip_hash, log[1].ip_hash);
    assert(/^[0-9a-f]{64}$/.test(log[0].ip_hash));
    assert(!JSON.stringify(log).includes(LOOKUP_IP));
    const salt = (await rows(db, 'select salt from public.order_rate_salt'))[0].salt as string;
    const expected = (await rows(db, `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`, [salt + LOOKUP_IP]))[0].h;
    assertEquals(log[0].ip_hash, expected);
    // The same address hashes differently in the order log's key space only by the lock prefix, never by table:
    // the order limit does not see these rows.
    assertEquals(await logCount(db), 0);

    assertEquals((await rows(db, `select relrowsecurity as rls from pg_class where oid = 'public.order_lookup_log'::regclass`))[0].rls, true);
    assertEquals((await rows(db, `select count(*)::int as n from pg_policies where tablename = 'order_lookup_log'`))[0].n, 0);
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        assertEquals(
          (await rows(db, `select has_table_privilege($1, 'public.order_lookup_log', $2) as ok`, [role, priv]))[0].ok,
          false,
          `${role} ${priv}`,
        );
      }
    }
    const sigs = [
      'public.set_order_status(uuid, text, text)',
      'public.set_order_tracking(uuid, jsonb)',
      'public.extend_order(uuid)',
      'public.lookup_order(text, text, text)',
    ];
    for (const sig of sigs) {
      for (const role of ['anon', 'authenticated']) {
        assertEquals((await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]))[0].ok, false, `${role} ${sig}`);
      }
      assertEquals((await rows(db, `select has_function_privilege('service_role', $1, 'execute') as ok`, [sig]))[0].ok, true, sig);
    }
    const acl = await rows(
      db,
      `select p.proname, p.proacl::text as acl, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('set_order_tracking', 'extend_order', 'lookup_order')`,
    );
    assertEquals(acl.length, 3);
    for (const a of acl) {
      assertEquals(a.prosecdef, true, a.proname);
      assertEquals((a.acl as string).replace(/^\{|\}$/g, '').split(',').some((e) => e.startsWith('=')), false, `${a.proname} acl ${a.acl}`);
      assert(a.acl.includes('service_role=X'), `${a.proname} acl ${a.acl}`);
    }
    const id = await orderFor(db, 'ZZZZ0001', '0821234567');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await assertRejects(() => lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP), Error, 'permission denied');
        await assertRejects(() => call(db, 'public.extend_order($1::uuid)', id), Error, 'permission denied');
        await assertRejects(() => setTracking(db, id, { number: '1' }), Error, 'permission denied');
        await assertRejects(() => db.query('select * from public.order_lookup_log'), Error, 'permission denied');
      } finally {
        await db.exec('reset role');
      }
    }
    await db.exec('set role service_role');
    try {
      assertEquals((await lookup(db, 'ZZZZ0001', '0821234567')).ok, true);
    } finally {
      await db.exec('reset role');
    }
  });
});

Deno.test('lookup_order: takes no order lock, only the per-address advisory lock; the tracking and extend functions lock one order row', async () => {
  const text = await readMigration('20261031100000_order_fulfilment.sql');
  const body = (fn: string) => {
    const start = text.indexOf(`create or replace function public.${fn}(`);
    assert(start >= 0, fn);
    return text.slice(start, text.indexOf('\n$$;', start));
  };
  assert(!/for update(?! skip locked)/.test(body('lookup_order')));
  assert(body('lookup_order').includes('pg_advisory_xact_lock'));
  for (const fn of ['set_order_tracking', 'extend_order']) {
    assertEquals(body(fn).match(/for update/g)?.length, 1, fn);
    assert(!body(fn).includes('product_variants'), fn);
  }
});

Deno.test('fulfilment migration is idempotent: a second run changes nothing and keeps the data', async () => {
  await withDb(async (db) => {
    const sql = await readMigration('20261031100000_order_fulfilment.sql');
    const dump = async () => ({
      orders: await rows(db, 'select to_jsonb(o) as r from public.orders o order by o.id'),
      log: await rows(db, 'select * from public.order_lookup_log order by ip_hash, created_at'),
      salt: await rows(db, 'select * from public.order_rate_salt'),
      indexes: await rows(db, `select indexname, indexdef from pg_indexes where tablename = 'order_lookup_log' order by indexname`),
      functions: await rows(
        db,
        `select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, p.proacl::text as acl
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('set_order_status', 'set_order_tracking', 'extend_order', 'lookup_order')
         order by sig`,
      ),
    });
    await orderFor(db, 'ABCD1234', '0821234567');
    await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP);
    const first = await dump();
    assertEquals(first.functions.length, 4);
    assertEquals(first.log.length, 1);
    await db.exec(sql);
    assertEquals(await dump(), first);
    for (let i = 0; i < 9; i++) await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP);
    assertEquals((await lookup(db, 'ABCD1234', '0821234567', LOOKUP_IP)).reason, 'rate_limited');
  });
});

// ---------------------------------------------------------------------------
// 20261031110000_payment_links.sql: set_payment_window
// ---------------------------------------------------------------------------
const setWindow = (db: Db, id: string, hours: unknown) => call(db, 'public.set_payment_window($1::uuid, $2::int)', id, hours);

Deno.test('set_payment_window: an awaiting_payment order gets now + p_hours, stock and status untouched; the expiry job honours it', async () => {
  await withDb(async (db) => {
    await plentyOfTees(db);
    const secsFromNow = async (id: string) =>
      Number((await rows(db, `select extract(epoch from (expires_at - now()))::int as s from public.orders where id = $1`, [id]))[0].s);
    const near = (n: number, want: number, label: string) => assert(Math.abs(n - want) <= 5, `${label}: ${n} vs ${want}`);

    const id = newId();
    const placed = await placeV3(db, id, ORDER_2_TEES, { paymentMethod: 'online', delivery: { method: 'door', address: ADDR } }, EMAIL_CUSTOMER);
    near(await secsFromNow(id), 30 * 60, 'checkout window');
    const stock = await teeM(db);

    const r = await setWindow(db, id, 48);
    assertEquals(Object.keys(r).sort(), ['ok', 'order']);
    assertEquals([r.ok, r.order.status, r.order.id], [true, 'awaiting_payment', id]);
    near(await secsFromNow(id), 48 * 3600, '48 hours');
    assert(Date.parse(r.order.expiresAt) > Date.now() + 47 * 3600 * 1000);
    assertEquals(await teeM(db), stock);
    assertEquals({ ...r.order, expiresAt: null }, { ...placed.order, expiresAt: null }); // nothing else changed
    // It sets now + p_hours each time it is called (the caller makes sure it calls once).
    await setWindow(db, id, 1);
    near(await secsFromNow(id), 3600, '1 hour');
    await setWindow(db, id, 720);
    near(await secsFromNow(id), 720 * 3600, '720 hours');

    // The job leaves an order inside its window alone, and expires it, returning stock, when the window is up.
    await setWindow(db, id, 48);
    await expireDue(db);
    assertEquals((await orderRow(db, id)).status, 'awaiting_payment');
    await setExpiry(db, id, `now() - interval '1 minute'`);
    await expireDue(db);
    assertEquals((await orderRow(db, id)).status, 'expired');
    assertEquals(await teeM(db), stock + 2);
  });
});

Deno.test('set_payment_window: every status but awaiting_payment is refused and unchanged; unknown id; p_hours outside 1 to 720 raises', async () => {
  await withDb(async (db) => {
    for (const status of STATUSES.filter((s) => s !== 'awaiting_payment')) {
      for (const expires_at of [null, DUE]) {
        const id = await insertOrder(db, status, { expires_at });
        const before = await orderRow(db, id);
        const r = await setWindow(db, id, 48);
        assertEquals([r.ok, r.reason, r.order.status], [false, 'bad_status', status], status);
        assertEquals(await orderRow(db, id), before, status); // the whole row, expiry included
      }
    }
    assertEquals(await setWindow(db, newId(), 48), { ok: false, reason: 'not_found' });

    const secsFromDue = async (id: string) =>
      Number((await rows(db, `select extract(epoch from (expires_at - timestamptz '${DUE}'))::int as s from public.orders where id = $1`, [id]))[0].s);
    const id = await insertOrder(db, 'awaiting_payment', { expires_at: DUE });
    for (const bad of [0, -1, 721, null]) {
      await assertRejects(() => setWindow(db, id, bad), Error, 'p_hours must be between 1 and 720');
    }
    assertEquals(await secsFromDue(id), 0);
    assertEquals((await setWindow(db, id, 1)).ok, true);
  });
});

Deno.test('set_payment_window: service role only, security definer, locks the order row and nothing else', async () => {
  await withDb(async (db) => {
    const acl = await rows(
      db,
      `select p.proname, p.prosecdef, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'set_payment_window'`,
    );
    assertEquals(acl.length, 1);
    assertEquals(acl[0].prosecdef, true);
    assertEquals((acl[0].acl as string).replace(/^\{|\}$/g, '').split(',').some((e) => e.startsWith('=')), false, acl[0].acl);
    assert(acl[0].acl.includes('service_role=X'), acl[0].acl);
    const id = await insertOrder(db, 'awaiting_payment', { expires_at: DUE });
    for (const role of ['anon', 'authenticated']) {
      assertEquals(
        (await rows(db, `select has_function_privilege($1, 'public.set_payment_window(uuid, int)', 'execute') as ok`, [role]))[0].ok,
        false,
        role,
      );
      await db.exec(`set role ${role}`);
      try {
        await assertRejects(() => setWindow(db, id, 48), Error, 'permission denied');
      } finally {
        await db.exec('reset role');
      }
    }
    await db.exec('set role service_role');
    try {
      assertEquals((await setWindow(db, id, 48)).ok, true);
    } finally {
      await db.exec('reset role');
    }
  });
  const text = await readMigration('20261031110000_payment_links.sql');
  const start = text.indexOf('create or replace function public.set_payment_window(');
  assert(start >= 0);
  const body = text.slice(start, text.indexOf('\n$$;', start));
  assertEquals(body.match(/for update/g)?.length, 1);
  assert(!body.includes('product_variants'));
});

Deno.test('payment links migration is idempotent: a second run changes nothing and keeps the data', async () => {
  await withDb(async (db) => {
    const sql = await readMigration('20261031110000_payment_links.sql');
    const dump = async () => ({
      orders: await rows(db, 'select to_jsonb(o) as r from public.orders o order by o.id'),
      functions: await rows(
        db,
        `select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, p.proacl::text as acl
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'set_payment_window' order by sig`,
      ),
    });
    const id = await insertOrder(db, 'awaiting_payment', { expires_at: DUE });
    await setWindow(db, id, 48);
    const first = await dump();
    assertEquals(first.functions.length, 1);
    await db.exec(sql);
    assertEquals(await dump(), first);
  });
});

// ---------------------------------------------------------------------------
// Close the shared databases once everything else has run.
// ---------------------------------------------------------------------------
Deno.test('teardown', async () => {
  if (postDb) await (await postDb).close();
  if (catalogueDb) await (await catalogueDb).close();
  if (preDb) await (await preDb).close();
});
