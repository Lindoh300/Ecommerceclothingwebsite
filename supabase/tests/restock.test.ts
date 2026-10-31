// Tests for supabase/migrations/20261031150000_restock_alerts.sql (restock requests and the changed
// unsubscribe_contact), run against an in-process Postgres (PGlite) with every migration before it applied. Run with
// `deno task test:sql` from supabase/functions/server.
//
// PGlite is ONE connection, so these tests cannot show real races between concurrent transactions. They check the
// logic: the table rules, the request and its repeat, the answers, the shared address limit, the 180-day purge,
// cascades, the unsubscribe change, RLS and grants, and that the migration is additive and safe to re-run.
import { assert, assertEquals, assertRejects } from '@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.13';
import { pgcrypto } from 'npm:@electric-sql/pglite@0.5.13/contrib/pgcrypto';

// deno-lint-ignore no-explicit-any
type Json = any;
type Db = Awaited<ReturnType<PGlite['clone']>>;

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const readMigration = (name: string) => Deno.readTextFile(new URL(name, MIGRATIONS));
const RESTOCK_MIGRATION = '20261031150000_restock_alerts.sql';
// Every migration before the restock one, in order. The pg_cron migration is never loaded: PGlite has no pg_cron.
const BEFORE_RESTOCK = [
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
    for (const f of BEFORE_RESTOCK) await db.exec(await readMigration(f));
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

/** `before` plus the restock migration, applied once. */
function after(): Promise<Db> {
  afterDb ??= (async () => {
    const base = await before();
    functionsBefore = functionDefs(base);
    const db = await base.clone();
    await db.exec(await readMigration(RESTOCK_MIGRATION));
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

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
async function rows(db: Db, sql: string, params: unknown[] = []): Promise<Json[]> {
  return (await db.query(sql, params)).rows as Json[];
}

async function call(db: Db, expr: string, ...params: unknown[]): Promise<Json> {
  return ((await db.query(`select ${expr} as r`, params)).rows[0] as Json).r;
}

const j = (v: unknown) => JSON.stringify(v);
const IP = '203.0.113.9';
const TEXT = '[2026-10-31] Yes, I\'d like 4Nguru to send me news about new drops and events. I can opt out at any time.';

/** public.request_restock_alert(product, variant, phone, email, ip) */
const ask = (
  db: Db,
  productId: string,
  variantId: string,
  o: { phone?: string | null; email?: string | null; ip?: string | null },
) =>
  call(db, 'public.request_restock_alert($1, $2::uuid, $3, $4, $5)', productId, variantId, o.phone ?? null, o.email ?? null, o.ip ?? null);

const subscribe = (db: Db, o: { phone?: string | null; email?: string | null; ip?: string | null }) =>
  call(db, 'public.subscribe($1, $2, $3, $4, $5, $6)', null, o.phone ?? null, o.email ?? null, TEXT, 'footer', o.ip ?? null);

const unsubscribe = (db: Db, o: { phone?: string | null; email?: string | null; ip?: string | null }) =>
  call(db, 'public.unsubscribe_contact($1, $2, $3)', o.phone ?? null, o.email ?? null, o.ip ?? null);

const requests = (db: Db) => rows(db, 'select * from public.restock_requests order by created_at, id');
const count = async (db: Db, table: string) => (await rows(db, `select count(*)::int as n from public.${table}`))[0].n as number;
const listAdmin = (db: Db): Promise<Json[]> => call(db, 'public.list_restock_requests_admin()');

/** A product with variants [size, color, stock]; returns the product id and the variant ids by "size/color". */
async function mkProduct(
  db: Db,
  name: string,
  stocks: [string, string, number][],
): Promise<{ id: string; v: Record<string, string> }> {
  await call(db, `public.upsert_category('tees', 'Tees', 0, true)`);
  const id = crypto.randomUUID();
  const r = await call(db, 'public.create_product($1, $2::jsonb)', id, j({
    name,
    category: 'tees',
    price: 100,
    description: '',
    images: [],
    sizes: [...new Set(stocks.map((s) => s[0]))],
    colors: [...new Set(stocks.map((s) => s[1]))],
    variants: stocks.map(([size, color, stock]) => ({ size, color, stock })),
  }));
  assert(r.ok, j(r));
  const v: Record<string, string> = {};
  for (const x of r.product.variants) v[`${x.size}/${x.color}`] = x.id;
  return { id, v };
}

/** One product: M/Black sold out, L/Black in stock, S/Red sold out. */
const shop = (db: Db) => mkProduct(db, 'Classic Tee', [['M', 'Black', 0], ['L', 'Black', 4], ['S', 'Red', 0]]);

const insertRow = (db: Db, productId: string, variantId: string, phone: string | null, email: string | null) =>
  db.query('insert into public.restock_requests (product_id, variant_id, phone, email) values ($1, $2, $3, $4)', [
    productId,
    variantId,
    phone,
    email,
  ]);

// ---------------------------------------------------------------------------
// The table rules.
// ---------------------------------------------------------------------------
Deno.test('restock_requests: exactly one of phone and email, each plausible', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const m = p.v['M/Black'];
    await assertRejects(() => insertRow(db, p.id, m, null, null), Error, 'check');
    await assertRejects(() => insertRow(db, p.id, m, '0821234567', 'a@example.com'), Error, 'check');
    await assertRejects(() => insertRow(db, p.id, m, '12', null), Error, 'check');
    await assertRejects(() => insertRow(db, p.id, m, '1234567890123456', null), Error, 'check');
    await assertRejects(() => insertRow(db, p.id, m, '---', null), Error, 'check');
    await assertRejects(() => insertRow(db, p.id, m, null, 'not-an-email'), Error, 'check');
    await assertRejects(() => insertRow(db, p.id, m, null, 'a b@example.com'), Error, 'check');
    await insertRow(db, p.id, m, '0821234567', null);
    await insertRow(db, p.id, m, null, 'a@example.com');
    assertEquals(await count(db, 'restock_requests'), 2);
  });
});

Deno.test('restock_requests: unique per variant on the normalised phone and the lower-cased email; the product and variant must exist', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const m = p.v['M/Black'];
    const s = p.v['S/Red'];
    await insertRow(db, p.id, m, '082 123 4567', null);
    await insertRow(db, p.id, m, null, 'a@example.com');
    await assertRejects(() => insertRow(db, p.id, m, '+27 82 123 4567', null), Error, 'duplicate');
    await assertRejects(() => insertRow(db, p.id, m, null, 'A@Example.com'), Error, 'duplicate');
    // The same contact on another variant is fine.
    await insertRow(db, p.id, s, '+27 82 123 4567', null);
    await insertRow(db, p.id, s, null, 'A@Example.com');
    assertEquals(await count(db, 'restock_requests'), 4);
    await assertRejects(() => insertRow(db, 'no-such-product', m, '0831234567', null), Error, 'foreign key');
    await assertRejects(() => insertRow(db, p.id, crypto.randomUUID(), '0831234567', null), Error, 'foreign key');
  });
});

