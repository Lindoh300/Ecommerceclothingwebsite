// Tests for supabase/migrations/20261031130000_community.sql (gallery and mailing list) and
// 20261031140000_unsubscribe.sql (self-service unsubscribe), run against an in-process
// Postgres (PGlite) with every migration before it applied. Run with `deno task test:sql` from
// supabase/functions/server.
//
// PGlite is ONE connection, so these tests cannot show real races between concurrent transactions. They check the
// logic: uniqueness, the contact rule, the sign-up and its repeat, the address limit, ordering, RLS and grants.
import { assert, assertEquals, assertRejects } from '@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.13';
import { pgcrypto } from 'npm:@electric-sql/pglite@0.5.13/contrib/pgcrypto';
import { normalisePhone } from '../functions/server/validation.ts';

// deno-lint-ignore no-explicit-any
type Json = any;
type Db = Awaited<ReturnType<PGlite['clone']>>;

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const readMigration = (name: string) => Deno.readTextFile(new URL(name, MIGRATIONS));
const COMMUNITY_MIGRATION = '20261031130000_community.sql';
const UNSUBSCRIBE_MIGRATION = '20261031140000_unsubscribe.sql';
// Every migration before the community one, in order. The pg_cron migration is never loaded: PGlite has no pg_cron.
const BEFORE_COMMUNITY = [
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
let functionsBeforeUnsub: Promise<Json[]> | undefined;

function before(): Promise<Db> {
  beforeDb ??= (async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(SUPABASE_ROLES_SQL);
    for (const f of BEFORE_COMMUNITY) await db.exec(await readMigration(f));
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

/** `before` plus the community migration and the unsubscribe one, applied once. */
function after(): Promise<Db> {
  afterDb ??= (async () => {
    const base = await before();
    functionsBefore = functionDefs(base);
    const db = await base.clone();
    await db.exec(await readMigration(COMMUNITY_MIGRATION));
    functionsBeforeUnsub = functionDefs(db);
    await db.exec(await readMigration(UNSUBSCRIBE_MIGRATION));
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
const newId = () => crypto.randomUUID();
const TEXT = '[2026-10-31] Yes, I\'d like 4Nguru to send me news about new drops and events. I can opt out at any time.';

/** public.subscribe(name, phone, email, text, source, ip) */
const subscribe = (
  db: Db,
  o: { name?: string | null; phone?: string | null; email?: string | null; text?: string; source?: string; ip?: string | null },
) =>
  call(
    db,
    'public.subscribe($1, $2, $3, $4, $5, $6)',
    o.name ?? null,
    o.phone ?? null,
    o.email ?? null,
    o.text ?? TEXT,
    o.source ?? 'community',
    o.ip ?? null,
  );

/** public.unsubscribe_contact(phone, email, ip) */
const unsubscribe = (db: Db, o: { phone?: string | null; email?: string | null; ip?: string | null }) =>
  call(db, 'public.unsubscribe_contact($1, $2, $3)', o.phone ?? null, o.email ?? null, o.ip ?? null);

const subs = (db: Db) => rows(db, 'select * from public.subscribers order by created_at, id');
const count = async (db: Db, table: string) => (await rows(db, `select count(*)::int as n from public.${table}`))[0].n as number;

async function mkEvent(db: Db): Promise<Json> {
  const r = await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', newId(), j({
    title: 'Test Night',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'published',
  }));
  assert(r.ok, j(r));
  return r.event;
}

const putItem = (db: Db, id: string, input: Record<string, unknown>) =>
  call(db, 'public.upsert_gallery_item($1::uuid, $2::jsonb)', id, j(input));

// ---------------------------------------------------------------------------
// Subscribers: the table rules.
// ---------------------------------------------------------------------------
Deno.test('normalise_phone: digits only, 00 dropped, a leading 0 becomes 27, and the client mirror agrees', async () => {
  await withDb(async (db) => {
    const cases: [string, string | null][] = [
      ['082 123 4567', '27821234567'],
      ['+27 82 123 4567', '27821234567'],
      ['0027821234567', '27821234567'],
      ['(082) 123-4567', '27821234567'],
      ['27821234567', '27821234567'],
      ['+1 (415) 555-0132', '14155550132'],
      ['', null],
      ['abc', null],
    ];
    for (const [input, want] of cases) {
      assertEquals(await call(db, 'public.normalise_phone($1)', input), want, input);
      assertEquals(normalisePhone(input), want, `client ${input}`);
    }
    assertEquals(await call(db, 'public.normalise_phone($1)', null), null);
  });
});

Deno.test('subscribers: at least one of phone or email is required, and each must be plausible', async () => {
  await withDb(async (db) => {
    const insert = (phone: string | null, email: string | null, extra = '') =>
      db.query(
        `insert into public.subscribers (phone, email, consent_text, consent_at, source) values ($1, $2, 'x', now(), 'footer')${extra}`,
        [phone, email],
      );
    await assertRejects(() => insert(null, null), Error, 'check');
    await assertRejects(() => insert('12', null), Error, 'check');
    await assertRejects(() => insert('1234567890123456', null), Error, 'check');
    await assertRejects(() => insert(null, 'not-an-email'), Error, 'check');
    await assertRejects(() => insert(null, 'a b@example.com'), Error, 'check');
    await insert('0821234567', null);
    await insert(null, 'a@example.com');
    await insert('0831234567', 'b@example.com');
    assertEquals(await count(db, 'subscribers'), 3);
    // consent text and a known source are required too.
    await assertRejects(
      () => db.query(`insert into public.subscribers (email, consent_text, consent_at, source) values ('c@example.com', ' ', now(), 'footer')`),
      Error,
      'check',
    );
    await assertRejects(
      () => db.query(`insert into public.subscribers (email, consent_text, consent_at, source) values ('c@example.com', 'x', now(), 'ads')`),
      Error,
      'check',
    );
    await assertRejects(
      () => db.query(`insert into public.subscribers (email, consent_text, source) values ('c@example.com', 'x', 'footer')`),
      Error,
      'null value',
    );
  });
});

Deno.test('subscribers: unique on the normalised phone and on the lower-cased email', async () => {
  await withDb(async (db) => {
    const insert = (phone: string | null, email: string | null) =>
      db.query(`insert into public.subscribers (phone, email, consent_text, consent_at, source) values ($1, $2, 'x', now(), 'footer')`, [phone, email]);
    await insert('0821234567', 'a@example.com');
    for (const dup of ['082 123 4567', '+27821234567', '0027 82 123 4567', '(082)123-4567']) {
      await assertRejects(() => insert(dup, null), Error, 'duplicate key', dup);
    }
    for (const dup of ['A@example.com', 'a@EXAMPLE.COM']) {
      await assertRejects(() => insert(null, dup), Error, 'duplicate key', dup);
    }
    // Rows with no phone, or no email, never clash with each other.
    await insert(null, 'b@example.com');
    await insert(null, 'c@example.com');
    await insert('0831234567', null);
    await insert('0841234567', null);
    assertEquals(await count(db, 'subscribers'), 5);
  });
});

// ---------------------------------------------------------------------------
// subscribe().
// ---------------------------------------------------------------------------
Deno.test('subscribe: a new person is stored with the consent text, the time and the source', async () => {
  await withDb(async (db) => {
    assertEquals(await subscribe(db, { name: '  Thandi ', phone: ' 082 123 4567 ', email: ' T@Example.com ', source: 'event' }), { ok: true });
    const [s] = await subs(db);
    assertEquals([s.name, s.phone, s.email, s.source, s.consent_text], ['Thandi', '082 123 4567', 'T@Example.com', 'event', TEXT]);
    assertEquals(s.unsubscribed_at, null);
    assert(Math.abs(new Date(s.consent_at).getTime() - Date.now()) < 60_000);
    // Phone only, and email only.
    assertEquals(await subscribe(db, { phone: '0831234567' }), { ok: true });
    assertEquals(await subscribe(db, { email: 'solo@example.com' }), { ok: true });
    assertEquals(await count(db, 'subscribers'), 3);
    assertEquals((await subs(db))[1].name, null);
  });
});

Deno.test('subscribe: a repeat gives the same answer, keeps one row, renews the consent and clears an opt-out', async () => {
  await withDb(async (db) => {
    const first = await subscribe(db, { name: 'Thandi', phone: '0821234567', text: 'old wording' });
    const [before] = await subs(db);
    await db.exec(`update public.subscribers set consent_at = now() - interval '30 days', unsubscribed_at = now() - interval '1 day'`);
    const again = await subscribe(db, { phone: '+27 82 123 4567', email: 'new@example.com' });
    assertEquals(again, first);
    assertEquals(await count(db, 'subscribers'), 1);
    const [after] = await subs(db);
    assertEquals(after.id, before.id);
    assertEquals(after.unsubscribed_at, null);
    assert(Date.now() - new Date(after.consent_at).getTime() < 60_000, 'consent time renewed');
    assertEquals(after.consent_text, TEXT);
    assertEquals(after.name, 'Thandi');
    assertEquals(after.email, 'new@example.com');
    assertEquals(after.source, 'community');
    assertEquals(after.created_at, before.created_at);
    // The same by email, in another case.
    await subscribe(db, { email: 'EMAIL@example.com' });
    await db.exec(`update public.subscribers set unsubscribed_at = now() where email = 'EMAIL@example.com'`);
    assertEquals(await subscribe(db, { email: 'email@EXAMPLE.com', name: 'Renamed' }), first);
    const row = (await rows(db, `select * from public.subscribers where lower(email) = 'email@example.com'`))[0];
    assertEquals([row.unsubscribed_at, row.name], [null, 'Renamed']);
  });
});

Deno.test('subscribe: a phone and an email that belong to two different people sign up the first match and copy nothing over', async () => {
  await withDb(async (db) => {
    await subscribe(db, { phone: '0821234567' });
    await subscribe(db, { email: 'other@example.com' });
    assertEquals(await subscribe(db, { phone: '082 123 4567', email: 'other@example.com' }), { ok: true });
    const all = await subs(db);
    assertEquals(all.length, 2);
    const byPhone = all.find((s: Json) => s.phone)!;
    assertEquals(byPhone.email, null);
  });
});

Deno.test('subscribe: an unknown source is refused and keeps nothing', async () => {
  await withDb(async (db) => {
    await assertRejects(() => subscribe(db, { phone: '0821234567', source: 'ads' }), Error, 'check');
    assertEquals(await count(db, 'subscribers'), 0);
  });
});

// ---------------------------------------------------------------------------
// The address limit.
// ---------------------------------------------------------------------------
const IP = '203.0.113.9';

Deno.test('sign-up limit: 5 per address pass, the 6th is rate_limited and keeps nothing; no address, no limit', async () => {
  await withDb(async (db) => {
    for (let i = 0; i < 5; i++) assertEquals(await subscribe(db, { phone: `082000100${i}`, ip: IP }), { ok: true });
    assertEquals(await subscribe(db, { phone: '0820001009', ip: IP }), { ok: false, reason: 'rate_limited' });
    assertEquals(await count(db, 'subscribers'), 5);
    assertEquals(await count(db, 'subscribe_ip_log'), 5);
    // A repeat sign-up counts too, so the limit cannot be dodged by re-sending.
    assertEquals(await subscribe(db, { phone: '0820001000', ip: IP }), { ok: false, reason: 'rate_limited' });
    // Another address is not affected.
    assertEquals(await subscribe(db, { phone: '0820001010', ip: '198.51.100.7' }), { ok: true });
    // No address, no limit and no log row.
    for (let i = 0; i < 7; i++) assertEquals(await subscribe(db, { phone: `082000200${i}` }), { ok: true });
    assertEquals(await subscribe(db, { phone: '0820003000', ip: '' }), { ok: true });
    assertEquals(await count(db, 'subscribe_ip_log'), 6);
  });
});

Deno.test('sign-up limit: the hour rolls, and old rows are deleted', async () => {
  await withDb(async (db) => {
    for (let i = 0; i < 5; i++) await subscribe(db, { phone: `082000100${i}`, ip: IP });
    assertEquals((await subscribe(db, { phone: '0820001009', ip: IP })).reason, 'rate_limited');
    await db.exec(`update public.subscribe_ip_log set created_at = now() - interval '61 minutes'`);
    assertEquals(await subscribe(db, { phone: '0820001009', ip: IP }), { ok: true });
    assertEquals(await count(db, 'subscribe_ip_log'), 1);
  });
});

Deno.test('sign-up limit: the log holds only a hash made with the existing order salt; the address is stored nowhere', async () => {
  await withDb(async (db) => {
    const salt = (await rows(db, 'select salt from public.order_rate_salt'))[0].salt as string;
    await subscribe(db, { phone: '0821234567', ip: IP });
    await subscribe(db, { email: 'a@example.com', ip: IP });
    const log = await rows(db, 'select * from public.subscribe_ip_log');
    assertEquals(log.length, 2);
    assertEquals(Object.keys(log[0]).sort(), ['created_at', 'ip_hash']);
    const expected = (await rows(db, `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`, [salt + IP]))[0].h;
    assertEquals([log[0].ip_hash, log[1].ip_hash], [expected, expected]);
    assertEquals((await rows(db, 'select count(*)::int as n from public.order_rate_salt'))[0].n, 1);
    assertEquals((await rows(db, 'select salt from public.order_rate_salt'))[0].salt, salt);
    const dump = j({ log, subscribers: await rows(db, 'select to_jsonb(s) as r from public.subscribers s') });
    assert(!dump.includes(IP));
  });
});

// ---------------------------------------------------------------------------
// Owner functions.
// ---------------------------------------------------------------------------
Deno.test('list_subscribers_admin and admin_unsubscribe_subscriber: newest first, opt out once, unknown is null', async () => {
  await withDb(async (db) => {
    await subscribe(db, { name: 'First', phone: '0821234567' });
    await db.exec(`update public.subscribers set created_at = now() - interval '1 day'`);
    await subscribe(db, { name: 'Second', email: 'b@example.com', source: 'footer' });
    const list = await call(db, 'public.list_subscribers_admin()');
    assertEquals(list.map((s: Json) => s.name), ['Second', 'First']);
    assertEquals(Object.keys(list[0]).sort(), ['consentAt', 'createdAt', 'email', 'id', 'name', 'phone', 'source', 'unsubscribedAt']);
    assert(!j(list).includes('Yes, I'));
    const id = list[0].id;
    const one = await call(db, 'public.admin_unsubscribe_subscriber($1::uuid)', id);
    assert(one.unsubscribedAt);
    await db.exec(`update public.subscribers set unsubscribed_at = now() - interval '2 days' where id = '${id}'`);
    const two = await call(db, 'public.admin_unsubscribe_subscriber($1::uuid)', id);
    assertEquals(two.unsubscribedAt, (await call(db, 'public.list_subscribers_admin()'))[0].unsubscribedAt);
    assertEquals(await call(db, 'public.admin_unsubscribe_subscriber($1::uuid)', newId()), null);
    assertEquals(await call(db, 'public.list_subscribers_admin()').then((l: Json) => l.length), 2);
  });
});

// ---------------------------------------------------------------------------
// Self-service unsubscribe (20261031140000_unsubscribe.sql).
// ---------------------------------------------------------------------------
Deno.test('unsubscribe_contact: opts out by phone, keeps the row and the consent record, and a second call keeps the first time', async () => {
  await withDb(async (db) => {
    await subscribe(db, { name: 'Thandi', phone: '082 123 4567', email: 't@example.com', source: 'event' });
    await subscribe(db, { phone: '0839999999' });
    const [before] = await subs(db);
    assertEquals(await unsubscribe(db, { phone: '082 123 4567' }), { ok: true });
    const [one, other] = await subs(db);
    assert(one.unsubscribed_at);
    assertEquals(other.unsubscribed_at, null);
    // Nothing else about the row changed: it is still the record of the consent.
    for (const k of ['id', 'name', 'phone', 'email', 'consent_text', 'consent_at', 'source', 'created_at']) {
      assertEquals(one[k], before[k], k);
    }
    assertEquals(await count(db, 'subscribers'), 2);
    // A second call, even from another contact of the same row, keeps the first time.
    await db.exec(`update public.subscribers set unsubscribed_at = now() - interval '3 days' where id = '${one.id}'`);
    const stamped = (await subs(db))[0].unsubscribed_at;
    assertEquals(await unsubscribe(db, { phone: '+27821234567' }), { ok: true });
    assertEquals(await unsubscribe(db, { email: 'T@EXAMPLE.COM' }), { ok: true });
    assertEquals((await subs(db))[0].unsubscribed_at, stamped);
    assertEquals(await count(db, 'subscribers'), 2);
  });
});

Deno.test('unsubscribe_contact: phone spellings and email case all match', async () => {
  await withDb(async (db) => {
    await subscribe(db, { phone: '(082) 123-4567' });
    await subscribe(db, { email: 'Mixed.Case@Example.com' });
    for (const phone of ['0821234567', '+27 82 123 4567', '0027821234567', '27821234567', ' 082.123.4567 ']) {
      await db.exec(`update public.subscribers set unsubscribed_at = null`);
      assertEquals(await unsubscribe(db, { phone }), { ok: true });
      assert((await subs(db))[0].unsubscribed_at, phone);
      assertEquals((await subs(db))[1].unsubscribed_at, null, phone);
    }
    for (const email of ['mixed.case@example.com', 'MIXED.CASE@EXAMPLE.COM', '  Mixed.Case@Example.com  ']) {
      await db.exec(`update public.subscribers set unsubscribed_at = null`);
      assertEquals(await unsubscribe(db, { email }), { ok: true });
      assert((await subs(db))[1].unsubscribed_at, email);
      assertEquals((await subs(db))[0].unsubscribed_at, null, email);
    }
  });
});

Deno.test('unsubscribe_contact: a phone and an email for two different rows opt out both; either alone is enough', async () => {
  await withDb(async (db) => {
    await subscribe(db, { phone: '0821234567' });
    await subscribe(db, { email: 'other@example.com' });
    await subscribe(db, { phone: '0830000000', email: 'third@example.com' });
    assertEquals(await unsubscribe(db, { phone: '082 123 4567', email: 'OTHER@example.com' }), { ok: true });
    assertEquals((await subs(db)).map((s: Json) => s.unsubscribed_at !== null), [true, true, false]);
    assertEquals(await unsubscribe(db, { email: 'third@example.com' }), { ok: true });
    assertEquals((await subs(db)).map((s: Json) => s.unsubscribed_at !== null), [true, true, true]);
  });
});

Deno.test('unsubscribe_contact: an unknown contact, or none at all, gives the same {ok:true} and changes nothing', async () => {
  await withDb(async (db) => {
    await subscribe(db, { phone: '0821234567', email: 'a@example.com' });
    const known = await unsubscribe(db, { phone: '0821234567' });
    await db.exec(`update public.subscribers set unsubscribed_at = null`);
    for (const o of [
      { phone: '0839999999' },
      { email: 'nobody@example.com' },
      { phone: '0839999999', email: 'nobody@example.com' },
      { phone: '  ', email: '' },
      { phone: '---' },
      {},
    ]) {
      assertEquals(await unsubscribe(db, o), known, j(o));
    }
    assertEquals(known, { ok: true });
    const [s] = await subs(db);
    assertEquals(s.unsubscribed_at, null);
    assertEquals(await count(db, 'subscribers'), 1);
  });
});

Deno.test('unsubscribe_contact: 5 per address are shared with sign-ups; the 6th is rate_limited and writes nothing', async () => {
  await withDb(async (db) => {
    await subscribe(db, { phone: '0821234567' });
    // Two sign-ups and three unsubscribes use the five.
    assertEquals(await subscribe(db, { phone: '0820001001', ip: IP }), { ok: true });
    assertEquals(await subscribe(db, { phone: '0820001002', ip: IP }), { ok: true });
    for (let i = 0; i < 3; i++) assertEquals(await unsubscribe(db, { email: `n${i}@example.com`, ip: IP }), { ok: true });
    assertEquals(await count(db, 'subscribe_ip_log'), 5);
    const logBefore = await rows(db, 'select * from public.subscribe_ip_log order by created_at, ip_hash');
    const subsBefore = await subs(db);
    // Over the limit: nothing changes, not the list and not the log.
    assertEquals(await unsubscribe(db, { phone: '082 123 4567', ip: IP }), { ok: false, reason: 'rate_limited' });
    assertEquals(await subs(db), subsBefore);
    assertEquals((await subs(db))[0].unsubscribed_at, null);
    assertEquals(await rows(db, 'select * from public.subscribe_ip_log order by created_at, ip_hash'), logBefore);
    // And a sign-up is refused for the same reason.
    assertEquals((await subscribe(db, { phone: '0820001003', ip: IP })).reason, 'rate_limited');
    assertEquals(await count(db, 'subscribers'), 3);
    // Another address, and no address, are not limited and leave no log row.
    assertEquals(await unsubscribe(db, { phone: '082 123 4567', ip: '198.51.100.7' }), { ok: true });
    assert((await subs(db))[0].unsubscribed_at);
    assertEquals(await count(db, 'subscribe_ip_log'), 6);
    for (let i = 0; i < 7; i++) assertEquals(await unsubscribe(db, { email: `m${i}@example.com` }), { ok: true });
    assertEquals(await unsubscribe(db, { email: 'm@example.com', ip: '' }), { ok: true });
    assertEquals(await count(db, 'subscribe_ip_log'), 6);
  });
});

Deno.test('unsubscribe_contact: the hour rolls, old rows are deleted, and the log holds only the salted hash', async () => {
  await withDb(async (db) => {
    await subscribe(db, { phone: '0821234567' });
    for (let i = 0; i < 5; i++) await unsubscribe(db, { email: `n${i}@example.com`, ip: IP });
    assertEquals((await unsubscribe(db, { phone: '0821234567', ip: IP })).reason, 'rate_limited');
    const salt = (await rows(db, 'select salt from public.order_rate_salt'))[0].salt as string;
    const expected = (await rows(db, `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`, [salt + IP]))[0].h;
    const log = await rows(db, 'select * from public.subscribe_ip_log');
    assertEquals(log.map((l: Json) => l.ip_hash), Array(5).fill(expected));
    assert(!j(log).includes(IP));
    await db.exec(`update public.subscribe_ip_log set created_at = now() - interval '61 minutes'`);
    assertEquals(await unsubscribe(db, { phone: '0821234567', ip: IP }), { ok: true });
    assert((await subs(db))[0].unsubscribed_at);
    assertEquals(await count(db, 'subscribe_ip_log'), 1);
  });
});

Deno.test('unsubscribe_contact: a later sign-up clears the opt-out and renews the consent', async () => {
  await withDb(async (db) => {
    await subscribe(db, { name: 'Thandi', phone: '0821234567', text: 'old wording' });
    await db.exec(`update public.subscribers set consent_at = now() - interval '30 days'`);
    await unsubscribe(db, { phone: '0821234567' });
    assert((await subs(db))[0].unsubscribed_at);
    assertEquals(await subscribe(db, { phone: '+27 82 123 4567' }), { ok: true });
    const [s] = await subs(db);
    assertEquals(s.unsubscribed_at, null);
    assertEquals(s.consent_text, TEXT);
    assert(Date.now() - new Date(s.consent_at).getTime() < 60_000);
    assertEquals(await count(db, 'subscribers'), 1);
  });
});

// ---------------------------------------------------------------------------
// Gallery.
// ---------------------------------------------------------------------------
Deno.test('gallery: public lists active items by sort then newest with four fields; admin lists all', async () => {
  await withDb(async (db) => {
    const a = newId(), b = newId(), c = newId(), h = newId();
    for (const [id, o] of [
      [a, { image: 'https://x/a.jpg', caption: 'A', sort: 2 }],
      [b, { image: 'https://x/b.jpg', caption: 'B', sort: 1 }],
      [c, { image: 'https://x/c.jpg', caption: 'C', sort: 2 }],
      [h, { image: 'https://x/h.jpg', sort: 0, active: false }],
    ] as [string, Record<string, unknown>][]) {
      const r = await putItem(db, id, o);
      assertEquals([r.ok, r.created], [true, true]);
      // created_at is the transaction time; space the rows out so "newest" is decided.
      await db.query(`update public.gallery_items set created_at = now() - ($2 || ' minutes')::interval where id = $1::uuid`, [
        id,
        String({ [a]: 3, [b]: 4, [c]: 2, [h]: 1 }[id]),
      ]);
    }
    const pub = await call(db, 'public.list_gallery_public()');
    assertEquals(pub.map((g: Json) => g.id), [b, c, a]);
    assertEquals(Object.keys(pub[0]).sort(), ['caption', 'eventId', 'id', 'image']);
    const admin = await call(db, 'public.list_gallery_admin()');
    assertEquals(admin.map((g: Json) => g.id), [h, b, c, a]);
    assertEquals(Object.keys(admin[0]).sort(), ['active', 'caption', 'createdAt', 'eventId', 'id', 'image', 'sort']);
    assertEquals(admin[0].caption, '');
    assertEquals(await call(db, 'public.list_gallery_public()').then((l: Json) => l.length), 3);
  });
});

Deno.test('gallery: the first image needs a value, edits keep what they do not mention, hide and delete work', async () => {
  await withDb(async (db) => {
    const id = newId();
    assertEquals(await putItem(db, id, { caption: 'No image' }), { ok: false, reason: 'missing_fields' });
    assertEquals(await putItem(db, id, { image: '  ' }), { ok: false, reason: 'missing_fields' });
    assertEquals(await count(db, 'gallery_items'), 0);
    const made = await putItem(db, id, { image: 'https://x/a.jpg', caption: 'Hi', sort: 3 });
    assertEquals([made.item.sort, made.item.active, made.item.eventId], [3, true, null]);
    const edit = await putItem(db, id, { caption: 'New', sort: 7 });
    assertEquals([edit.created, edit.item.image, edit.item.caption, edit.item.sort], [false, 'https://x/a.jpg', 'New', 7]);
    assertEquals((await putItem(db, id, { active: false })).item.active, false);
    assertEquals(await call(db, 'public.list_gallery_public()'), []);
    assertEquals(await call(db, 'public.delete_gallery_item($1::uuid)', id), true);
    assertEquals(await call(db, 'public.delete_gallery_item($1::uuid)', id), false);
  });
});

Deno.test('gallery: an event link must exist, null clears it, and deleting the event leaves the photo with no link', async () => {
  await withDb(async (db) => {
    const ev = await mkEvent(db);
    const id = newId();
    assertEquals(await putItem(db, id, { image: 'https://x/a.jpg', eventId: newId() }), { ok: false, reason: 'event_not_found' });
    assertEquals(await count(db, 'gallery_items'), 0);
    assertEquals((await putItem(db, id, { image: 'https://x/a.jpg', eventId: ev.id })).item.eventId, ev.id);
    // An edit that does not mention eventId keeps it.
    assertEquals((await putItem(db, id, { caption: 'x' })).item.eventId, ev.id);
    assertEquals(await putItem(db, id, { eventId: newId() }), { ok: false, reason: 'event_not_found' });
    assertEquals((await putItem(db, id, { eventId: null })).item.eventId, null);
    await putItem(db, id, { eventId: ev.id });
    assertEquals(await call(db, 'public.delete_event($1::uuid)', ev.id), { ok: true });
    const [item] = await call(db, 'public.list_gallery_public()');
    assertEquals([item.id, item.eventId], [id, null]);
  });
});

// ---------------------------------------------------------------------------
// RLS and grants.
// ---------------------------------------------------------------------------
const TABLES = ['subscribers', 'gallery_items', 'subscribe_ip_log'];
const FUNCTIONS = [
  'public.normalise_phone(text)',
  'public.gallery_item_json(public.gallery_items,boolean)',
  'public.subscriber_json(public.subscribers)',
  'public.list_gallery_public()',
  'public.list_gallery_admin()',
  'public.upsert_gallery_item(uuid,jsonb)',
  'public.delete_gallery_item(uuid)',
  'public.subscribe(text,text,text,text,text,text)',
  'public.list_subscribers_admin()',
  'public.admin_unsubscribe_subscriber(uuid)',
  // From 20261031140000_unsubscribe.sql.
  'public.unsubscribe_contact(text,text,text)',
];

Deno.test('RLS and grants: tables have RLS and no policies; anon and authenticated can touch nothing', async () => {
  await withDb(async (db) => {
    await subscribe(db, { phone: '0821234567', ip: IP });
    await putItem(db, newId(), { image: 'https://x/a.jpg' });
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
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        for (const t of TABLES) await assertRejects(() => db.query(`select * from public.${t}`), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.list_gallery_public()`), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.list_subscribers_admin()`), Error, 'permission denied');
        await assertRejects(
          () => db.query(`select public.subscribe(null, '0821234567', null, 'x', 'footer', null)`),
          Error,
          'permission denied',
        );
        await assertRejects(
          () => db.query(`select public.unsubscribe_contact('0821234567', null, null)`),
          Error,
          'permission denied',
        );
      } finally {
        await db.exec('reset role');
      }
    }
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
    const created: string[] = [];
    for (const f of [COMMUNITY_MIGRATION, UNSUBSCRIBE_MIGRATION]) {
      for (const m of (await readMigration(f)).matchAll(/create or replace function public\.(\w+)\(/g)) created.push(m[1]);
    }
    const covered = new Set(FUNCTIONS.map((s) => s.slice('public.'.length, s.indexOf('('))));
    for (const name of created) assert(covered.has(name), `${name} has no grant check`);
    assertEquals(created.length, covered.size);
  });
});

// ---------------------------------------------------------------------------
// The migration itself.
// ---------------------------------------------------------------------------
Deno.test('migration: no existing function changed, no existing table touched', async () => {
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
});

Deno.test('migration: the unsubscribe migration adds one function and changes no existing function or grant', async () => {
  const db = await after();
  const base = await functionsBeforeUnsub!;
  const now = await functionDefs(db);
  const byName = new Map(now.map((f) => [f.sig as string, f]));
  for (const f of base) {
    const same = byName.get(f.sig);
    assert(same, `${f.sig} is gone`);
    assertEquals(same.def, f.def, `${f.sig} changed`);
    assertEquals(same.acl, f.acl, `${f.sig} grants changed`);
  }
  assertEquals(now.length - base.length, 1);
  assertEquals(now.filter((f) => !base.some((b) => b.sig === f.sig)).map((f) => f.sig), ['unsubscribe_contact(text,text,text)']);
});

Deno.test('migration: a second run changes nothing and keeps the data and the grants', async () => {
  await withDb(async (db) => {
    const sql = await readMigration(COMMUNITY_MIGRATION) + await readMigration(UNSUBSCRIBE_MIGRATION);
    const dump = async () => ({
      tables: await rows(db, `select t.table_name, c.column_name, c.data_type from information_schema.tables t
        join information_schema.columns c using (table_schema, table_name)
        where t.table_schema = 'public' and t.table_name in ('subscribers','gallery_items','subscribe_ip_log')
        order by 1, c.ordinal_position`),
      indexes: await rows(db, `select indexname, indexdef from pg_indexes where tablename in ('subscribers','gallery_items','subscribe_ip_log') order by 1`),
      functions: await functionDefs(db),
      data: {
        subscribers: await rows(db, 'select to_jsonb(s) as r from public.subscribers s order by s.id'),
        gallery: await rows(db, 'select to_jsonb(g) as r from public.gallery_items g order by g.id'),
      },
    });
    await subscribe(db, { phone: '0821234567', ip: IP });
    await unsubscribe(db, { phone: '0821234567' });
    await putItem(db, newId(), { image: 'https://x/a.jpg' });
    const first = await dump();
    await db.exec(sql);
    assertEquals(await dump(), first);
  });
});

Deno.test('teardown', async () => {
  if (afterDb) await (await afterDb).close();
  if (beforeDb) await (await beforeDb).close();
});
