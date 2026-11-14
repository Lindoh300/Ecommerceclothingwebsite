// Tests for supabase/migrations/20261031190000_discounts.sql (discount codes), run against an in-process Postgres (PGlite)
// with every migration before it applied. Run with `deno task test:sql` from supabase/functions/server. The memory
// store in dev.ts mirrors these rules and is tested in supabase/functions/server/discounts.test.ts.
//
// PGlite is ONE connection, so these tests cannot show real races between concurrent transactions. "The last use cannot
// be spent twice" is tested here as the sequential case (the second order sees uses = max_uses and is refused); the
// concurrent case is tested against the memory store, and in Postgres it rests on the row lock place_order_v4 takes on
// the code row (the last lock, see the migration header).
import { assert, assertEquals, assertRejects } from '@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.13';
import { pgcrypto } from 'npm:@electric-sql/pglite@0.5.13/contrib/pgcrypto';

// deno-lint-ignore no-explicit-any
type Json = any;
type Db = Awaited<ReturnType<PGlite['clone']>>;

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const readMigration = (name: string) => Deno.readTextFile(new URL(name, MIGRATIONS));
const DISCOUNTS_MIGRATION = '20261031190000_discounts.sql';
// Every migration before the discounts one, in order. The pg_cron migration is never loaded: PGlite has no pg_cron.
const BEFORE = [
  '20261021000000_init.sql',
  '20261022000000_orders.sql',
  '20261029000000_update_product.sql',
  '20261030000000_catalogue.sql',
  '20261030100000_order_lifecycle.sql',
  '20261030110000_delivery.sql',
  '20261030120000_payments.sql',
  '20261030130000_place_order_v3.sql',
  '20261031100000_order_fulfilment.sql',
  '20261031110000_payment_links.sql',
  '20261031120000_events.sql',
  '20261031130000_community.sql',
  '20261031140000_unsubscribe.sql',
  '20261031150000_restock_alerts.sql',
  '20261031160000_list_sends.sql',
  '20261031170000_delivery_admin.sql',
  '20261031180000_customers.sql',
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

let beforeDb: Promise<Db> | undefined;
let afterDb: Promise<Db> | undefined;
let functionsBefore: Promise<Json[]> | undefined;

function before(): Promise<Db> {
  beforeDb ??= (async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(SUPABASE_ROLES_SQL);
    for (const f of BEFORE) await db.exec(await readMigration(f));
    return db;
  })();
  return beforeDb;
}

const functionDefs = (db: Db): Promise<Json[]> =>
  rows(
    db,
    `select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, p.proacl::text as acl
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' order by sig`,
  );

/** `before` plus the discounts migration, applied once. */
function after(): Promise<Db> {
  afterDb ??= (async () => {
    const base = await before();
    functionsBefore = functionDefs(base);
    const db = await base.clone();
    await db.exec(await readMigration(DISCOUNTS_MIGRATION));
    return db;
  })();
  return afterDb;
}

/** Run a test body on a private copy of the migrated database. */
async function withDb(body: (db: Db) => Promise<void>): Promise<void> {
  const db = await (await after()).clone();
  try {
    await body(db);
  } finally {
    await db.close();
  }
}

async function rows(db: Db, sql: string, params: unknown[] = []): Promise<Json[]> {
  return (await db.query(sql, params)).rows as Json[];
}

async function call(db: Db, expr: string, ...params: unknown[]): Promise<Json> {
  return ((await db.query(`select ${expr} as r`, params)).rows[0] as Json).r;
}

const j = (v: unknown) => JSON.stringify(v);
const uuid = () => crypto.randomUUID();

// ---- fixtures ---------------------------------------------------------------------------------------------------------

const CUSTOMER = { name: 'Test', phone: '0821234567' };
const DOOR = {
  method: 'door',
  address: { line1: '12 Main Rd', suburb: 'Sea Point', city: 'Cape Town', postalCode: '8005' },
};

/** A product at R100 with 20 in stock (one variant). */
async function seed(db: Db): Promise<{ pid: string }> {
  await call(db, `public.upsert_category('tees', 'Tees', 0, true)`);
  const pid = uuid();
  const made = await call(db, 'public.create_product($1, $2::jsonb)', pid, j({
    name: 'Tee', category: 'tees', price: 100, description: '', images: [], sizes: ['M'], colors: ['Red'],
    variants: [{ size: 'M', color: 'Red', stock: 20 }],
  }));
  assert(made.ok, j(made));
  return { pid };
}

const stockOf = async (db: Db, pid: string): Promise<number> =>
  (await rows(db, `select sum(stock)::int as s from public.product_variants where product_id = $1`, [pid]))[0].s;
const count = async (db: Db, table: string): Promise<number> =>
  (await rows(db, `select count(*)::int as n from public.${table}`))[0].n;

const FUTURE = '2099-01-01T00:00:00Z';
const PAST = '2020-01-01T00:00:00Z';

/** Makes a code. `over` replaces any default. Returns the stored discount. */
async function makeCode(db: Db, over: Json = {}): Promise<Json> {
  const id = over.id ?? uuid();
  const r = await call(db, 'public.upsert_discount($1::uuid, $2::jsonb)', id, j({
    code: 'SAVE10', kind: 'percent', value: 10, minSpend: 0, expiresAt: null, maxUses: null, active: true, ...over,
  }));
  assert(r.ok, j(r));
  return r.discount;
}

const usesOf = async (db: Db, id: string): Promise<number> =>
  (await rows(db, `select uses from public.discount_codes where id = $1`, [id]))[0].uses;

interface Opts {
  code?: string;
  delivery?: Json;
  paymentMethod?: string;
  ip?: string;
}

const place4 = (db: Db, pid: string, id: string, qty: number, opts: Opts = {}): Promise<Json> =>
  call(
    db,
    'public.place_order_v4($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb)',
    id,
    j([{ productId: pid, size: 'M', color: 'Red', quantity: qty }]),
    j(CUSTOMER),
    j({
      ...(opts.delivery ? { delivery: opts.delivery } : {}),
      ...(opts.paymentMethod ? { paymentMethod: opts.paymentMethod } : {}),
      ...(opts.ip ? { ip: opts.ip } : {}),
      ...(opts.code !== undefined ? { discountCode: opts.code } : {}),
    }),
  );

const place3 = (db: Db, pid: string, id: string, qty: number, opts: Opts = {}): Promise<Json> =>
  call(
    db,
    'public.place_order_v3($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb)',
    id,
    j([{ productId: pid, size: 'M', color: 'Red', quantity: qty }]),
    j(CUSTOMER),
    j({
      ...(opts.delivery ? { delivery: opts.delivery } : {}),
      ...(opts.paymentMethod ? { paymentMethod: opts.paymentMethod } : {}),
      ...(opts.ip ? { ip: opts.ip } : {}),
    }),
  );

const status = async (db: Db, id: string): Promise<string> =>
  (await rows(db, `select status from public.orders where id = $1`, [id]))[0]?.status;

/** What a failed placement must leave untouched: stock, orders and the per-address log. */
async function snapshot(db: Db, pid: string) {
  return { stock: await stockOf(db, pid), orders: await count(db, 'orders'), ipLog: await count(db, 'order_ip_log') };
}