// ---------------------------------------------------------------------------
// request_restock_alert.
// ---------------------------------------------------------------------------
Deno.test('request_restock_alert: a sold-out option stores one row with the contact as given', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    assertEquals(await ask(db, p.id, p.v['M/Black'], { phone: '  082 123 4567 ' }), { ok: true });
    assertEquals(await ask(db, p.id, p.v['M/Black'], { email: 'Thandi@Example.com' }), { ok: true });
    const r = await requests(db);
    assertEquals(r.length, 2);
    assertEquals(r.map((x: Json) => [x.product_id, x.variant_id, x.phone, x.email]), [
      [p.id, p.v['M/Black'], '082 123 4567', null],
      [p.id, p.v['M/Black'], null, 'Thandi@Example.com'],
    ]);
    assert(r.every((x: Json) => Date.now() - new Date(x.created_at).getTime() < 60_000));
  });
});

Deno.test('request_restock_alert: a repeat gives the same answer and stays one row, in any spelling', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const m = p.v['M/Black'];
    const answers = [
      await ask(db, p.id, m, { phone: '082 123 4567' }),
      await ask(db, p.id, m, { phone: '+27 82 123 4567' }),
      await ask(db, p.id, m, { phone: '0027821234567' }),
      await ask(db, p.id, m, { email: 'Thandi@Example.com' }),
      await ask(db, p.id, m, { email: 'thandi@example.com' }),
      await ask(db, p.id, m, { email: 'THANDI@EXAMPLE.COM' }),
    ];
    for (const a of answers) assertEquals(a, { ok: true });
    assertEquals(await count(db, 'restock_requests'), 2);
    // The first row is kept as it was: the repeat changes nothing.
    assertEquals((await requests(db)).map((x: Json) => x.phone ?? x.email), ['082 123 4567', 'Thandi@Example.com']);
    // Another option, or another person, is a new row.
    assertEquals(await ask(db, p.id, p.v['S/Red'], { phone: '082 123 4567' }), { ok: true });
    assertEquals(await ask(db, p.id, m, { phone: '083 000 1111' }), { ok: true });
    assertEquals(await count(db, 'restock_requests'), 4);
  });
});

