// Tests for supabase/migrations/20261031170000_delivery_admin.sql (list_delivery_options_admin and
// update_delivery_option), run against an in-process Postgres (PGlite) with every migration before it applied. Run with
// `deno task test:sql` from supabase/functions/server. The memory store in dev.ts mirrors these rules and is tested in
// supabase/functions/server/delivery.test.ts.
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
const DELIVERY_ADMIN_MIGRATION = '20261031170000_delivery_admin.sql';
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

/** `before` plus the delivery admin migration, applied once. */
function after(): Promise<Db> {
  afterDb ??= (async () => {
    const base = await before();
    functionsBefore = functionDefs(base);
    const db = await base.clone();
    await db.exec(await readMigration(DELIVERY_ADMIN_MIGRATION));
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
const listAll = (db: Db): Promise<Json[]> => call(db, 'public.list_delivery_options_admin()');
const update = (db: Db, id: string, patch: unknown): Promise<Json> =>
  call(db, 'public.update_delivery_option($1, $2::jsonb)', id, j(patch));
const FUNCTIONS = ['public.list_delivery_options_admin()', 'public.update_delivery_option(text, jsonb)'];

Deno.test('list: every option in sort order with sort and active, price without trailing zeros', async () => {
  await withDb(async (db) => {
    assertEquals(await listAll(db), [
      { id: 'door', name: 'Door delivery', price: 85, sort: 1, active: true },
      { id: 'locker', name: 'Locker', price: 55, sort: 2, active: true },
      { id: 'collect', name: 'Collect', price: 0, sort: 3, active: true },
    ]);
    await db.exec(`update public.delivery_options set price = 49.50 where id = 'locker'`);
    assertEquals((await listAll(db))[1].price, 49.5);
  });
});

Deno.test('list: an inactive option is in the admin list and not in the public list; ties on sort break by id', async () => {
  await withDb(async (db) => {
    await db.exec(`update public.delivery_options set active = false, sort = 1 where id = 'locker'`);
    const all = await listAll(db);
    assertEquals(all.map((o: Json) => o.id), ['door', 'locker', 'collect']);
    assertEquals(all[1].active, false);
    assertEquals((await call(db, 'public.list_delivery_options()')).map((o: Json) => o.id), ['door', 'collect']);
  });
});

Deno.test('update: sets name, price and active and returns the option', async () => {
  await withDb(async (db) => {
    assertEquals(await update(db, 'door', { name: 'Courier', price: 99.5, active: true }), {
      ok: true,
      option: { id: 'door', name: 'Courier', price: 99.5, sort: 1, active: true },
    });
    assertEquals((await listAll(db))[0], { id: 'door', name: 'Courier', price: 99.5, sort: 1, active: true });
    const r = await update(db, 'locker', { name: 'Locker', price: 60.00, active: false });
    assertEquals(r.option.price, 60);
    assertEquals(r.option.active, false);
    // The public list now shows the new price and hides the inactive option.
    assertEquals(await call(db, 'public.list_delivery_options()'), [
      { id: 'door', name: 'Courier', price: 99.5 },
      { id: 'collect', name: 'Collect', price: 0 },
    ]);
  });
});

Deno.test('update: a key missing from the patch keeps the stored value', async () => {
  await withDb(async (db) => {
    const r = await update(db, 'door', { price: 90 });
    assertEquals(r.option, { id: 'door', name: 'Door delivery', price: 90, sort: 1, active: true });
  });
});

Deno.test('update: unknown id is not_found and changes nothing', async () => {
  await withDb(async (db) => {
    const was = await listAll(db);
    assertEquals(await update(db, 'drone', { name: 'Drone', price: 1, active: true }), { ok: false, reason: 'not_found' });
    assertEquals(await listAll(db), was);
  });
});

Deno.test('update: turning off the last active option is last_active and changes nothing', async () => {
  await withDb(async (db) => {
    assertEquals((await update(db, 'door', { name: 'Door delivery', price: 85, active: false })).ok, true);
    assertEquals((await update(db, 'locker', { name: 'Locker', price: 55, active: false })).ok, true);
    const was = await listAll(db);
    // Collect is the last one on: it cannot go off, and a rename or price change sent with it is not applied either.
    assertEquals(await update(db, 'collect', { name: 'Pick up', price: 5, active: false }), {
      ok: false,
      reason: 'last_active',
    });
    assertEquals(await listAll(db), was);
    // It can still be edited while staying on, and an off option can be turned back on.
    assertEquals((await update(db, 'collect', { name: 'Pick up', price: 5, active: true })).ok, true);
    assertEquals((await update(db, 'door', { name: 'Door delivery', price: 85, active: true })).ok, true);
    assertEquals((await update(db, 'collect', { name: 'Pick up', price: 5, active: false })).ok, true);
  });
});

Deno.test('update: saving an already-off option as off is fine, even when no other option is on', async () => {
  await withDb(async (db) => {
    await db.exec(`update public.delivery_options set active = false`);
    assertEquals((await update(db, 'door', { name: 'Door', price: 80, active: false })).ok, true);
  });
});

Deno.test('update: the check constraint still refuses a negative price', async () => {
  await withDb(async (db) => {
    await assertRejects(() => update(db, 'door', { name: 'Door', price: -1, active: true }), Error, 'check');
    assertEquals((await listAll(db))[0].price, 85);
  });
});

Deno.test('update: the new price is what place_order_v3 charges', async () => {
  await withDb(async (db) => {
    await call(db, `public.upsert_category('tees', 'Tees', 0, true)`);
    const pid = crypto.randomUUID();
    const made = await call(db, 'public.create_product($1, $2::jsonb)', pid, j({
      name: 'Tee', category: 'tees', price: 100, description: '', images: [], sizes: ['M'], colors: ['Red'],
      variants: [{ size: 'M', color: 'Red', stock: 5 }],
    }));
    assert(made.ok, j(made));
    await update(db, 'door', { name: 'Door delivery', price: 120.5, active: true });
    const r = await call(
      db,
      'public.place_order_v3($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb)',
      crypto.randomUUID(),
      j([{ productId: pid, size: 'M', color: 'Red', quantity: 1 }]),
      j({ name: 'Test', phone: '0821234567' }),
      j({ delivery: { method: 'door', address: { line1: '12 Main Rd', suburb: 'Sea Point', city: 'Cape Town', postalCode: '8005' } } }),
    );
    assert(r.ok, j(r));
    assertEquals(Number(r.order.deliveryFee), 120.5);
    assertEquals(Number(r.order.total), 220.5);
    // A turned-off option is refused on orders.
    await update(db, 'locker', { name: 'Locker', price: 55, active: false });
    const off = await call(
      db,
      'public.place_order_v3($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb)',
      crypto.randomUUID(),
      j([{ productId: pid, size: 'M', color: 'Red', quantity: 1 }]),
      j({ name: 'Test', phone: '0821234567' }),
      j({ delivery: { method: 'locker', locker: 'Pudo Sea Point' } }),
    );
    assertEquals(off.ok, false);
  });
});

Deno.test('grants: both functions are service_role only, and the list covers every function the migration creates', async () => {
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
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await assertRejects(() => db.query('select public.list_delivery_options_admin()'), Error, 'permission denied');
        await assertRejects(
          () => db.query(`select public.update_delivery_option('door', '{"name":"x","price":1,"active":true}'::jsonb)`),
          Error,
          'permission denied',
        );
      } finally {
        await db.exec('reset role');
      }
    }
    assertEquals((await listAll(db))[0].price, 85);
    const created = [...(await readMigration(DELIVERY_ADMIN_MIGRATION)).matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    const covered = new Set(FUNCTIONS.map((s) => s.slice('public.'.length, s.indexOf('('))));
    for (const name of created) assert(covered.has(name), `${name} has no grant check`);
    assertEquals(created.length, covered.size);
  });
});

Deno.test('migration: adds two functions, changes no other, and is safe to re-run without touching edited rows', async () => {
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
  assertEquals(now.length, base.length + 2);
  assertEquals(
    now.filter((f) => !base.some((b) => b.sig === f.sig)).map((f) => f.sig),
    ['list_delivery_options_admin()', 'update_delivery_option(text,jsonb)'],
  );
  const copy = await db.clone();
  try {
    await update(copy, 'door', { name: 'Courier', price: 99, active: true });
    await copy.exec(await readMigration(DELIVERY_ADMIN_MIGRATION));
    assertEquals((await listAll(copy))[0], { id: 'door', name: 'Courier', price: 99, sort: 1, active: true });
    assertEquals(await functionDefs(copy), now);
  } finally {
    await copy.close();
  }
});