// ---- order_json -------------------------------------------------------------------------------------------------------

Deno.test('order_json: keeps every old key, gains discountCode (null) and discountAmount (0)', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const r = await place3(db, pid, uuid(), 1);
    assert(r.ok, j(r));
    assertEquals(Object.keys(r.order).sort(), [
      'createdAt', 'customer', 'delivery', 'deliveryFee', 'discountAmount', 'discountCode', 'expiresAt', 'id', 'lines',
      'paidAt', 'paymentFlag', 'paymentMethod', 'ref', 'status', 'total', 'tracking',
    ]);
    assertEquals(r.order.discountCode, null);
    assertEquals(r.order.discountAmount, 0);
  });
});

// ---- no code: v4 is v3 -------------------------------------------------------------------------------------------------

Deno.test('place_order_v4 with no code (missing, null, blank) gives the same order as place_order_v3', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const strip = (r: Json) => {
      const { id: _i, ref: _r, createdAt: _c, expiresAt: _e, ...rest } = r.order;
      return { ...r, order: rest };
    };
    for (const opts of [{ delivery: DOOR }, { paymentMethod: 'online' }, {}]) {
      const a = await place3(db, pid, uuid(), 2, opts);
      const b = await place4(db, pid, uuid(), 2, opts);
      assertEquals(strip(b), strip(a));
    }
    // A null or blank code is none.
    for (const code of [undefined, '', '   ']) {
      const r = await place4(db, pid, uuid(), 1, code === undefined ? {} : { code });
      assert(r.ok && r.created, j(r));
      assertEquals([r.order.discountCode, r.order.discountAmount, r.order.total], [null, 0, 100]);
    }
    const viaNull = await call(
      db,
      `public.place_order_v4($1::uuid, $2::jsonb, $3::jsonb, '{"discountCode": null}'::jsonb)`,
      uuid(),
      j([{ productId: pid, size: 'M', color: 'Red', quantity: 1 }]),
      j(CUSTOMER),
    );
    assert(viaNull.ok && viaNull.order.discountCode === null, j(viaNull));
    assertEquals(await count(db, 'discount_codes'), 0);
  });
});

Deno.test('place_order_v4 with no code keeps v3 failures: stock, missing, unknown delivery and the rate limit', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    assertEquals((await place4(db, pid, uuid(), 99)).reason, 'stock');
    assertEquals((await place4(db, pid, uuid(), 1, { delivery: { method: 'drone' } })).reason, 'unknown_delivery');
    for (let i = 0; i < 5; i++) assert((await place4(db, pid, uuid(), 1, { ip: '203.0.113.9' })).ok);
    assertEquals(await place4(db, pid, uuid(), 1, { ip: '203.0.113.9' }), { ok: false, reason: 'rate_limited' });
    assertEquals(await stockOf(db, pid), 15);
  });
});

// ---- the rule: discount_preview ----------------------------------------------------------------------------------------

Deno.test('discount_preview: percent and fixed, on goods only', async () => {
  await withDb(async (db) => {
    await makeCode(db, { code: 'PCT10', kind: 'percent', value: 10 });
    await makeCode(db, { code: 'FIX25', kind: 'fixed', value: 25 });
    assertEquals(await call(db, `public.discount_preview('PCT10', 250)`), { ok: true, code: 'PCT10', amount: 25 });
    assertEquals(await call(db, `public.discount_preview('FIX25', 250)`), { ok: true, code: 'FIX25', amount: 25 });
    // The code is trimmed and upper-cased.
    assertEquals(await call(db, `public.discount_preview('  pct10 ', 250)`), { ok: true, code: 'PCT10', amount: 25 });
  });
});

Deno.test('discount_preview: a fixed value above goods caps at goods; a percent of 100 is all of goods', async () => {
  await withDb(async (db) => {
    await makeCode(db, { code: 'BIG', kind: 'fixed', value: 500 });
    await makeCode(db, { code: 'ALL', kind: 'percent', value: 100 });
    assertEquals((await call(db, `public.discount_preview('BIG', 120)`)).amount, 120);
    assertEquals((await call(db, `public.discount_preview('BIG', 500)`)).amount, 500);
    assertEquals((await call(db, `public.discount_preview('ALL', 99.99)`)).amount, 99.99);
  });
});

Deno.test('discount_preview: a percent is rounded to cents, half away from zero', async () => {
  await withDb(async (db) => {
    await makeCode(db, { code: 'P15', kind: 'percent', value: 15 });
    await makeCode(db, { code: 'P10', kind: 'percent', value: 10 });
    await makeCode(db, { code: 'P033', kind: 'percent', value: 33.33 });
    // 33.33 * 15% = 4.9995 -> 5.00
    assertEquals((await call(db, `public.discount_preview('P15', 33.33)`)).amount, 5);
    // 10.05 * 10% = 1.005 -> 1.01
    assertEquals((await call(db, `public.discount_preview('P10', 10.05)`)).amount, 1.01);
    // 10.04 * 10% = 1.004 -> 1.00
    assertEquals((await call(db, `public.discount_preview('P10', 10.04)`)).amount, 1);
    // 99.99 * 33.33% = 33.32667 -> 33.33
    assertEquals((await call(db, `public.discount_preview('P033', 99.99)`)).amount, 33.33);
  });
});

Deno.test('discount_preview: unknown, off, expired and used-up codes give the very same answer', async () => {
  await withDb(async (db) => {
    await makeCode(db, { code: 'OFF', active: false });
    await makeCode(db, { code: 'OLD', expiresAt: PAST });
    await makeCode(db, { code: 'FULL', maxUses: 1 });
    await db.exec(`update public.discount_codes set uses = 1 where code = 'FULL'`);
    await makeCode(db, { code: 'GOOD', expiresAt: FUTURE, maxUses: 5 });
    const invalid = { ok: false, reason: 'discount_invalid' };
    for (const code of ['NOPE', 'OFF', 'OLD', 'FULL']) {
      assertEquals(await call(db, `public.discount_preview($1, 100)`, code), invalid, code);
    }
    // An empty or null code is unknown too.
    assertEquals(await call(db, `public.discount_preview('', 100)`), invalid);
    assertEquals(await call(db, `public.discount_preview(null, 100)`), invalid);
    // And a good one still works, with an expiry in the future and uses left.
    assertEquals((await call(db, `public.discount_preview('GOOD', 100)`)).ok, true);
  });
});

Deno.test('discount_preview: below the minimum spend is discount_minimum with minSpend; at the minimum it works', async () => {
  await withDb(async (db) => {
    await makeCode(db, { code: 'MIN500', minSpend: 500 });
    await makeCode(db, { code: 'MINCENT', minSpend: 99.5 });
    assertEquals(await call(db, `public.discount_preview('MIN500', 499.99)`), {
      ok: false,
      reason: 'discount_minimum',
      minSpend: 500,
    });
    assertEquals(await call(db, `public.discount_preview('MINCENT', 50)`), {
      ok: false,
      reason: 'discount_minimum',
      minSpend: 99.5,
    });
    assertEquals((await call(db, `public.discount_preview('MIN500', 500)`)).amount, 50);
    // An off code that is also below the minimum says only "invalid".
    await makeCode(db, { code: 'OFFMIN', minSpend: 500, active: false });
    assertEquals(await call(db, `public.discount_preview('OFFMIN', 1)`), { ok: false, reason: 'discount_invalid' });
  });
});