Deno.test('request_restock_alert: a repeat costs the same as a new request and reveals nothing else', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const first = await ask(db, p.id, p.v['M/Black'], { email: 'a@example.com', ip: IP });
    const repeat = await ask(db, p.id, p.v['M/Black'], { email: 'a@example.com', ip: IP });
    assertEquals(first, repeat);
    assertEquals(await count(db, 'subscribe_ip_log'), 2);
  });
});

Deno.test('request_restock_alert: an unknown product, an inactive one, an unknown variant and another product\'s variant are not_found', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const other = await mkProduct(db, 'Other Tee', [['M', 'Black', 0]]);
    const hidden = await mkProduct(db, 'Hidden Tee', [['M', 'Black', 0]]);
    await db.query('update public.products set active = false where id = $1', [hidden.id]);
    const nf = { ok: false, reason: 'not_found' };
    assertEquals(await ask(db, 'no-such-product', p.v['M/Black'], { phone: '082 123 4567' }), nf);
    assertEquals(await ask(db, p.id, crypto.randomUUID(), { phone: '082 123 4567' }), nf);
    // A variant of another product, whether that product is sold out or not.
    assertEquals(await ask(db, p.id, other.v['M/Black'], { phone: '082 123 4567' }), nf);
    assertEquals(await ask(db, other.id, p.v['M/Black'], { phone: '082 123 4567' }), nf);
    assertEquals(await ask(db, other.id, p.v['L/Black'], { phone: '082 123 4567' }), nf);
    assertEquals(await ask(db, hidden.id, hidden.v['M/Black'], { phone: '082 123 4567' }), nf);
    assertEquals(await count(db, 'restock_requests'), 0);
  });
});

Deno.test('request_restock_alert: a variant with stock is in_stock, and it is judged when the request is made', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    assertEquals(await ask(db, p.id, p.v['L/Black'], { email: 'a@example.com' }), { ok: false, reason: 'in_stock' });
    assertEquals(await count(db, 'restock_requests'), 0);
    // Sold out, so it can be asked for; back in stock, it can not.
    await db.query(`update public.product_variants set stock = 0 where id = $1`, [p.v['L/Black']]);
    assertEquals(await ask(db, p.id, p.v['L/Black'], { email: 'a@example.com' }), { ok: true });
    await db.query(`update public.product_variants set stock = 1 where id = $1`, [p.v['L/Black']]);
    assertEquals(await ask(db, p.id, p.v['L/Black'], { email: 'b@example.com' }), { ok: false, reason: 'in_stock' });
    // A repeat for an option that has since come back says in_stock too, and the old row stays for the owner.
    assertEquals(await ask(db, p.id, p.v['L/Black'], { email: 'a@example.com' }), { ok: false, reason: 'in_stock' });
    assertEquals(await count(db, 'restock_requests'), 1);
  });
});

Deno.test('request_restock_alert: a phone and an email together, or neither, is refused by the table and keeps nothing', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const m = p.v['M/Black'];
    await assertRejects(() => ask(db, p.id, m, { phone: '082 123 4567', email: 'a@example.com' }), Error, 'check');
    await assertRejects(() => ask(db, p.id, m, {}), Error, 'check');
    await assertRejects(() => ask(db, p.id, m, { phone: '12' }), Error, 'check');
    assertEquals(await count(db, 'restock_requests'), 0);
  });
});

