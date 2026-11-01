// Tests for supabase/migrations/20261101100000_fit_photos.sql (the fit wall), run against an in-process Postgres (PGlite) with every migration before it applied. Run with
// `deno task test:sql` from supabase/functions/server. The memory store in dev.ts mirrors these rules and is tested in
// supabase/functions/server/dev.ts, if at all.
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
const MIGRATION = '20261101100000_fit_photos.sql';
const IMAGE_LIMIT_MIGRATION = '20261101110000_fit_image_limit.sql';
// Every migration before the fit photos one, in order. The pg_cron migration is never loaded: PGlite has no pg_cron.
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
  '20261031190000_discounts.sql',
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

/** `before` plus the fit photos and fit image limit migrations, applied once. */
function after(): Promise<Db> {
  afterDb ??= (async () => {
    const base = await before();
    functionsBefore = functionDefs(base);
    const db = await base.clone();
    await db.exec(await readMigration(MIGRATION));
    // Start the bucket at the old 2 MB limit, so the image limit migration has something to change.
    await db.exec(`
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('product-images', 'product-images', true, 2097152, null)
      on conflict (id) do update set file_size_limit = 2097152;
    `);
    await db.exec(await readMigration(IMAGE_LIMIT_MIGRATION));
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

const FN_SIGS = [
  'public.list_fit_photos_public()', 'public.list_fit_photos_admin()', 'public.upsert_fit_photo(jsonb)',
  'public.delete_fit_photo(text)', 'public.hide_fit_photo(text)', 'public.claim_fit_sync(integer)',
  'public.finish_fit_sync(text)', 'public.fit_sync_status()',
];
const D = (n: number) => `2026-10-${String(n).padStart(2, '0')}T08:00:00.000Z`;
const up = (db: Db, id: string, at: string, extra: Json = {}) =>
  call(
    db,
    'public.upsert_fit_photo($1::jsonb)',
    JSON.stringify({ id, image: `https://img/${id}.jpg`, path: `fit/${id}.jpg`, username: `u_${id}`, permalink: `https://ig/${id}`, postedAt: at, ...extra }),
  );
const pub = (db: Db): Promise<Json[]> => call(db, 'public.list_fit_photos_public()');
const admin = (db: Db): Promise<Json[]> => call(db, 'public.list_fit_photos_admin()');

Deno.test('public list: empty array when there are no photos', async () => {
  await withDb(async (db) => {
    assertEquals(await pub(db), []);
    assertEquals(await admin(db), []);
  });
});

Deno.test('public list: caps at 6, newest first, ties by media id descending', async () => {
  await withDb(async (db) => {
    for (let i = 1; i <= 8; i++) await up(db, `m${i}`, D(i));
    await up(db, 'a', D(8));
    await up(db, 'z', D(8));
    const l = await pub(db);
    assertEquals(l.map((p) => p.id), ['z', 'm8', 'a', 'm7', 'm6', 'm5']);
    assertEquals(Object.keys(l[0]).sort(), ['id', 'image', 'permalink', 'postedAt', 'username']);
    assertEquals(l[0].username, 'u_z');
    assertEquals(new Date(l[0].postedAt).toISOString(), D(8));
  });
});

Deno.test('public list: leaves out hidden rows and rows with no image', async () => {
  await withDb(async (db) => {
    await up(db, 'ok', D(1));
    await up(db, 'noimg', D(3), { image: '' });
    await up(db, 'gone', D(4));
    await call(db, `public.hide_fit_photo('gone')`);
    assertEquals((await pub(db)).map((p) => p.id), ['ok']);
    // Hidden and blank rows still show to the admin.
    assertEquals((await admin(db)).map((p) => p.id), ['gone', 'noimg', 'ok']);
  });
});

Deno.test('admin list: every row with path and hidden', async () => {
  await withDb(async (db) => {
    await up(db, 'a', D(1));
    await up(db, 'b', D(2));
    await call(db, `public.hide_fit_photo('b')`);
    const l = await admin(db);
    assertEquals(l.map((p) => p.id), ['b', 'a']);
    assertEquals(Object.keys(l[1]).sort(), ['hidden', 'id', 'image', 'path', 'permalink', 'postedAt', 'username']);
    assertEquals([l[0].hidden, l[0].path, l[0].image], [true, '', '']);
    assertEquals([l[1].hidden, l[1].path], [false, 'fit/a.jpg']);
  });
});

Deno.test('upsert: inserts, then updates in place; true both times', async () => {
  await withDb(async (db) => {
    assertEquals(await up(db, 'a', D(1)), true);
    assertEquals(await up(db, 'a', D(2), { username: 'changed', image: 'https://img/new.jpg' }), true);
    const l = await admin(db);
    assertEquals(l.length, 1);
    assertEquals([l[0].username, l[0].image], ['changed', 'https://img/new.jpg']);
    assertEquals(new Date(l[0].postedAt).toISOString(), D(2));
  });
});

Deno.test('upsert: refuses a hidden row and changes nothing', async () => {
  await withDb(async (db) => {
    await up(db, 'a', D(1));
    await call(db, `public.hide_fit_photo('a')`);
    assertEquals(await up(db, 'a', D(5), { username: 'back' }), false);
    const [r] = await admin(db);
    assertEquals([r.hidden, r.image, r.path, r.username], [true, '', '', 'u_a']);
    assertEquals(new Date(r.postedAt).toISOString(), D(1));
  });
});

Deno.test('hide: returns the old path, blanks the row and keeps it; missing gives found false', async () => {
  await withDb(async (db) => {
    await up(db, 'a', D(1));
    assertEquals(await call(db, `public.hide_fit_photo('a')`), { found: true, path: 'fit/a.jpg' });
    const [r] = await rows(db, `select image, path, hidden, username from public.fit_photos where media_id = 'a'`);
    assertEquals([r.image, r.path, r.hidden, r.username], ['', '', true, 'u_a']);
    assertEquals(await call(db, `public.hide_fit_photo('a')`), { found: true, path: '' });
    assertEquals(await call(db, `public.hide_fit_photo('nope')`), { found: false, path: '' });
  });
});

Deno.test('delete: true when a row went, false when none', async () => {
  await withDb(async (db) => {
    await up(db, 'a', D(1));
    assertEquals(await call(db, `public.delete_fit_photo('a')`), true);
    assertEquals(await call(db, `public.delete_fit_photo('a')`), false);
    assertEquals(await admin(db), []);
  });
});

Deno.test('claim: true then false within the age, and age 0 always claims', async () => {
  await withDb(async (db) => {
    assertEquals(await call(db, 'public.claim_fit_sync(900)'), true);
    assertEquals(await call(db, 'public.claim_fit_sync(900)'), false);
    assertEquals(await call(db, 'public.claim_fit_sync(0)'), true);
    assertEquals(await call(db, 'public.claim_fit_sync(0)'), true);
    assertEquals((await rows(db, 'select count(*)::int as n from public.fit_sync'))[0].n, 1);
    await db.exec(`update public.fit_sync set started_at = now() - interval '1000 seconds'`);
    assertEquals(await call(db, 'public.claim_fit_sync(900)'), true);
  });
});

Deno.test('finish: success sets last_ok_at, failure keeps it and records the error', async () => {
  await withDb(async (db) => {
    await call(db, 'public.claim_fit_sync(900)');
    await call(db, `public.finish_fit_sync('boom')`);
    let [s] = await rows(db, 'select last_ok_at, last_error from public.fit_sync');
    assertEquals([s.last_ok_at, s.last_error], [null, 'boom']);
    await call(db, 'public.finish_fit_sync(null)');
    [s] = await rows(db, 'select last_ok_at, last_error from public.fit_sync');
    assert(s.last_ok_at);
    assertEquals(s.last_error, '');
    const ok = new Date(s.last_ok_at).getTime();
    await call(db, `public.finish_fit_sync('again')`);
    [s] = await rows(db, 'select last_ok_at, last_error from public.fit_sync');
    assertEquals([new Date(s.last_ok_at).getTime(), s.last_error], [ok, 'again']);
    await call(db, `public.finish_fit_sync('')`);
    [s] = await rows(db, 'select last_ok_at, last_error from public.fit_sync');
    assert(new Date(s.last_ok_at).getTime() >= ok);
    assertEquals(s.last_error, '');
  });
});

Deno.test('status: empty before any run, filled after', async () => {
  await withDb(async (db) => {
    assertEquals(await call(db, 'public.fit_sync_status()'), { lastOkAt: null, lastError: '' });
    await call(db, `public.finish_fit_sync('bad token')`);
    assertEquals(await call(db, 'public.fit_sync_status()'), { lastOkAt: null, lastError: 'bad token' });
    await call(db, 'public.finish_fit_sync(null)');
    const s = await call(db, 'public.fit_sync_status()');
    assertEquals(s.lastError, '');
    assert(!Number.isNaN(new Date(s.lastOkAt).getTime()));
  });
});

Deno.test('grants: anon and authenticated cannot execute any function or touch the tables; service_role can execute', async () => {
  await withDb(async (db) => {
    for (const role of ['anon', 'authenticated']) {
      for (const sig of FN_SIGS) {
        assertEquals((await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]))[0].ok, false, `${role} ${sig}`);
      }
      for (const t of ['fit_photos', 'fit_sync']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          assertEquals((await rows(db, `select has_table_privilege($1, $2, $3) as ok`, [role, `public.${t}`, priv]))[0].ok, false, `${role} ${t} ${priv}`);
        }
      }
      await db.exec(`set role ${role}`);
      try {
        await assertRejects(() => db.query('select public.list_fit_photos_public()'), Error, 'permission denied');
        await assertRejects(() => db.query('select * from public.fit_photos'), Error, 'permission denied');
        await assertRejects(() => db.query('select * from public.fit_sync'), Error, 'permission denied');
      } finally {
        await db.exec('reset role');
      }
    }
    for (const sig of FN_SIGS) {
      assertEquals((await rows(db, `select has_function_privilege('service_role', $1, 'execute') as ok`, [sig]))[0].ok, true, sig);
    }
    await db.exec('set role service_role');
    try {
      assertEquals(await pub(db), []);
    } finally {
      await db.exec('reset role');
    }
    const created = [...(await readMigration(MIGRATION)).matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort();
    assertEquals(created, FN_SIGS.map((s) => s.slice(7, s.indexOf('('))).sort());
  });
});

Deno.test('rls: on for both tables, and the migration names no pg_cron or pg_net', async () => {
  const db = await after();
  const r = await rows(db, `select relname, relrowsecurity from pg_class where relname in ('fit_photos','fit_sync') order by relname`);
  assertEquals(r.map((x) => [x.relname, x.relrowsecurity]), [['fit_photos', true], ['fit_sync', true]]);
  const sql = await readMigration(MIGRATION);
  assert(!/pg_cron|pg_net|cron\.schedule/.test(sql.replace(/--.*$/gm, '')));
});

Deno.test('migration: changes no existing function, adds only its own, and is safe to re-run', async () => {
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
  assertEquals(now.length, base.length + FN_SIGS.length);
  const copy = await db.clone();
  try {
    await up(copy, 'keep', D(1));
    await call(copy, 'public.claim_fit_sync(900)');
    await copy.exec(await readMigration(MIGRATION));
    assertEquals(await functionDefs(copy), now);
    assertEquals((await pub(copy)).map((p) => p.id), ['keep']);
    assertEquals(await call(copy, 'public.claim_fit_sync(900)'), false);
  } finally {
    await copy.close();
  }
});

Deno.test('image limit: product-images takes 5 MB after the migration, and public is unchanged', async () => {
  const db = await after();
  const r = await rows(db, `select id, public, file_size_limit from storage.buckets where id = 'product-images'`);
  assertEquals(r.map((x) => [x.id, x.public, Number(x.file_size_limit)]), [['product-images', true, 5242880]]);
});

Deno.test('image limit: safe to re-run, and the file only changes that one bucket limit', async () => {
  const db = await after();
  const copy = await db.clone();
  try {
    await copy.exec(await readMigration(IMAGE_LIMIT_MIGRATION));
    const r = await rows(copy, `select count(*)::int as n, max(file_size_limit) as lim from storage.buckets where id = 'product-images'`);
    assertEquals([r[0].n, Number(r[0].lim)], [1, 5242880]);
  } finally {
    await copy.close();
  }
  const sql = (await readMigration(IMAGE_LIMIT_MIGRATION)).replace(/--.*$/gm, '');
  assert(/update storage\.buckets set file_size_limit = 5242880 where id = 'product-images';/.test(sql));
  assert(!/insert|create|drop|delete|alter|grant|revoke/i.test(sql));
  assert((await readMigration(IMAGE_LIMIT_MIGRATION)).startsWith('-- '));
});