Deno.test('discount_preview is a pure read: no log row, no use spent', async () => {
  await withDb(async (db) => {
    const d = await makeCode(db, { code: 'READ', maxUses: 3 });
    for (let i = 0; i < 30; i++) await call(db, `public.discount_preview('READ', 100)`);
    assertEquals(await count(db, 'discount_check_log'), 0);
    assertEquals(await usesOf(db, d.id), 0);
  });
});

// ---- placing an order with a code --------------------------------------------------------------------------------------

Deno.test('place_order_v4: a percent code takes the discount off goods, delivery is untouched, a use is spent', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'SAVE10', kind: 'percent', value: 10 });
    const id = uuid();
    const r = await place4(db, pid, id, 2, { code: 'save10', delivery: DOOR });
    assert(r.ok && r.created, j(r));
    // Goods 200, delivery 85, discount 20 (10% of goods only), total 265.
    assertEquals([r.order.deliveryFee, r.order.discountAmount, r.order.discountCode, r.order.total], [85, 20, 'SAVE10', 265]);
    assertEquals(await usesOf(db, d.id), 1);
    assertEquals(await stockOf(db, pid), 18);
    const row = (await rows(db, `select discount_id, discount_code, discount_amount, total from public.orders where id = $1`, [id]))[0];
    assertEquals([row.discount_id, row.discount_code, Number(row.discount_amount), Number(row.total)], [d.id, 'SAVE10', 20, 265]);
    // get_order shows the same.
    const got = await call(db, 'public.get_order($1)', id);
    assertEquals([got.discountCode, got.discountAmount, got.total], ['SAVE10', 20, 265]);
  });
});

Deno.test('place_order_v4: a fixed code, capped at goods, never reaches into delivery', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    await makeCode(db, { code: 'FIX30', kind: 'fixed', value: 30 });
    await makeCode(db, { code: 'FIX900', kind: 'fixed', value: 900 });
    const a = await place4(db, pid, uuid(), 1, { code: 'FIX30', delivery: DOOR });
    assertEquals([a.order.discountAmount, a.order.total], [30, 155]);
    const b = await place4(db, pid, uuid(), 1, { code: 'FIX900', delivery: DOOR });
    // Goods are 100, so the discount is 100 and only delivery is left to pay.
    assertEquals([b.order.discountAmount, b.order.total, b.order.deliveryFee], [100, 85, 85]);
  });
});

Deno.test('place_order_v4: every failure keeps nothing (stock, orders, rate log) and uses stay put', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const ids: Record<string, string> = {};
    ids.off = (await makeCode(db, { code: 'OFF', active: false })).id;
    ids.old = (await makeCode(db, { code: 'OLD', expiresAt: PAST })).id;
    ids.full = (await makeCode(db, { code: 'FULL', maxUses: 2 })).id;
    await db.exec(`update public.discount_codes set uses = 2 where code = 'FULL'`);
    ids.min = (await makeCode(db, { code: 'MIN500', minSpend: 500 })).id;
    // Take one real order first, so the snapshot is not all zeros.
    assert((await place4(db, pid, uuid(), 1, { ip: '198.51.100.7' })).ok);
    const was = await snapshot(db, pid);
    assertEquals(was, { stock: 19, orders: 1, ipLog: 1 });
    const usesBefore = await rows(db, `select code, uses from public.discount_codes order by code`);

    const cases: [string, Json][] = [
      ['NOPE', { ok: false, reason: 'discount_invalid' }],
      ['OFF', { ok: false, reason: 'discount_invalid' }],
      ['OLD', { ok: false, reason: 'discount_invalid' }],
      ['FULL', { ok: false, reason: 'discount_invalid' }],
      ['MIN500', { ok: false, reason: 'discount_minimum', minSpend: 500 }],
    ];
    for (const [code, expected] of cases) {
      const r = await place4(db, pid, uuid(), 1, { code, ip: '198.51.100.7', delivery: DOOR });
      assertEquals(r, expected, code);
      assertEquals(await snapshot(db, pid), was, code);
    }
    assertEquals(await rows(db, `select code, uses from public.discount_codes order by code`), usesBefore);
    // The failed attempts did not use up the address's 5 orders an hour: 4 more still go through.
    for (let i = 0; i < 4; i++) assert((await place4(db, pid, uuid(), 1, { ip: '198.51.100.7' })).ok);
    assertEquals((await place4(db, pid, uuid(), 1, { ip: '198.51.100.7' })).reason, 'rate_limited');
  });
});

Deno.test('place_order_v4: the rate limit, stock and replays answer before the code is looked at', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'SAVE10' });
    for (let i = 0; i < 5; i++) assert((await place4(db, pid, uuid(), 1, { ip: '192.0.2.5' })).ok);
    // Over the limit: rate_limited wins over a (valid) code, and no use is spent.
    assertEquals(await place4(db, pid, uuid(), 1, { ip: '192.0.2.5', code: 'SAVE10' }), { ok: false, reason: 'rate_limited' });
    assertEquals(await usesOf(db, d.id), 0);
    // Stock is short, with a bad code: stock wins.
    const r = await place4(db, pid, uuid(), 99, { code: 'NOPE' });
    assertEquals(r.reason, 'stock');
    // Unknown delivery.
    assertEquals((await place4(db, pid, uuid(), 1, { code: 'SAVE10', delivery: { method: 'drone' } })).reason, 'unknown_delivery');
    assertEquals(await usesOf(db, d.id), 0);
  });
});

Deno.test('place_order_v4: an idempotent replay changes neither uses nor the total, whatever code it carries', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'SAVE10', maxUses: 1 });
    const id = uuid();
    const first = await place4(db, pid, id, 1, { code: 'SAVE10', delivery: DOOR });
    assert(first.ok && first.created, j(first));
    assertEquals(first.order.total, 175);
    assertEquals(await usesOf(db, d.id), 1);
    // The code is now used up, and a replay still returns the first order untouched.
    for (const code of ['SAVE10', 'NOPE', undefined]) {
      const again = await place4(db, pid, id, 1, { ...(code ? { code } : {}), delivery: DOOR });
      assert(again.ok && !again.created, j(again));
      assertEquals(again.order.total, 175);
      assertEquals(again.order.discountAmount, 10);
      assertEquals(again.order.discountCode, 'SAVE10');
      assertEquals(await usesOf(db, d.id), 1);
    }
    assertEquals(await stockOf(db, pid), 19);
    assertEquals(await count(db, 'orders'), 1);
    // A replay of an order placed WITHOUT a code does not take a code later.
    const plain = uuid();
    assert((await place4(db, pid, plain, 1)).ok);
    await makeCode(db, { code: 'SECOND', maxUses: 5 });
    const replay = await place4(db, pid, plain, 1, { code: 'SECOND' });
    assert(replay.ok && !replay.created && replay.order.discountCode === null && replay.order.total === 100, j(replay));
  });
});