// ---------------------------------------------------------------------------
// The shared address limit.
// ---------------------------------------------------------------------------
Deno.test('restock limit: 5 per address pass, the 6th is rate_limited and writes nothing; no address, no limit', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const m = p.v['M/Black'];
    for (let i = 0; i < 5; i++) assertEquals(await ask(db, p.id, m, { phone: `082000100${i}`, ip: IP }), { ok: true });
    const logBefore = await rows(db, 'select * from public.subscribe_ip_log order by created_at, ip_hash');
    assertEquals(logBefore.length, 5);
    assertEquals(await ask(db, p.id, m, { phone: '0820001009', ip: IP }), { ok: false, reason: 'rate_limited' });
    assertEquals(await count(db, 'restock_requests'), 5);
    assertEquals(await rows(db, 'select * from public.subscribe_ip_log order by created_at, ip_hash'), logBefore);
    // A repeat counts too, and is refused the same way as anything else.
    assertEquals(await ask(db, p.id, m, { phone: '0820001000', ip: IP }), { ok: false, reason: 'rate_limited' });
    // Another address is not affected.
    assertEquals(await ask(db, p.id, m, { phone: '0820001010', ip: '198.51.100.7' }), { ok: true });
    // No address, no limit and no log row.
    for (let i = 0; i < 7; i++) assertEquals(await ask(db, p.id, m, { phone: `082000200${i}` }), { ok: true });
    assertEquals(await ask(db, p.id, m, { phone: '0820003000', ip: '' }), { ok: true });
    assertEquals(await count(db, 'subscribe_ip_log'), 6);
  });
});

Deno.test('restock limit: shared with sign-ups and unsubscribes; not_found and in_stock use a slot too', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const m = p.v['M/Black'];
    assertEquals(await subscribe(db, { phone: '0820001001', ip: IP }), { ok: true });
    assertEquals(await unsubscribe(db, { email: 'n@example.com', ip: IP }), { ok: true });
    assertEquals(await ask(db, p.id, p.v['L/Black'], { phone: '0820001002', ip: IP }), { ok: false, reason: 'in_stock' });
    assertEquals(await ask(db, 'nope', m, { phone: '0820001003', ip: IP }), { ok: false, reason: 'not_found' });
    assertEquals(await ask(db, p.id, m, { phone: '0820001004', ip: IP }), { ok: true });
    const limited = { ok: false, reason: 'rate_limited' };
    assertEquals(await ask(db, p.id, m, { phone: '0820001005', ip: IP }), limited);
    assertEquals(await subscribe(db, { phone: '0820001006', ip: IP }), limited);
    assertEquals(await unsubscribe(db, { email: 'm@example.com', ip: IP }), limited);
    assertEquals(await count(db, 'restock_requests'), 1);
    assertEquals(await count(db, 'subscribers'), 1);
  });
});

Deno.test('restock limit: the hour rolls, old log rows are deleted, and the log holds only the salted hash', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const m = p.v['M/Black'];
    for (let i = 0; i < 5; i++) await ask(db, p.id, m, { phone: `082000100${i}`, ip: IP });
    assertEquals((await ask(db, p.id, m, { phone: '0820001009', ip: IP })).reason, 'rate_limited');
    const salt = (await rows(db, 'select salt from public.order_rate_salt'))[0].salt as string;
    const expected = (await rows(db, `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`, [salt + IP]))[0].h;
    const log = await rows(db, 'select * from public.subscribe_ip_log');
    assertEquals(log.map((l: Json) => l.ip_hash), Array(5).fill(expected));
    assert(!j({ log, requests: await requests(db) }).includes(IP));
    await db.exec(`update public.subscribe_ip_log set created_at = now() - interval '61 minutes'`);
    assertEquals(await ask(db, p.id, m, { phone: '0820001009', ip: IP }), { ok: true });
    assertEquals(await count(db, 'subscribe_ip_log'), 1);
    assertEquals((await rows(db, 'select count(*)::int as n from public.order_rate_salt'))[0].n, 1);
  });
});

