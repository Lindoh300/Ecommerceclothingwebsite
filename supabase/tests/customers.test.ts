// Tests for supabase/migrations/20261031180000_customers.sql (list_customers), run against an in-process Postgres (PGlite) with every migration before it applied. Run with
// `deno task test:sql` from supabase/functions/server. The memory store in dev.ts mirrors these rules and is tested in
// supabase/functions/server/customers.test.ts, with the same orders and the same expected list.
//
// PGlite is ONE connection, so these tests cannot show real races between concurrent transactions. They check the
// logic, the grants, and that the migration is additive and safe to re-run.
import { assert, assertEquals, assertRejects } from '@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.13';
import { pgcrypto } from 'npm:@electric-sql/pglite@0.5.13/contrib/pgcrypto';

// deno-lint-ignore no-explicit-any
type Json = any;
type Db = Awaited<ReturnType<PGlite['clone']>>;

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const readMigration = (name: string) => Deno.readTextFile(new URL(name, MIGRATIONS));
const CUSTOMERS_MIGRATION = '20261031180000_customers.sql';
// Every migration before the delivery admin one, in order. The pg_cron migration is never loaded: PGlite has no pg_cron.
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

/** `before` plus the customers migration, applied once. */
function after(): Promise<Db> {
  afterDb ??= (async () => {
    const base = await before();
    functionsBefore = functionDefs(base);
    const db = await base.clone();
    await db.exec(await readMigration(CUSTOMERS_MIGRATION));
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

const T = (n: number) => `2026-10-${String(n).padStart(2, '0')}T10:00:00.000Z`;
const list = (db: Db): Promise<Json[]> => call(db, 'public.list_customers()');
/** lastOrderAt as Postgres prints it differs from the memory store's text, so compare it as an instant. */
const norm = (cs: Json[]) => cs.map((c) => ({ ...c, lastOrderAt: new Date(c.lastOrderAt).toISOString() }));

async function addOrder(
  db: Db,
  o: { phone: string; name?: string; email?: string; status: string; total: number; at: string; id?: string },
): Promise<void> {
  const customer: Json = { name: o.name ?? 'Test', phone: o.phone, ...(o.email === undefined ? {} : { email: o.email }) };
  const id = o.id ?? crypto.randomUUID();
  await db.query(
    `insert into public.orders (id, ref, created_at, status, lines, total, customer)
     values ($1, $2, $3, $4, '[]'::jsonb, $5, $6::jsonb)`,
    [id, id.slice(0, 8).toUpperCase(), o.at, o.status, o.total, JSON.stringify(customer)],
  );
}

/** The shared scenario (also in customers.test.ts, same data, same expected list). */
async function scenario(db: Db) {
  const a = (phone: string, name: string, status: string, total: number, at: string, email?: string) =>
    addOrder(db, { phone, name, status, total, at, email });
  await a('0821234567', 'Ann Old', 'pending', 100, T(1), 'ann@x.com');
  await a('+27 82 123 4567', 'Ann Mid', 'shipped', 50, T(3));
  await a('082 123 4567', 'Ann', 'paid', 200.5, T(5));
  await a('0719998888', 'Bea', 'delivered', 80, T(2));
  await a('0719998888', 'Bea', 'refunded', 40, T(4));
  await a('0719998888', 'Bea', 'cancelled', 30, T(6));
  await a('0605554444', 'Cy', 'cancelled', 70, T(7), '   ');
  await a('0605554444', 'Cy', 'expired', 20, T(8));
  await a('0731112222', 'Di', 'packed', 10, T(1), 'di@x.com');
  await a('0731112222', 'Di', 'awaiting_payment', 60, T(9));
  await a('0830000002', 'Flo', 'pending', 20, T(5), 'flo@x.com');
  await subscribe(db, { phone: '+27821234567' });
  await subscribe(db, { phone: '0719998888' });
  await db.exec(`update public.subscribers set unsubscribed_at = now() where phone = '0719998888'`);
  await subscribe(db, { email: 'flo@x.com' });
}

async function subscribe(db: Db, s: { phone?: string; email?: string }) {
  await db.query(
    `insert into public.subscribers (phone, email, consent_text, consent_at, source) values ($1, $2, 'consent', now(), 'footer')`,
    [s.phone ?? null, s.email ?? null],
  );
}

const EXPECTED = [
  { phone: '0731112222', name: 'Di', email: 'di@x.com', orders: 2, spent: 10, lastOrderAt: T(9), subscribed: false },
  { phone: '0605554444', name: 'Cy', email: null, orders: 0, spent: 0, lastOrderAt: T(8), subscribed: false },
  { phone: '0719998888', name: 'Bea', email: null, orders: 2, spent: 80, lastOrderAt: T(6), subscribed: false },
  { phone: '082 123 4567', name: 'Ann', email: 'ann@x.com', orders: 3, spent: 250.5, lastOrderAt: T(5), subscribed: true },
  { phone: '0830000002', name: 'Flo', email: 'flo@x.com', orders: 1, spent: 0, lastOrderAt: T(5), subscribed: false },
];

Deno.test('list_customers: empty with no orders', async () => {
  await withDb(async (db) => {
    assertEquals(await list(db), []);
  });
});

Deno.test('list_customers: the scenario gives the expected list (same as the memory test)', async () => {
  await withDb(async (db) => {
    await scenario(db);
    assertEquals(norm(await list(db)), EXPECTED);
  });
});

Deno.test('list_customers: one number written differently is one customer; other numbers are not', async () => {
  await withDb(async (db) => {
    for (const [i, phone] of ['0821234567', '082 123 4567', '+27 82 123 4567', '(082) 123-4567', '0821234568'].entries()) {
      await addOrder(db, { phone, status: 'paid', total: 10, at: T(i + 1) });
    }
    assertEquals((await list(db)).map((c: Json) => [c.phone, c.orders]), [['0821234568', 1], ['(082) 123-4567', 4]]);
  });
});

Deno.test('list_customers: each status group counts as the rules say', async () => {
  await withDb(async (db) => {
    const rows: [string, number, number][] = [
      ['pending', 0, 1], ['awaiting_payment', 0, 1], ['paid', 10, 1], ['packed', 10, 1], ['shipped', 10, 1],
      ['delivered', 10, 1], ['refunded', 0, 1], ['cancelled', 0, 0], ['expired', 0, 0],
    ];
    for (const [i, [status, spent, orders]] of rows.entries()) {
      const phone = `07300000${String(i).padStart(2, '0')}`;
      await addOrder(db, { phone, status, total: 10, at: T(i + 1) });
      const c = (await list(db)).find((x: Json) => x.phone === phone);
      assertEquals([status, c.spent, c.orders], [status, spent, orders]);
    }
  });
});

Deno.test('list_customers: spent is exact and has no trailing zeros', async () => {
  await withDb(async (db) => {
    for (const [i, total] of [0.1, 0.2, 100.05].entries()) {
      await addOrder(db, { phone: '0821234567', status: 'paid', total, at: T(i + 1) });
    }
    assertEquals((await list(db))[0].spent, 100.35);
    await addOrder(db, { phone: '0821234567', status: 'paid', total: 0.65, at: T(5) });
    assertEquals((await list(db))[0].spent, 101);
  });
});

Deno.test('list_customers: ties on the newest time take the lower id for name and phone', async () => {
  await withDb(async (db) => {
    await addOrder(db, { id: '00000000-0000-0000-0000-000000000002', phone: '0821234567', name: 'Second', status: 'paid', total: 1, at: T(1) });
    await addOrder(db, { id: '00000000-0000-0000-0000-000000000001', phone: '082 123 4567', name: 'First', status: 'paid', total: 1, at: T(1) });
    const [c] = await list(db);
    assertEquals([c.name, c.phone], ['First', '082 123 4567']);
  });
});

Deno.test('list_customers: subscribed follows the phone only, and is false after an opt-out', async () => {
  await withDb(async (db) => {
    await addOrder(db, { phone: '0821234567', status: 'paid', total: 10, at: T(1), email: 'ann@x.com' });
    assertEquals((await list(db))[0].subscribed, false);
    await subscribe(db, { email: 'ann@x.com' });
    assertEquals((await list(db))[0].subscribed, false);
    await subscribe(db, { phone: '+27 82 123 4567' });
    assertEquals((await list(db))[0].subscribed, true);
    await db.exec(`update public.subscribers set unsubscribed_at = now() where phone is not null`);
    assertEquals((await list(db))[0].subscribed, false);
  });
});

Deno.test('list_customers: an order with no usable phone never reads as subscribed', async () => {
  await withDb(async (db) => {
    await subscribe(db, { email: 'a@x.com' });
    await db.query(
      `insert into public.orders (id, ref, created_at, status, lines, total, customer) values ($1, 'NOPHONE1', $2, 'paid', '[]', 5, '{"name":"X"}')`,
      [crypto.randomUUID(), T(1)],
    );
    assertEquals((await list(db))[0].subscribed, false);
  });
});

Deno.test('grants: list_customers is service_role only, and the list covers every function the migration creates', async () => {
  await withDb(async (db) => {
    const sig = 'public.list_customers()';
    for (const role of ['anon', 'authenticated']) {
      assertEquals((await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]))[0].ok, false, role);
      await db.exec(`set role ${role}`);
      try {
        await assertRejects(() => db.query('select public.list_customers()'), Error, 'permission denied');
      } finally {
        await db.exec('reset role');
      }
    }
    assertEquals((await rows(db, `select has_function_privilege('service_role', $1, 'execute') as ok`, [sig]))[0].ok, true);
    await db.exec('set role service_role');
    try {
      assertEquals(await list(db), []);
    } finally {
      await db.exec('reset role');
    }
    const created = [...(await readMigration(CUSTOMERS_MIGRATION)).matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    assertEquals(created, ['list_customers']);
    const [f] = await rows(db, `select prosecdef, provolatile, proconfig::text as cfg from pg_proc where proname = 'list_customers'`);
    assertEquals([f.prosecdef, f.provolatile, f.cfg], [true, 's', '{search_path=public}']);
  });
});

Deno.test('migration: adds one function, changes no other, creates no table, and is safe to re-run', async () => {
  const db = await after();
  const base = await functionsBefore!;
  const now = await functionDefs(db);
  const byName = new Map(now.map((f) => [f.sig as string, f]));
  for (const f of base) {
    const same = byName.get(f.sig);
    assert(same, `${f.sig} is gone`);
    assertEquals(same.def, f.def, `${f.sig} changed`);
    assertEquals(same.acl, f.acl, `${f.sig} grants changed`);
  }
  assertEquals(now.length, base.length + 1);
  assertEquals(now.filter((f) => !base.some((b) => b.sig === f.sig)).map((f) => f.sig), ['list_customers()']);
  const copy = await db.clone();
  try {
    await copy.exec(await readMigration(CUSTOMERS_MIGRATION));
    assertEquals(await functionDefs(copy), now);
  } finally {
    await copy.close();
  }
  assertEquals(
    (await rows(db, `select count(*)::int as n from information_schema.tables where table_schema = 'public'`))[0].n,
    (await rows(await before(), `select count(*)::int as n from information_schema.tables where table_schema = 'public'`))[0].n,
  );
});