Deno.test('place_order_v4: the last use cannot be spent twice (sequential; PGlite has one connection)', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'LAST', maxUses: 1 });
    const a = await place4(db, pid, uuid(), 1, { code: 'LAST' });
    const b = await place4(db, pid, uuid(), 1, { code: 'LAST' });
    assert(a.ok);
    assertEquals(b, { ok: false, reason: 'discount_invalid' });
    assertEquals(await usesOf(db, d.id), 1);
    assertEquals(await stockOf(db, pid), 19);
    assertEquals(await count(db, 'orders'), 1);
  });
});

Deno.test('place_order_v4: an online order that would total 0 fails and keeps nothing; a WhatsApp one may reach 0', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'FREE', kind: 'percent', value: 100 });
    const collect = { method: 'collect' };
    const was = await snapshot(db, pid);
    const online = await place4(db, pid, uuid(), 1, { code: 'FREE', paymentMethod: 'online', delivery: collect, ip: '203.0.113.1' });
    assertEquals(online, { ok: false, reason: 'discount_invalid' });
    assertEquals(await snapshot(db, pid), was);
    assertEquals(await usesOf(db, d.id), 0);

    // With a delivery fee left to pay, an online order is fine.
    const withFee = await place4(db, pid, uuid(), 1, { code: 'FREE', paymentMethod: 'online', delivery: DOOR });
    assert(withFee.ok, j(withFee));
    assertEquals([withFee.order.total, withFee.order.status], [85, 'awaiting_payment']);

    // WhatsApp reaches zero.
    const wa = await place4(db, pid, uuid(), 1, { code: 'FREE', delivery: collect });
    assert(wa.ok, j(wa));
    assertEquals([wa.order.total, wa.order.discountAmount, wa.order.status], [0, 100, 'pending']);
    assertEquals(await usesOf(db, d.id), 2);
  });
});

// ---- giving a use back (the trigger) -----------------------------------------------------------------------------------

Deno.test('trigger: cancel_order_v2 gives the use back once, and cancelling again changes nothing', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'SAVE10', maxUses: 3 });
    const id = uuid();
    assert((await place4(db, pid, id, 1, { code: 'SAVE10' })).ok);
    assertEquals(await usesOf(db, d.id), 1);
    const cancelled = await call(db, 'public.cancel_order_v2($1)', id);
    assertEquals(cancelled.status, 'cancelled');
    assertEquals(await usesOf(db, d.id), 0);
    assertEquals(await stockOf(db, pid), 20);
    await call(db, 'public.cancel_order_v2($1)', id);
    await call(db, `public.set_order_status($1, 'cancelled')`, id);
    assertEquals(await usesOf(db, d.id), 0);
    // The use is free to be spent again.
    assert((await place4(db, pid, uuid(), 1, { code: 'SAVE10' })).ok);
    assertEquals(await usesOf(db, d.id), 1);
  });
});

Deno.test('trigger: set_order_status to cancelled and to expired each give a use back once', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'SAVE10', maxUses: 5 });
    const a = uuid();
    const b = uuid();
    assert((await place4(db, pid, a, 1, { code: 'SAVE10' })).ok);
    assert((await place4(db, pid, b, 1, { code: 'SAVE10', paymentMethod: 'online' })).ok);
    assertEquals(await usesOf(db, d.id), 2);
    assertEquals((await call(db, `public.set_order_status($1, 'cancelled', 'pending')`, a)).changed, true);
    assertEquals(await usesOf(db, d.id), 1);
    assertEquals((await call(db, `public.set_order_status($1, 'expired', 'awaiting_payment')`, b)).changed, true);
    assertEquals(await usesOf(db, d.id), 0);
    // A repeat is a no-op (changed false, no update) and a refused move updates nothing.
    assertEquals((await call(db, `public.set_order_status($1, 'cancelled')`, a)).changed, false);
    assertEquals((await call(db, `public.set_order_status($1, 'paid')`, a)).reason, 'bad_transition');
    assertEquals(await usesOf(db, d.id), 0);
    assertEquals(await stockOf(db, pid), 20);
  });
});

Deno.test('trigger: expire_one_order (the expiry job) gives the use back once', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'SAVE10', maxUses: 5 });
    const pending = uuid();
    const online = uuid();
    assert((await place4(db, pid, pending, 1, { code: 'SAVE10' })).ok);
    assert((await place4(db, pid, online, 1, { code: 'SAVE10', paymentMethod: 'online' })).ok);
    assertEquals(await usesOf(db, d.id), 2);
    // Not due yet: nothing.
    assertEquals(await call(db, 'public.expire_one_order($1)', pending), 'skipped');
    assertEquals(await usesOf(db, d.id), 2);
    await db.exec(`update public.orders set expires_at = now() - interval '1 minute'`);
    assertEquals(await call(db, 'public.expire_one_order($1)', pending), 'cancelled');
    assertEquals(await call(db, 'public.expire_one_order($1)', online), 'expired');
    assertEquals(await usesOf(db, d.id), 0);
    // The job again does nothing.
    assertEquals(await call(db, 'public.expire_one_order($1)', pending), 'skipped');
    assertEquals(await call(db, 'public.expire_one_order($1)', online), 'skipped');
    assertEquals(await usesOf(db, d.id), 0);
    assertEquals(await stockOf(db, pid), 20);
  });
});

Deno.test('trigger: uses never go below zero, and a code row that is gone is a no-op', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'SAVE10' });
    const a = uuid();
    const b = uuid();
    assert((await place4(db, pid, a, 1, { code: 'SAVE10' })).ok);
    assert((await place4(db, pid, b, 1, { code: 'SAVE10' })).ok);
    await db.exec(`update public.discount_codes set uses = 0`);
    await call(db, 'public.cancel_order_v2($1)', a);
    assertEquals(await usesOf(db, d.id), 0);
    // Delete the code row (the API cannot; the owner only turns codes off). Cancelling still works.
    await db.exec(`delete from public.discount_codes`);
    const c = await call(db, 'public.cancel_order_v2($1)', b);
    assertEquals(c.status, 'cancelled');
    assertEquals(c.discountCode, 'SAVE10');
  });
});

/** An online order with a discount, with a payment reference attached, ready for record_payment. */
async function onlineOrder(db: Db, pid: string, code: string): Promise<{ id: string; ref: string; total: number }> {
  const id = uuid();
  const r = await place4(db, pid, id, 1, { code, paymentMethod: 'online', delivery: DOOR });
  assert(r.ok, j(r));
  const ref = `ref-${id}`;
  assert(await call(db, `public.attach_payment($1, $2, 'https://pay.example/x')`, id, ref));
  return { id, ref, total: r.order.total };
}

Deno.test('record_payment: works on a discounted order at the discounted amount only', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    await makeCode(db, { code: 'SAVE10' });
    const o = await onlineOrder(db, pid, 'SAVE10');
    // Goods 100, discount 10, delivery 85: R175.
    assertEquals(o.total, 175);
    // The undiscounted amount is a mismatch and changes nothing but the flag.
    assertEquals(await call(db, `public.record_payment($1, 18500, 'ZAR')`, o.ref), { ok: false, reason: 'amount_mismatch' });
    assertEquals(await status(db, o.id), 'awaiting_payment');
    const paid = await call(db, `public.record_payment($1, 17500, 'ZAR')`, o.ref);
    assertEquals(paid, { ok: true, changed: true, outcome: 'paid' });
    assertEquals(await status(db, o.id), 'paid');
    assertEquals((await call(db, `public.order_payment_info($1)`, o.id)).total, 175);
  });
});