// ---------------------------------------------------------------------------
// The 180-day purge.
// ---------------------------------------------------------------------------
Deno.test('request_restock_alert: requests older than 180 days are deleted by any call, with or without an address', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const m = p.v['M/Black'];
    await ask(db, p.id, m, { phone: '0820001001' });
    await ask(db, p.id, m, { phone: '0820001002' });
    await ask(db, p.id, m, { phone: '0820001003' });
    await db.query(`update public.restock_requests set created_at = now() - interval '181 days' where phone = '0820001001'`);
    await db.query(`update public.restock_requests set created_at = now() - interval '179 days' where phone = '0820001002'`);
    // Even a call that finds nothing to do (not_found, in_stock) cleans up.
    assertEquals(await ask(db, 'nope', m, { phone: '0820009999' }), { ok: false, reason: 'not_found' });
    assertEquals((await requests(db)).map((x: Json) => x.phone).sort(), ['0820001002', '0820001003']);
    await db.query(`update public.restock_requests set created_at = now() - interval '200 days' where phone = '0820001002'`);
    assertEquals(await ask(db, p.id, m, { phone: '0820001004', ip: IP }), { ok: true });
    assertEquals((await requests(db)).map((x: Json) => x.phone).sort(), ['0820001003', '0820001004']);
    // The same person may ask again once the old row is gone, and it is a new row.
    await db.query(`update public.restock_requests set created_at = now() - interval '181 days' where phone = '0820001003'`);
    assertEquals(await ask(db, p.id, m, { phone: '0820001003' }), { ok: true });
    const again = (await requests(db)).find((x: Json) => x.phone === '0820001003');
    assert(Date.now() - new Date(again.created_at).getTime() < 60_000);
  });
});

Deno.test('request_restock_alert: at most 200 old requests are deleted per call', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const m = p.v['M/Black'];
    await db.query(
      `insert into public.restock_requests (product_id, variant_id, email, created_at)
       select $1, $2::uuid, 'old' || n || '@example.com', now() - interval '181 days' from generate_series(1, 250) n`,
      [p.id, m],
    );
    assertEquals(await count(db, 'restock_requests'), 250);
    assertEquals(await ask(db, p.id, m, { phone: '0820001001' }), { ok: true });
    assertEquals(await count(db, 'restock_requests'), 51); // 50 old ones left, plus the new one
    assertEquals(await ask(db, p.id, m, { phone: '0820001002' }), { ok: true });
    assertEquals(await count(db, 'restock_requests'), 2);
  });
});

Deno.test('request_restock_alert: over the address limit nothing is purged either', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const m = p.v['M/Black'];
    await insertRow(db, p.id, m, '0820009998', null);
    await db.query(`update public.restock_requests set created_at = now() - interval '181 days'`);
    for (let i = 0; i < 5; i++) await subscribe(db, { phone: `082000100${i}`, ip: IP });
    assertEquals(await ask(db, p.id, m, { phone: '0820001009', ip: IP }), { ok: false, reason: 'rate_limited' });
    assertEquals(await count(db, 'restock_requests'), 1);
  });
});

// ---------------------------------------------------------------------------
// Owner functions and cascades.
// ---------------------------------------------------------------------------
Deno.test('list_restock_requests_admin: oldest first, with the option\'s current details; empty is []', async () => {
  await withDb(async (db) => {
    assertEquals(await listAdmin(db), []);
    const p = await shop(db);
    await ask(db, p.id, p.v['S/Red'], { email: 'first@example.com' });
    await ask(db, p.id, p.v['M/Black'], { phone: '082 123 4567' });
    await ask(db, p.id, p.v['M/Black'], { email: 'third@example.com' });
    await db.query(`update public.restock_requests set created_at = now() - interval '3 days' where email = 'first@example.com'`);
    await db.query(`update public.restock_requests set created_at = now() - interval '2 days' where phone = '082 123 4567'`);
    const list = await listAdmin(db);
    assertEquals(list.map((r: Json) => r.email ?? r.phone), ['first@example.com', '082 123 4567', 'third@example.com']);
    const [first] = list;
    assertEquals(Object.keys(first).sort(), [
      'color', 'createdAt', 'email', 'id', 'phone', 'productId', 'productName', 'productSlug', 'size', 'stock', 'variantId',
    ]);
    const slug = (await rows(db, 'select slug from public.products where id = $1', [p.id]))[0].slug;
    assertEquals(
      { ...first, id: undefined, createdAt: undefined },
      {
        id: undefined,
        productId: p.id,
        productName: 'Classic Tee',
        productSlug: slug,
        variantId: p.v['S/Red'],
        size: 'S',
        color: 'Red',
        stock: 0,
        phone: null,
        email: 'first@example.com',
        createdAt: undefined,
      },
    );
    assert(!Number.isNaN(Date.parse(first.createdAt)));
    // When the option comes back, the owner sees it.
    await db.query(`update public.product_variants set stock = 6 where id = $1`, [p.v['M/Black']]);
    assertEquals(list.map((r: Json) => r.stock), [0, 0, 0]);
    assertEquals((await listAdmin(db)).map((r: Json) => r.stock), [0, 6, 6]);
  });
});

Deno.test('delete_restock_request: true when it existed, false after, and only that row goes', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    await ask(db, p.id, p.v['M/Black'], { phone: '082 123 4567' });
    await ask(db, p.id, p.v['M/Black'], { email: 'a@example.com' });
    const [one, two] = await listAdmin(db);
    assertEquals(await call(db, 'public.delete_restock_request($1::uuid)', one.id), true);
    assertEquals(await call(db, 'public.delete_restock_request($1::uuid)', one.id), false);
    assertEquals(await call(db, 'public.delete_restock_request($1::uuid)', crypto.randomUUID()), false);
    assertEquals((await listAdmin(db)).map((r: Json) => r.id), [two.id]);
    // The person can ask again after the owner has told them.
    assertEquals(await ask(db, p.id, p.v['M/Black'], { phone: '082 123 4567' }), { ok: true });
    assertEquals((await listAdmin(db)).length, 2);
  });
});

Deno.test('cascade: deleting a product or a variant deletes its requests', async () => {
  await withDb(async (db) => {
    const a = await mkProduct(db, 'Gone Tee', [['M', 'Black', 0], ['L', 'Black', 0]]);
    const b = await shop(db);
    await ask(db, a.id, a.v['M/Black'], { phone: '082 123 4567' });
    await ask(db, a.id, a.v['L/Black'], { phone: '082 123 4567' });
    await ask(db, b.id, b.v['M/Black'], { phone: '082 123 4567' });
    assertEquals(await count(db, 'restock_requests'), 3);
    await db.query('delete from public.product_variants where id = $1', [a.v['L/Black']]);
    assertEquals(await count(db, 'restock_requests'), 2);
    assertEquals(await call(db, 'public.delete_product($1)', a.id), true);
    assertEquals((await requests(db)).map((r: Json) => r.product_id), [b.id]);
    assertEquals((await listAdmin(db)).length, 1);
  });
});

// ---------------------------------------------------------------------------
// unsubscribe_contact.
// ---------------------------------------------------------------------------
Deno.test('unsubscribe_contact: removes the restock requests of that contact in any spelling, and keeps everyone else\'s', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    const [m, s] = [p.v['M/Black'], p.v['S/Red']];
    await ask(db, p.id, m, { phone: '082 123 4567' });
    await ask(db, p.id, s, { phone: '+27 82 123 4567' }); // the same person on another option
    await ask(db, p.id, m, { email: 'Thandi@Example.com' });
    await ask(db, p.id, m, { phone: '083 000 1111' });
    await ask(db, p.id, s, { email: 'keep@example.com' });
    assertEquals(await count(db, 'restock_requests'), 5);

    // An unknown contact, or none at all, removes nothing and answers the same.
    for (const o of [{ phone: '084 999 9999' }, { email: 'nobody@example.com' }, { phone: '  ', email: '' }, { phone: '---' }, {}]) {
      assertEquals(await unsubscribe(db, o), { ok: true }, j(o));
    }
    assertEquals(await count(db, 'restock_requests'), 5);

    assertEquals(await unsubscribe(db, { phone: '0027821234567' }), { ok: true });
    assertEquals((await listAdmin(db)).map((r: Json) => r.email ?? r.phone), ['Thandi@Example.com', '083 000 1111', 'keep@example.com']);
    assertEquals(await unsubscribe(db, { email: 'thandi@example.com' }), { ok: true });
    assertEquals((await listAdmin(db)).map((r: Json) => r.email ?? r.phone), ['083 000 1111', 'keep@example.com']);
    // A phone and an email together remove both people's requests.
    assertEquals(await unsubscribe(db, { phone: '083 000 1111', email: 'KEEP@example.com' }), { ok: true });
    assertEquals(await count(db, 'restock_requests'), 0);
  });
});