Deno.test('trigger: a late payment takes the use again (even past max_uses); a refund after cancel changes nothing', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'ONE', maxUses: 1 });
    const o = await onlineOrder(db, pid, 'ONE');
    assertEquals(await usesOf(db, d.id), 1);
    // The order expires: the use goes back, and another customer takes it.
    await db.exec(`update public.orders set expires_at = now() - interval '1 minute'`);
    assertEquals(await call(db, 'public.expire_one_order($1)', o.id), 'expired');
    assertEquals(await usesOf(db, d.id), 0);
    const other = await place4(db, pid, uuid(), 1, { code: 'ONE' });
    assert(other.ok, j(other));
    assertEquals(await usesOf(db, d.id), 1);
    // The first customer pays late. Stock is there, the order is revived, and the use is taken again: 2 of 1.
    const late = await call(db, `public.record_payment($1, ${Math.round(o.total * 100)}, 'ZAR')`, o.ref);
    assertEquals(late.outcome, 'paid_late');
    assertEquals(await status(db, o.id), 'paid');
    assertEquals(await usesOf(db, d.id), 2);
    // Paid, then refunded: no change.
    await call(db, `public.set_order_status($1, 'refunded')`, o.id);
    assertEquals(await usesOf(db, d.id), 2);
  });
});

Deno.test('trigger: a payment that needs a refund keeps the use given back, and refunding changes nothing', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'SAVE10' });
    const o = await onlineOrder(db, pid, 'SAVE10');
    await db.exec(`update public.orders set expires_at = now() - interval '1 minute'`);
    assertEquals(await call(db, 'public.expire_one_order($1)', o.id), 'expired');
    assertEquals(await usesOf(db, d.id), 0);
    // The shelf is empty by the time the money arrives: refund_due, still expired.
    await db.exec(`update public.product_variants set stock = 0 where product_id = '${pid}'`);
    const late = await call(db, `public.record_payment($1, ${Math.round(o.total * 100)}, 'ZAR')`, o.ref);
    assertEquals(late.outcome, 'refund_due');
    assertEquals(await status(db, o.id), 'expired');
    assertEquals(await usesOf(db, d.id), 0);
    // expired -> refunded.
    assertEquals((await call(db, `public.set_order_status($1, 'refunded')`, o.id)).ok, true);
    assertEquals(await usesOf(db, d.id), 0);
  });
});

Deno.test('trigger: cancelled -> refunded (refund_due) changes nothing; only a status change fires it', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'SAVE10' });
    const id = uuid();
    assert((await place4(db, pid, id, 1, { code: 'SAVE10' })).ok);
    await call(db, 'public.cancel_order_v2($1)', id);
    assertEquals(await usesOf(db, d.id), 0);
    await db.exec(`update public.orders set payment_flag = 'refund_due' where id = '${id}'`);
    assertEquals(await usesOf(db, d.id), 0);
    assertEquals((await call(db, `public.set_order_status($1, 'refunded')`, id)).ok, true);
    assertEquals(await usesOf(db, d.id), 0);
    // An order with no code never touches a code row.
    const plain = uuid();
    assert((await place4(db, pid, plain, 1)).ok);
    await db.exec(`update public.discount_codes set uses = 7`);
    await call(db, 'public.cancel_order_v2($1)', plain);
    assertEquals(await usesOf(db, d.id), 7);
  });
});

Deno.test('trigger: exists once, fires only on a status update, and only for orders with a code', async () => {
  const db = await after();
  const t = await rows(
    db,
    `select tgname, pg_get_triggerdef(oid) as def from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal`,
  );
  assertEquals(t.length, 1);
  assertEquals(t[0].tgname, 'orders_discount_use');
  assert(t[0].def.includes('AFTER UPDATE OF status'), t[0].def);
  assert(t[0].def.includes('FOR EACH ROW'), t[0].def);
  assert(t[0].def.includes('discount_id IS NOT NULL'), t[0].def);
});

// ---- admin: list_discounts and upsert_discount -------------------------------------------------------------------------

Deno.test('list_discounts: every code newest first, with the exact keys', async () => {
  await withDb(async (db) => {
    assertEquals(await call(db, 'public.list_discounts()'), []);
    const a = await makeCode(db, { code: 'AAA', kind: 'fixed', value: 25.5, minSpend: 100, expiresAt: FUTURE, maxUses: 4 });
    await db.exec(`update public.discount_codes set created_at = created_at - interval '1 day'`);
    const b = await makeCode(db, { code: 'BBB' });
    const all = await call(db, 'public.list_discounts()');
    assertEquals(all.map((d: Json) => d.code), ['BBB', 'AAA']);
    assertEquals(Object.keys(all[1]).sort(), [
      'active', 'code', 'createdAt', 'expiresAt', 'id', 'kind', 'maxUses', 'minSpend', 'uses', 'value',
    ]);
    assertEquals(all[1].id, a.id);
    assertEquals([all[1].kind, all[1].value, all[1].minSpend, all[1].maxUses, all[1].uses, all[1].active], ['fixed', 25.5, 100, 4, 0, true]);
    assertEquals(new Date(all[1].expiresAt).toISOString(), '2099-01-01T00:00:00.000Z');
    assertEquals([all[0].id, all[0].minSpend, all[0].expiresAt, all[0].maxUses], [b.id, 0, null, null]);
  });
});

Deno.test('upsert_discount: creates, then updates by id, and never touches uses', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const id = uuid();
    const made = await call(db, 'public.upsert_discount($1::uuid, $2::jsonb)', id, j({
      code: ' summer ', kind: 'percent', value: 12.5, active: true,
    }));
    assertEquals(made.ok, true);
    assertEquals(made.discount.code, 'SUMMER');
    assertEquals([made.discount.value, made.discount.minSpend, made.discount.maxUses, made.discount.expiresAt], [12.5, 0, null, null]);
    assert((await place4(db, pid, uuid(), 1, { code: 'SUMMER' })).ok);
    // An update changes the fields; `uses` in the input is ignored.
    const upd = await call(db, 'public.upsert_discount($1::uuid, $2::jsonb)', id, j({
      code: 'WINTER', kind: 'fixed', value: 40, minSpend: 150, maxUses: 9, active: false, uses: 99,
    }));
    assertEquals(upd.ok, true);
    assertEquals(upd.discount.id, id);
    assertEquals([upd.discount.code, upd.discount.kind, upd.discount.value, upd.discount.minSpend, upd.discount.maxUses, upd.discount.active, upd.discount.uses],
      ['WINTER', 'fixed', 40, 150, 9, false, 1]);
    assertEquals(upd.discount.createdAt, made.discount.createdAt);
    assertEquals((await call(db, 'public.list_discounts()')).length, 1);
    // An order already placed keeps the code it was placed with.
    assertEquals((await rows(db, `select discount_code from public.orders`))[0].discount_code, 'SUMMER');
  });
});