Deno.test('unsubscribe_contact: still opts a subscriber out and keeps the row, and removes requests of a contact who never subscribed', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    await subscribe(db, { phone: '0821234567' });
    await ask(db, p.id, p.v['M/Black'], { phone: '082 123 4567' });
    await ask(db, p.id, p.v['M/Black'], { email: 'never@example.com' });
    assertEquals(await unsubscribe(db, { phone: '+27 82 123 4567' }), { ok: true });
    const [sub] = await rows(db, 'select * from public.subscribers');
    assert(sub.unsubscribed_at);
    assertEquals(sub.consent_text, TEXT);
    assertEquals((await listAdmin(db)).map((r: Json) => r.email), ['never@example.com']);
    // The first opt-out time is kept on a second call.
    assertEquals(await unsubscribe(db, { email: 'never@example.com' }), { ok: true });
    assertEquals((await rows(db, 'select * from public.subscribers'))[0].unsubscribed_at, sub.unsubscribed_at);
    assertEquals(await count(db, 'restock_requests'), 0);
  });
});

Deno.test('unsubscribe_contact: over the address limit it removes no restock request and writes nothing', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    await ask(db, p.id, p.v['M/Black'], { phone: '082 123 4567' });
    for (let i = 0; i < 5; i++) assertEquals(await unsubscribe(db, { email: `n${i}@example.com`, ip: IP }), { ok: true });
    assertEquals(await unsubscribe(db, { phone: '082 123 4567', ip: IP }), { ok: false, reason: 'rate_limited' });
    assertEquals(await count(db, 'restock_requests'), 1);
    assertEquals(await unsubscribe(db, { phone: '082 123 4567', ip: '198.51.100.7' }), { ok: true });
    assertEquals(await count(db, 'restock_requests'), 0);
  });
});

// ---------------------------------------------------------------------------
// RLS and grants.
// ---------------------------------------------------------------------------
const TABLES = ['restock_requests'];
const FUNCTIONS = [
  'public.request_restock_alert(text,uuid,text,text,text)',
  'public.list_restock_requests_admin()',
  'public.delete_restock_request(uuid)',
  // Replaced here; same grants as before.
  'public.unsubscribe_contact(text,text,text)',
];