Deno.test('upsert_discount: a code another row has is code_taken (any case) and changes nothing', async () => {
  await withDb(async (db) => {
    const a = await makeCode(db, { code: 'TAKEN' });
    const b = await makeCode(db, { code: 'OTHER' });
    const dup = await call(db, 'public.upsert_discount($1::uuid, $2::jsonb)', uuid(), j({
      code: 'taken', kind: 'percent', value: 5, active: true,
    }));
    assertEquals(dup, { ok: false, reason: 'code_taken' });
    // Renaming b onto a's code too.
    const rename = await call(db, 'public.upsert_discount($1::uuid, $2::jsonb)', b.id, j({
      code: 'TAKEN', kind: 'percent', value: 5, active: true,
    }));
    assertEquals(rename, { ok: false, reason: 'code_taken' });
    assertEquals((await call(db, 'public.list_discounts()')).map((d: Json) => d.code).sort(), ['OTHER', 'TAKEN']);
    // Saving a row with its own code is fine.
    const same = await call(db, 'public.upsert_discount($1::uuid, $2::jsonb)', a.id, j({
      code: 'TAKEN', kind: 'percent', value: 6, active: true,
    }));
    assertEquals(same.ok, true);
  });
});

Deno.test('discount_codes: the checks refuse bad rows (lower case, percent over 100, zero value, bad limits)', async () => {
  await withDb(async (db) => {
    const ins = (cols: string, vals: string) =>
      db.exec(`insert into public.discount_codes (id, ${cols}) values ('${uuid()}', ${vals})`);
    await assertRejects(() => ins('code, kind, value', `'low', 'percent', 5`), Error, 'check');
    await assertRejects(() => ins('code, kind, value', `'BIG', 'percent', 101`), Error, 'check');
    await assertRejects(() => ins('code, kind, value', `'ZERO', 'fixed', 0`), Error, 'check');
    await assertRejects(() => ins('code, kind, value', `'KIND', 'bogus', 5`), Error, 'check');
    await assertRejects(() => ins('code, kind, value, min_spend', `'MIN', 'fixed', 5, -1`), Error, 'check');
    await assertRejects(() => ins('code, kind, value, max_uses', `'MAXU', 'fixed', 5, 0`), Error, 'check');
    await assertRejects(() => ins('code, kind, value, uses', `'USES', 'fixed', 5, -1`), Error, 'check');
    // A fixed value over 100 is fine; exactly 100 percent is fine.
    await ins('code, kind, value', `'FIXED', 'fixed', 500`);
    await ins('code, kind, value', `'PCT', 'percent', 100`);
    assertEquals(await count(db, 'discount_codes'), 2);
    // Through upsert the same checks raise.
    await assertRejects(
      () => call(db, 'public.upsert_discount($1::uuid, $2::jsonb)', uuid(), j({ code: 'OVER', kind: 'percent', value: 150, active: true })),
      Error,
      'check',
    );
  });
});

// ---- check_discount ----------------------------------------------------------------------------------------------------

Deno.test('check_discount: 20 an hour per address, the 21st is rate_limited, and the answer is the preview', async () => {
  await withDb(async (db) => {
    await makeCode(db, { code: 'SAVE10' });
    const ip = '203.0.113.77';
    for (let i = 1; i <= 20; i++) {
      assertEquals(await call(db, `public.check_discount('SAVE10', 200, $1)`, ip), { ok: true, code: 'SAVE10', amount: 20 }, `check ${i}`);
    }
    assertEquals(await call(db, `public.check_discount('SAVE10', 200, $1)`, ip), { ok: false, reason: 'rate_limited' });
    assertEquals(await call(db, `public.check_discount('NOPE', 200, $1)`, ip), { ok: false, reason: 'rate_limited' });
    // A refused check is not logged; another address is unaffected.
    assertEquals(await count(db, 'discount_check_log'), 20);
    assertEquals((await call(db, `public.check_discount('SAVE10', 200, '203.0.113.78')`)).ok, true);
    // Invalid and below-minimum answers are the preview's, and they count as checks too.
    await makeCode(db, { code: 'MIN500', minSpend: 500 });
    assertEquals(await call(db, `public.check_discount('NOPE', 200, '198.51.100.1')`), { ok: false, reason: 'discount_invalid' });
    assertEquals(await call(db, `public.check_discount('MIN500', 200, '198.51.100.1')`), { ok: false, reason: 'discount_minimum', minSpend: 500 });
    assertEquals(await count(db, 'discount_check_log'), 23);
  });
});

Deno.test('check_discount: the address is stored only as a salted hash, never raw', async () => {
  await withDb(async (db) => {
    await makeCode(db, { code: 'SAVE10' });
    const ip = '203.0.113.200';
    await call(db, `public.check_discount('SAVE10', 100, $1)`, ip);
    const log = await rows(db, `select ip_hash, created_at from public.discount_check_log`);
    assertEquals(log.length, 1);
    assert(/^[0-9a-f]{64}$/.test(log[0].ip_hash), log[0].ip_hash);
    assert(!log[0].ip_hash.includes(ip));
    // The hash is the salted SHA-256 the order limit uses, and the raw address is nowhere in the table.
    const salt = (await rows(db, `select salt from public.order_rate_salt`))[0].salt;
    const want = (await rows(db, `select encode(sha256(convert_to($1 || $2, 'UTF8')), 'hex') as h`, [salt, ip]))[0].h;
    assertEquals(log[0].ip_hash, want);
    assertEquals((await rows(db, `select count(*)::int as n from public.discount_check_log t where t::text like '%203.0.113.200%'`))[0].n, 0);
  });
});

Deno.test('check_discount: no address means no limit and no log; rows older than an hour are deleted and stop counting', async () => {
  await withDb(async (db) => {
    await makeCode(db, { code: 'SAVE10' });
    for (let i = 0; i < 30; i++) assertEquals((await call(db, `public.check_discount('SAVE10', 100, null)`)).ok, true);
    for (let i = 0; i < 3; i++) assertEquals((await call(db, `public.check_discount('SAVE10', 100, '')`)).ok, true);
    assertEquals(await count(db, 'discount_check_log'), 0);

    const ip = '203.0.113.50';
    for (let i = 0; i < 20; i++) await call(db, `public.check_discount('SAVE10', 100, $1)`, ip);
    assertEquals((await call(db, `public.check_discount('SAVE10', 100, $1)`, ip)).reason, 'rate_limited');
    // An hour and a bit later the old rows are gone and the address can check again.
    await db.exec(`update public.discount_check_log set created_at = now() - interval '61 minutes'`);
    assertEquals((await call(db, `public.check_discount('SAVE10', 100, $1)`, ip)).ok, true);
    assertEquals(await count(db, 'discount_check_log'), 1);
    // Within the hour they still count.
    await db.exec(`update public.discount_check_log set created_at = now() - interval '59 minutes'`);
    for (let i = 0; i < 19; i++) await call(db, `public.check_discount('SAVE10', 100, $1)`, ip);
    assertEquals((await call(db, `public.check_discount('SAVE10', 100, $1)`, ip)).reason, 'rate_limited');
  });
});