Deno.test('RLS and grants: the table has RLS and no policies; anon and authenticated can touch nothing', async () => {
  await withDb(async (db) => {
    const p = await shop(db);
    await ask(db, p.id, p.v['M/Black'], { phone: '082 123 4567' });
    for (const t of TABLES) {
      assertEquals(
        (await rows(db, `select relrowsecurity as rls from pg_class where oid = $1::regclass`, [`public.${t}`]))[0].rls,
        true,
        t,
      );
      assertEquals((await rows(db, `select count(*)::int as n from pg_policies where tablename = $1`, [t]))[0].n, 0, t);
      for (const role of ['anon', 'authenticated']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          assertEquals(
            (await rows(db, `select has_table_privilege($1, $2::regclass, $3) as ok`, [role, `public.${t}`, priv]))[0].ok,
            false,
            `${role} ${priv} ${t}`,
          );
        }
      }
    }
    const [req] = await listAdmin(db);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        for (const t of TABLES) await assertRejects(() => db.query(`select * from public.${t}`), Error, 'permission denied');
        await assertRejects(() => db.query(`delete from public.restock_requests`), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.list_restock_requests_admin()`), Error, 'permission denied');
        await assertRejects(
          () => db.query(`select public.request_restock_alert($1, $2::uuid, '0821234567', null, null)`, [p.id, p.v['M/Black']]),
          Error,
          'permission denied',
        );
        await assertRejects(
          () => db.query(`select public.delete_restock_request($1::uuid)`, [req.id]),
          Error,
          'permission denied',
        );
        await assertRejects(() => db.query(`select public.unsubscribe_contact('0821234567', null, null)`), Error, 'permission denied');
      } finally {
        await db.exec('reset role');
      }
    }
    assertEquals(await count(db, 'restock_requests'), 1);
  });
});

Deno.test('RLS and grants: every function is service_role only, and the list covers every function the migration creates', async () => {
  await withDb(async (db) => {
    for (const sig of FUNCTIONS) {
      for (const role of ['anon', 'authenticated']) {
        assertEquals(
          (await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]))[0].ok,
          false,
          `${role} ${sig}`,
        );
      }
      assertEquals(
        (await rows(db, `select has_function_privilege('service_role', $1, 'execute') as ok`, [sig]))[0].ok,
        true,
        sig,
      );
    }
    const created = [...(await readMigration(RESTOCK_MIGRATION)).matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    const covered = new Set(FUNCTIONS.map((s) => s.slice('public.'.length, s.indexOf('('))));
    for (const name of created) assert(covered.has(name), `${name} has no grant check`);
    assertEquals(created.length, covered.size);
  });
});

// ---------------------------------------------------------------------------
// The migration itself.
// ---------------------------------------------------------------------------
Deno.test('migration: adds three functions, changes no other function, and unsubscribe_contact differs only by the restock delete', async () => {
  const db = await after();
  const base = await functionsBefore!;
  const now = await functionDefs(db);
  const byName = new Map(now.map((f) => [f.sig as string, f]));
  for (const f of base) {
    const same = byName.get(f.sig);
    assert(same, `${f.sig} is gone`);
    assertEquals(same.acl, f.acl, `${f.sig} grants changed`);
    if (f.sig === 'unsubscribe_contact(text,text,text)') continue;
    assertEquals(same.def, f.def, `${f.sig} changed`);
  }
  assertEquals(now.length - base.length, 3);
  assertEquals(
    now.filter((f) => !base.some((b) => b.sig === f.sig)).map((f) => f.sig).sort(),
    ['delete_restock_request(uuid)', 'list_restock_requests_admin()', 'request_restock_alert(text,uuid,text,text,text)'],
  );
  // Same function, plus exactly one statement: take it out and the definition is the old one, character for character.
  const added = `    delete from public.restock_requests
    where (v_pn is not null and phone is not null and public.normalise_phone(phone) = v_pn)
       or (v_email is not null and email is not null and lower(email) = lower(v_email));
`;
  const oldDef = base.find((f) => f.sig === 'unsubscribe_contact(text,text,text)').def as string;
  const newDef = byName.get('unsubscribe_contact(text,text,text)').def as string;
  assert(newDef.includes(added));
  assertEquals(newDef.replace(added, ''), oldDef);
});

Deno.test('migration: a second run changes nothing and keeps the data and the grants', async () => {
  await withDb(async (db) => {
    const sql = await readMigration(RESTOCK_MIGRATION);
    const dump = async () => ({
      columns: await rows(db, `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'restock_requests' order by ordinal_position`),
      indexes: await rows(db, `select indexname, indexdef from pg_indexes where tablename = 'restock_requests' order by 1`),
      constraints: await rows(db, `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.restock_requests'::regclass order by 1`),
      rls: await rows(db, `select relrowsecurity from pg_class where oid = 'public.restock_requests'::regclass`),
      tableAcl: await rows(db, `select relacl::text as acl from pg_class where oid = 'public.restock_requests'::regclass`),
      functions: await functionDefs(db),
      data: await rows(db, 'select to_jsonb(r) as r from public.restock_requests r order by r.id'),
    });
    const p = await shop(db);
    await ask(db, p.id, p.v['M/Black'], { phone: '082 123 4567' });
    await ask(db, p.id, p.v['S/Red'], { email: 'a@example.com' });
    const first = await dump();
    assertEquals(first.indexes.length, 4); // the primary key, two unique indexes and created_at
    await db.exec(sql);
    assertEquals(await dump(), first);
    await db.exec(sql);
    assertEquals(await dump(), first);
    // The repeat still works afterwards.
    assertEquals(await ask(db, p.id, p.v['M/Black'], { phone: '+27 82 123 4567' }), { ok: true });
    assertEquals(await count(db, 'restock_requests'), 2);
  });
});

Deno.test('teardown', async () => {
  if (afterDb) await (await afterDb).close();
  if (beforeDb) await (await beforeDb).close();
});