Deno.test('check_discount: does not touch the order limit log, and checks never spend a use', async () => {
  await withDb(async (db) => {
    const d = await makeCode(db, { code: 'SAVE10', maxUses: 1 });
    for (let i = 0; i < 5; i++) await call(db, `public.check_discount('SAVE10', 100, '203.0.113.9')`);
    assertEquals(await count(db, 'order_ip_log'), 0);
    assertEquals(await usesOf(db, d.id), 0);
  });
});

// ---- the code attempt limit shared by orders and checks -----------------------------------------------------------------

const attempts = (db: Db) => count(db, 'discount_check_log');

Deno.test('attempt limit: 20 orders with a bad code from one address fail, the 21st is rate_limited; nothing is kept, the attempts are', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    await makeCode(db, { code: 'REAL' });
    const ip = '203.0.113.99';
    const was = await snapshot(db, pid);
    for (let i = 1; i <= 20; i++) {
      assertEquals(await place4(db, pid, uuid(), 1, { code: `GUESS${i}`, ip }), { ok: false, reason: 'discount_invalid' }, `try ${i}`);
    }
    // The orders were undone (stock, orders and the ORDER rate log), but the attempts survive the rollback.
    assertEquals(await snapshot(db, pid), was);
    assertEquals(await attempts(db), 20);
    // The 21st is refused outright, with a REAL code too, and nothing is done or counted.
    assertEquals(await place4(db, pid, uuid(), 1, { code: 'REAL', ip }), { ok: false, reason: 'rate_limited' });
    assertEquals(await place4(db, pid, uuid(), 1, { code: 'GUESS21', ip }), { ok: false, reason: 'rate_limited' });
    assertEquals(await snapshot(db, pid), was);
    assertEquals(await attempts(db), 20);
    assertEquals(await usesOf(db, (await rows(db, `select id from public.discount_codes`))[0].id), 0);
    // Another address is unaffected.
    assert((await place4(db, pid, uuid(), 1, { code: 'REAL', ip: '203.0.113.100' })).ok);
    // An hour later the address can try again.
    await db.exec(`update public.discount_check_log set created_at = now() - interval '61 minutes' where ip_hash not in (select ip_hash from public.discount_check_log group by ip_hash having count(*) = 1)`);
    assertEquals((await place4(db, pid, uuid(), 1, { code: 'REAL', ip })).ok, true);
  });
});

Deno.test('attempt limit: a minimum-spend failure and a successful coded order count too', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    await makeCode(db, { code: 'GOOD' });
    await makeCode(db, { code: 'MIN9K', minSpend: 9000 });
    const ip = '203.0.113.5';
    assert((await place4(db, pid, uuid(), 1, { code: 'GOOD', ip })).ok);
    assertEquals((await place4(db, pid, uuid(), 1, { code: 'MIN9K', ip })).reason, 'discount_minimum');
    assertEquals(await attempts(db), 2);
  });
});

Deno.test('attempt limit: orders and checks share the same 20 an hour', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    await makeCode(db, { code: 'SAVE10' });
    const ip = '198.51.100.20';
    for (let i = 0; i < 12; i++) assertEquals((await call(db, `public.check_discount('SAVE10', 100, $1)`, ip)).ok, true);
    for (let i = 0; i < 8; i++) assertEquals((await place4(db, pid, uuid(), 1, { code: 'NOPE', ip })).reason, 'discount_invalid');
    assertEquals(await attempts(db), 20);
    assertEquals(await call(db, `public.check_discount('SAVE10', 100, $1)`, ip), { ok: false, reason: 'rate_limited' });
    assertEquals(await place4(db, pid, uuid(), 1, { code: 'SAVE10', ip }), { ok: false, reason: 'rate_limited' });
    // And the other way round: orders first, then a check is refused.
    const ip2 = '198.51.100.21';
    for (let i = 0; i < 20; i++) await place4(db, pid, uuid(), 1, { code: 'NOPE', ip: ip2 });
    assertEquals(await call(db, `public.check_discount('SAVE10', 100, $1)`, ip2), { ok: false, reason: 'rate_limited' });
  });
});

Deno.test('attempt limit: a replay of an existing order at the limit returns the order and adds no log row', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    await makeCode(db, { code: 'SAVE10' });
    const ip = '203.0.113.60';
    const id = uuid();
    const first = await place4(db, pid, id, 1, { code: 'SAVE10', ip });
    assert(first.ok && first.created, j(first));
    for (let i = 0; i < 19; i++) await place4(db, pid, uuid(), 1, { code: 'NOPE', ip });
    assertEquals(await attempts(db), 20);
    assertEquals((await place4(db, pid, uuid(), 1, { code: 'SAVE10', ip })).reason, 'rate_limited');
    const again = await place4(db, pid, id, 1, { code: 'SAVE10', ip });
    assert(again.ok && !again.created && again.order.total === 90, j(again));
    assertEquals(await attempts(db), 20);
  });
});

Deno.test('attempt limit: an order with no code from a limited address still works; no address means no limit', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    await makeCode(db, { code: 'SAVE10' });
    const ip = '203.0.113.70';
    for (let i = 0; i < 20; i++) await place4(db, pid, uuid(), 1, { code: 'NOPE', ip });
    assertEquals((await place4(db, pid, uuid(), 1, { code: 'SAVE10', ip })).reason, 'rate_limited');
    const plain = await place4(db, pid, uuid(), 1, { ip });
    assert(plain.ok && plain.created && plain.order.discountCode === null, j(plain));
    for (const blank of ['', '   ']) assert((await place4(db, pid, uuid(), 1, { code: '', ip: blank })).ok);
    assertEquals(await attempts(db), 20);
    // No address (the owner's orders): any number of bad codes, nothing logged.
    const before = await attempts(db);
    for (let i = 0; i < 25; i++) assertEquals((await place4(db, pid, uuid(), 1, { code: 'NOPE' })).reason, 'discount_invalid');
    assert((await place4(db, pid, uuid(), 1, { code: 'SAVE10' })).ok);
    assertEquals(await attempts(db), before);
    // Whitespace-only address is no address.
    assertEquals((await place4(db, pid, uuid(), 1, { code: 'NOPE', ip: '  ' })).reason, 'discount_invalid');
    assertEquals(await attempts(db), before);
  });
});

Deno.test('attempt limit: the stored value is the salted hash, and the order log is separate', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const ip = '203.0.113.201';
    await place4(db, pid, uuid(), 1, { code: 'NOPE', ip });
    const log = await rows(db, `select ip_hash from public.discount_check_log`);
    assertEquals(log.length, 1);
    assert(/^[0-9a-f]{64}$/.test(log[0].ip_hash) && !log[0].ip_hash.includes(ip));
    assertEquals(await count(db, 'order_ip_log'), 0);
  });
});

// ---- grants and the migration itself -----------------------------------------------------------------------------------

const FUNCTIONS = [
  'public.discount_rule(public.discount_codes, numeric)',
  'public.discount_preview(text, numeric)',
  'public.place_order_v4(uuid, jsonb, jsonb, jsonb)',
  'public.discount_release_use()',
  'public.discount_json(public.discount_codes)',
  'public.list_discounts()',
  'public.upsert_discount(uuid, jsonb)',
  'public.discount_attempt_allowed(text)',
  'public.check_discount(text, numeric, text)',
];

Deno.test('grants: every new function is service_role only, and the list covers every function the migration creates', async () => {
  await withDb(async (db) => {
    for (const sig of FUNCTIONS) {
      for (const role of ['anon', 'authenticated']) {
        assertEquals(
          (await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]))[0].ok,
          false,
          `${role} ${sig}`,
        );
      }
      assertEquals((await rows(db, `select has_function_privilege('service_role', $1, 'execute') as ok`, [sig]))[0].ok, true, sig);
      const def = (await rows(db, `select p.prosecdef, p.proconfig::text as cfg from pg_proc p where p.oid = $1::regprocedure`, [sig]))[0];
      assertEquals(def.prosecdef, true, `${sig} is security definer`);
      assert(def.cfg.includes('search_path=public'), `${sig} search_path: ${def.cfg}`);
      // Public (the default grant to every role) is revoked too.
      const acl = (await rows(db, `select p.proacl::text as acl from pg_proc p where p.oid = $1::regprocedure`, [sig]))[0].acl;
      assert(!acl.startsWith('{='), `${sig} is granted to public: ${acl}`);
    }
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await assertRejects(() => db.query(`select public.list_discounts()`), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.discount_preview('X', 1)`), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.discount_attempt_allowed('1.2.3.4')`), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.check_discount('X', 1, '1.2.3.4')`), Error, 'permission denied');
        await assertRejects(
          () => db.query(`select public.upsert_discount('${uuid()}', '{"code":"HACK","kind":"fixed","value":1}'::jsonb)`),
          Error,
          'permission denied',
        );
        await assertRejects(
          () => db.query(`select public.place_order_v4('${uuid()}', '[]'::jsonb, '{}'::jsonb)`),
          Error,
          'permission denied',
        );
      } finally {
        await db.exec('reset role');
      }
    }
    assertEquals(await count(db, 'discount_codes'), 0);
    // Every function the migration creates is on the list.
    const created = [...(await readMigration(DISCOUNTS_MIGRATION)).matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    const covered = new Set(FUNCTIONS.map((s) => s.slice('public.'.length, s.indexOf('('))));
    for (const name of created) assert(name === 'order_json' || covered.has(name), `${name} has no grant check`);
    assertEquals(created.filter((n) => n !== 'order_json').length, covered.size);
  });
});

Deno.test('grants: the new tables have RLS on and nothing for public, anon or authenticated', async () => {
  const db = await after();
  for (const t of ['discount_codes', 'discount_check_log']) {
    assertEquals((await rows(db, `select relrowsecurity from pg_class where oid = $1::regclass`, [`public.${t}`]))[0].relrowsecurity, true, t);
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        assertEquals((await rows(db, `select has_table_privilege($1, $2, $3) as ok`, [role, `public.${t}`, priv]))[0].ok, false, `${role} ${priv} ${t}`);
      }
    }
  }
  // The new columns on orders are not readable by anon either (the table was already revoked).
  assertEquals((await rows(db, `select has_table_privilege('anon', 'public.orders', 'select') as ok`))[0].ok, false);
});

Deno.test('migration: place_order_v3, place_order_v2 and every other existing function are unchanged except order_json', async () => {
  const db = await after();
  const base = await functionsBefore!;
  const now = await functionDefs(db);
  const byName = new Map(now.map((f) => [f.sig as string, f]));
  const changed: string[] = [];
  for (const f of base) {
    const same = byName.get(f.sig);
    assert(same, `${f.sig} is gone`);
    if (same.def !== f.def) changed.push(f.sig);
    assertEquals(same.acl, f.acl, `${f.sig} grants changed`);
  }
  assertEquals(changed, ['order_json(orders)']);
  for (const name of ['place_order_v3(uuid,jsonb,jsonb,jsonb)', 'place_order_v2(uuid,jsonb,jsonb)', 'set_order_status(uuid,text,text)', 'cancel_order_v2(uuid)', 'record_payment(text,bigint,text)', 'expire_one_order(uuid)']) {
    assert(base.some((f) => f.sig === name), `${name} not in the base`);
    assertEquals(byName.get(name)!.def, base.find((f) => f.sig === name)!.def, name);
  }
  assertEquals(
    now.filter((f) => !base.some((b) => b.sig === f.sig)).map((f) => f.sig).sort(),
    [
      'check_discount(text,numeric,text)',
      'discount_attempt_allowed(text)',
      'discount_json(discount_codes)',
      'discount_preview(text,numeric)',
      'discount_release_use()',
      'discount_rule(discount_codes,numeric)',
      'list_discounts()',
      'place_order_v4(uuid,jsonb,jsonb,jsonb)',
      'upsert_discount(uuid,jsonb)',
    ],
  );
});

Deno.test('migration: old orders keep working, with discount_amount 0 and no code', async () => {
  const base = await before();
  const db = await base.clone();
  try {
    const { pid } = await seed(db);
    const old = uuid();
    const placed = await place3(db, pid, old, 1);
    assert(placed.ok, j(placed));
    await db.exec(await readMigration(DISCOUNTS_MIGRATION));
    const row = (await rows(db, `select discount_id, discount_code, discount_amount, total from public.orders where id = $1`, [old]))[0];
    assertEquals([row.discount_id, row.discount_code, Number(row.discount_amount), Number(row.total)], [null, null, 0, 100]);
    const got = await call(db, 'public.get_order($1)', old);
    assertEquals([got.discountCode, got.discountAmount, got.total], [null, 0, 100]);
    // And v3 itself still places and cancels orders.
    assert((await place3(db, pid, uuid(), 1)).ok);
    assertEquals((await call(db, 'public.cancel_order_v2($1)', old)).status, 'cancelled');
  } finally {
    await db.close();
  }
});

Deno.test('migration: safe to run twice, keeps its data, and leaves one trigger and one index', async () => {
  await withDb(async (db) => {
    const { pid } = await seed(db);
    const d = await makeCode(db, { code: 'SAVE10', maxUses: 3 });
    const id = uuid();
    assert((await place4(db, pid, id, 1, { code: 'SAVE10', ip: '203.0.113.5' })).ok);
    await call(db, `public.check_discount('SAVE10', 100, '203.0.113.5')`);
    const defs = await functionDefs(db);
    const orders = await rows(db, `select * from public.orders`);
    await db.exec(await readMigration(DISCOUNTS_MIGRATION));
    await db.exec(await readMigration(DISCOUNTS_MIGRATION));
    assertEquals(await functionDefs(db), defs);
    assertEquals(await rows(db, `select * from public.orders`), orders);
    assertEquals(await usesOf(db, d.id), 1);
    assertEquals(await count(db, 'discount_check_log'), 2); // the coded order and the check
    assertEquals((await rows(db, `select count(*)::int as n from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal`))[0].n, 1);
    assertEquals(
      (await rows(db, `select count(*)::int as n from pg_indexes where tablename = 'discount_check_log' and indexname = 'discount_check_log_hash_created_idx'`))[0].n,
      1,
    );
    // Still works afterwards.
    await call(db, 'public.cancel_order_v2($1)', id);
    assertEquals(await usesOf(db, d.id), 0);
  });
});
