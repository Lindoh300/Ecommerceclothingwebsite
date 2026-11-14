// Tests for supabase/migrations/20261031120000_events.sql (events, ticket types,
// tickets), run against an in-process Postgres (PGlite) with every migration
// before it applied. Run with `deno task test:sql` from supabase/functions/server.
//
// PGlite is ONE connection, so these tests cannot show real row-lock races
// between concurrent transactions. They check the logic and the arithmetic: the
// capacity maths, idempotency, check-in once, void once, the address limit, RLS
// and grants. The lock rule is written at the top of the migration and has to be
// reviewed by reading it; one test below checks the lock statements are there.
import { assert, assertEquals, assertRejects } from '@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.13';
import { pgcrypto } from 'npm:@electric-sql/pglite@0.5.13/contrib/pgcrypto';

// deno-lint-ignore no-explicit-any
type Json = any;
type Db = Awaited<ReturnType<PGlite['clone']>>;

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const readMigration = (name: string) => Deno.readTextFile(new URL(name, MIGRATIONS));
const EVENTS_MIGRATION = '20261031120000_events.sql';
// Every migration before the events one, in order. The pg_cron migration is never loaded: PGlite has no pg_cron.
const BEFORE_EVENTS = [
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

/** Roles and every migration before the events one. */
function before(): Promise<Db> {
  beforeDb ??= (async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(SUPABASE_ROLES_SQL);
    for (const f of BEFORE_EVENTS) await db.exec(await readMigration(f));
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

/** `before` plus the events migration, applied once. */
function after(): Promise<Db> {
  afterDb ??= (async () => {
    const base = await before();
    functionsBefore = functionDefs(base);
    const db = await base.clone();
    await db.exec(await readMigration(EVENTS_MIGRATION));
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

/** Call a SQL function expression and return its single jsonb/scalar result. */
async function call(db: Db, expr: string, ...params: unknown[]): Promise<Json> {
  return ((await db.query(`select ${expr} as r`, params)).rows[0] as Json).r;
}

const j = (v: unknown) => JSON.stringify(v);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const newId = () => crypto.randomUUID();

const HOLDER = { name: 'Thandi Nkosi', phone: '0821234567', email: 'thandi@example.com' };

async function mkEvent(db: Db, o: Record<string, unknown> = {}): Promise<Json> {
  const r = await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', newId(), j({
    title: 'Test Night',
    startsAt: at(DAY),
    status: 'published',
    ...o,
  }));
  assert(r.ok, j(r));
  return r.event;
}

async function mkType(db: Db, eventId: string, o: Record<string, unknown> = {}): Promise<Json> {
  const r = await call(db, 'public.upsert_ticket_type($1::uuid, $2::jsonb)', newId(), j({
    eventId,
    name: 'General',
    price: 0,
    capacity: 10,
    ...o,
  }));
  assert(r.ok, j(r));
  return r.ticketType;
}

/** A published event in a day, with one free type of this capacity. */
async function freeEvent(db: Db, capacity = 10, typeExtra: Record<string, unknown> = {}) {
  const event = await mkEvent(db);
  const type = await mkType(db, event.id, { capacity, ...typeExtra });
  return { event, type };
}

const rsvp = (
  db: Db,
  slug: string,
  typeId: string,
  qty = 1,
  id: string = newId(),
  ip: string | null = null,
  holder: unknown = HOLDER,
) =>
  call(
    db,
    'public.rsvp_tickets($1::uuid, $2, $3::uuid, $4::int, $5::jsonb, $6)',
    id,
    slug,
    typeId,
    qty,
    j(holder),
    ip,
  );

const issue = (db: Db, typeId: string, qty = 1, id: string = newId(), holder: unknown = HOLDER) =>
  call(db, 'public.admin_issue_tickets($1::uuid, $2::uuid, $3::int, $4::jsonb)', id, typeId, qty, j(holder));

const checkIn = (db: Db, code: string, atTs: string | null = null, eventId: string | null = null) =>
  call(db, 'public.check_in_ticket($1, $2::timestamptz, $3::uuid)', code, atTs, eventId);
const voidTicket = (db: Db, code: string) => call(db, 'public.void_ticket($1)', code);
const soldOf = async (db: Db, typeId: string): Promise<number> =>
  (await rows(db, 'select sold from public.ticket_types where id = $1', [typeId]))[0].sold;
const ticketCount = async (db: Db): Promise<number> =>
  (await rows(db, 'select count(*)::int as n from public.tickets'))[0].n;
const codes = (r: Json): string[] => r.tickets.map((t: Json) => t.code);

// ---------------------------------------------------------------------------
// Capacity.
// ---------------------------------------------------------------------------
Deno.test('capacity: sold adds up exactly, a request that does not fit changes nothing and reports what is left', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 5);
    const a = await rsvp(db, event.slug, type.id, 4);
    assertEquals(a.ok, true);
    assertEquals(a.created, true);
    assertEquals(a.tickets.length, 4);
    assertEquals(await soldOf(db, type.id), 4);

    const tooMany = await rsvp(db, event.slug, type.id, 2);
    assertEquals(tooMany, { ok: false, reason: 'sold_out', available: 1 });
    assertEquals(await soldOf(db, type.id), 4);
    assertEquals(await ticketCount(db), 4);

    assertEquals((await rsvp(db, event.slug, type.id, 1)).ok, true);
    assertEquals(await soldOf(db, type.id), 5);
    assertEquals(await rsvp(db, event.slug, type.id, 1), { ok: false, reason: 'sold_out', available: 0 });
    assertEquals(await soldOf(db, type.id), 5);

    // The admin path takes from the same capacity.
    assertEquals(await issue(db, type.id, 1), { ok: false, reason: 'sold_out', available: 0 });
    assertEquals(await ticketCount(db), 5);
  });
});

Deno.test('capacity: RSVP and owner-issued tickets share one pool; sold equals the live ticket count', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 6);
    assertEquals((await rsvp(db, event.slug, type.id, 2)).ok, true);
    assertEquals((await issue(db, type.id, 3)).ok, true);
    assertEquals(await soldOf(db, type.id), 5);
    assertEquals((await issue(db, type.id, 2)).available, 1);
    assertEquals((await rsvp(db, event.slug, type.id, 1)).ok, true);
    assertEquals(await soldOf(db, type.id), 6);
    const live = (await rows(db, 'select count(*)::int as n from public.tickets where voided_at is null'))[0].n;
    assertEquals(live, 6);
  });
});

Deno.test('capacity: check (sold <= capacity) is the backstop and the public count never goes below 0', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 2);
    await assertRejects(() => db.query('update public.ticket_types set sold = 3 where id = $1', [type.id]));
    await mkType(db, event.id, { name: 'Closed', capacity: 0 });
    const pub = await call(db, 'public.get_event_public($1)', event.slug);
    for (const t of pub.ticketTypes) assert(t.available >= 0);
    assertEquals(pub.ticketTypes.find((t: Json) => t.name === 'Closed').available, 0);
  });
});

Deno.test('capacity: the issuing function takes the ticket_types row lock before it counts, and nothing else is locked', async () => {
  const text = await readMigration(EVENTS_MIGRATION);
  const body = (name: string) => {
    const start = text.indexOf(`create or replace function public.${name}(`);
    assert(start >= 0, name);
    return text.slice(start, text.indexOf('\n$$;', start));
  };
  const issueBody = body('issue_tickets');
  assert(/from public\.ticket_types\s+where id = p_type_id[^;]*\bfor update;/.test(issueBody));
  assertEquals(issueBody.match(/for update/g)?.length, 1);
  assert(issueBody.indexOf('for update') < issueBody.indexOf('v_type.sold + p_qty > v_type.capacity'));
  assert(issueBody.includes('gen_random_bytes(16)'));
  // void_ticket: the ticket_types row, then the ticket row.
  const v = body('void_ticket');
  assert(v.indexOf('from public.ticket_types where id = v_type_id for update') <
    v.indexOf('from public.tickets where id = v_id for update'));
  // check-in is one UPDATE and takes no explicit lock.
  assert(!body('check_in_ticket').includes('for update'));
});

// ---------------------------------------------------------------------------
// Idempotent group id.
// ---------------------------------------------------------------------------
Deno.test('idempotency: a retried id returns the same tickets and takes no capacity twice', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 10);
    const id = newId();
    const first = await rsvp(db, event.slug, type.id, 3, id);
    assertEquals(first.created, true);
    const again = await rsvp(db, event.slug, type.id, 3, id);
    assertEquals(again.ok, true);
    assertEquals(again.created, false);
    assertEquals(codes(again), codes(first));
    assertEquals(await soldOf(db, type.id), 3);
    assertEquals(await ticketCount(db), 3);
    // The group id is the request id, and the first ticket also takes it as its id.
    const groups = await rows(db, 'select distinct group_id from public.tickets');
    assertEquals(groups.map((g) => g.group_id), [id]);
    assertEquals(first.tickets[0].id, id);
    assertEquals(new Set(first.tickets.map((t: Json) => t.id)).size, 3);
  });
});

Deno.test('idempotency: a replay is answered before anything else, even after the event ended or sold out', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 2);
    const id = newId();
    const first = await rsvp(db, event.slug, type.id, 2, id);
    await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', event.id, j({ startsAt: at(-3 * DAY), endsAt: at(-2 * DAY) }));
    assertEquals((await rsvp(db, event.slug, type.id, 2, newId())).reason, 'event_ended');
    const again = await rsvp(db, event.slug, type.id, 2, id);
    assertEquals(again.ok, true);
    assertEquals(codes(again), codes(first));
    assertEquals(await soldOf(db, type.id), 2);
  });
});

Deno.test('idempotency: the same for owner-issued tickets, and a used id cannot be reused for another type or source', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 10);
    const other = await mkType(db, event.id, { name: 'VIP', price: 300, capacity: 5 });
    const id = newId();
    const a = await issue(db, other.id, 2, id);
    assertEquals(a.created, true);
    const b = await issue(db, other.id, 2, id);
    assertEquals(b.created, false);
    assertEquals(codes(b), codes(a));
    assertEquals(await soldOf(db, other.id), 2);
    // The id already belongs to a group: another type cannot take it.
    assertEquals(await rsvp(db, event.slug, type.id, 1, id), { ok: false, reason: 'id_taken' });
    assertEquals(await soldOf(db, type.id), 0);
  });
});

// ---------------------------------------------------------------------------
// RSVP rules.
// ---------------------------------------------------------------------------
Deno.test('rsvp: paid types, ended events, closed sales and hidden events are refused and keep nothing', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 10);
    const paid = await mkType(db, event.id, { name: 'VIP', price: 150, capacity: 10 });
    assertEquals(await rsvp(db, event.slug, paid.id, 1), { ok: false, reason: 'paid_type' });

    const future = await mkType(db, event.id, { name: 'Later', saleStartsAt: at(HOUR) });
    const past = await mkType(db, event.id, { name: 'Closed', saleEndsAt: at(-HOUR) });
    const off = await mkType(db, event.id, { name: 'Off', active: false });
    for (const t of [future, past, off]) {
      assertEquals(await rsvp(db, event.slug, t.id, 1), { ok: false, reason: 'not_on_sale' });
    }

    // A type of another event is not found under this slug.
    const elsewhere = await freeEvent(db, 3);
    assertEquals(await rsvp(db, event.slug, elsewhere.type.id, 1), { ok: false, reason: 'not_found' });

    // Draft, cancelled and unknown events are all 'not_found'.
    const draft = await freeEvent(db, 3);
    await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', draft.event.id, j({ status: 'draft' }));
    assertEquals(await rsvp(db, draft.event.slug, draft.type.id, 1), { ok: false, reason: 'not_found' });
    await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', draft.event.id, j({ status: 'cancelled' }));
    assertEquals(await rsvp(db, draft.event.slug, draft.type.id, 1), { ok: false, reason: 'not_found' });
    assertEquals(await rsvp(db, 'no-such-event', type.id, 1), { ok: false, reason: 'not_found' });

    // Ended: ends_at passed, or no ends_at and 6 hours since the start.
    const ended = await freeEvent(db, 3);
    await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', ended.event.id, j({ startsAt: at(-2 * DAY), endsAt: at(-DAY) }));
    assertEquals(await rsvp(db, ended.event.slug, ended.type.id, 1), { ok: false, reason: 'event_ended' });
    const noEnd = await freeEvent(db, 3);
    await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', noEnd.event.id, j({ startsAt: at(-7 * HOUR), endsAt: null }));
    assertEquals(await rsvp(db, noEnd.event.slug, noEnd.type.id, 1), { ok: false, reason: 'event_ended' });
    const running = await freeEvent(db, 3);
    await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', running.event.id, j({ startsAt: at(-HOUR), endsAt: null }));
    assertEquals((await rsvp(db, running.event.slug, running.type.id, 1)).ok, true);

    // Quantity 1 to 4 only.
    assertEquals((await rsvp(db, event.slug, type.id, 5)).reason, 'bad_quantity');
    assertEquals((await rsvp(db, event.slug, type.id, 0)).reason, 'bad_quantity');

    assertEquals(await soldOf(db, type.id), 0);
    assertEquals(await soldOf(db, paid.id), 0);
  });
});

Deno.test('rsvp: the holder is stored trimmed, the email is optional, the source is rsvp', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db);
    const r = await rsvp(db, event.slug, type.id, 1, newId(), null, { name: '  Sipho Dlamini ', phone: ' 0831112222 ' });
    const t = r.tickets[0];
    assertEquals(t.holderName, 'Sipho Dlamini');
    assertEquals(t.holderPhone, '0831112222');
    assertEquals(t.holderEmail, null);
    assertEquals(t.source, 'rsvp');
    assertEquals(t.eventSlug, event.slug);
    assertEquals(t.ticketTypeName, 'General');
  });
});

Deno.test('codes: 128 bits of randomness as 32 lowercase hex characters, all different', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 40);
    const all: string[] = [];
    for (let i = 0; i < 6; i++) all.push(...codes(await rsvp(db, event.slug, type.id, 4)));
    assertEquals(all.length, 24);
    assertEquals(new Set(all).size, 24);
    for (const c of all) assert(/^[0-9a-f]{32}$/.test(c), c);
    const stored = await rows(db, 'select code from public.tickets');
    assertEquals(stored.length, 24);
    // get_ticket finds a code in any case and with spaces round it; an unknown or empty one is null.
    assertEquals((await call(db, 'public.get_ticket($1)', ` ${all[0].toUpperCase()} `)).code, all[0]);
    assertEquals(await call(db, 'public.get_ticket($1)', 'nope'), null);
    assertEquals(await call(db, 'public.get_ticket($1)', ''), null);
  });
});

// ---------------------------------------------------------------------------
// The address limit.
// ---------------------------------------------------------------------------
const IP = '203.0.113.9';

Deno.test('rsvp limit: 5 RSVPs per address pass, the 6th is rate_limited and keeps nothing; replays and refusals do not count', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 100);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = newId();
      ids.push(id);
      assertEquals((await rsvp(db, event.slug, type.id, 2, id, IP)).ok, true);
    }
    assertEquals(await soldOf(db, type.id), 10);
    const sixth = await rsvp(db, event.slug, type.id, 2, newId(), IP);
    assertEquals(sixth, { ok: false, reason: 'rate_limited' });
    assertEquals(await soldOf(db, type.id), 10);
    assertEquals(await ticketCount(db), 10);
    assertEquals((await rows(db, 'select count(*)::int as n from public.rsvp_ip_log'))[0].n, 5);
    // A replay at the limit still answers, and another address is not affected.
    const replay = await rsvp(db, event.slug, type.id, 2, ids[0], IP);
    assertEquals(replay.ok, true);
    assertEquals(replay.created, false);
    assertEquals((await rsvp(db, event.slug, type.id, 1, newId(), '198.51.100.7')).ok, true);
    // No address, no limit.
    for (let i = 0; i < 7; i++) assertEquals((await rsvp(db, event.slug, type.id, 1)).ok, true);
    assertEquals((await rsvp(db, event.slug, type.id, 1, newId(), '')).ok, true);
    assertEquals((await rows(db, 'select count(*)::int as n from public.rsvp_ip_log'))[0].n, 6);
  });
});

Deno.test('rsvp limit: refused requests do not count, and the hour rolls', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 100);
    const paid = await mkType(db, event.id, { name: 'VIP', price: 100 });
    for (let i = 0; i < 8; i++) assertEquals((await rsvp(db, event.slug, paid.id, 1, newId(), IP)).reason, 'paid_type');
    assertEquals((await rows(db, 'select count(*)::int as n from public.rsvp_ip_log'))[0].n, 0);
    for (let i = 0; i < 5; i++) assertEquals((await rsvp(db, event.slug, type.id, 1, newId(), IP)).ok, true);
    assertEquals((await rsvp(db, event.slug, type.id, 1, newId(), IP)).reason, 'rate_limited');
    await db.exec(`update public.rsvp_ip_log set created_at = now() - interval '61 minutes'`);
    assertEquals((await rsvp(db, event.slug, type.id, 1, newId(), IP)).ok, true);
    // The old rows were deleted, only the new one is left.
    assertEquals((await rows(db, 'select count(*)::int as n from public.rsvp_ip_log'))[0].n, 1);
  });
});

Deno.test('rsvp limit: the log holds only a hash made with the existing order salt; the address is stored nowhere', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 100);
    const saltBefore = (await rows(db, 'select salt from public.order_rate_salt'))[0].salt as string;
    await rsvp(db, event.slug, type.id, 1, newId(), IP);
    await rsvp(db, event.slug, type.id, 1, newId(), IP);
    const log = await rows(db, 'select * from public.rsvp_ip_log');
    assertEquals(log.length, 2);
    assertEquals(Object.keys(log[0]).sort(), ['created_at', 'ip_hash']);
    const expected = (await rows(db, `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`, [saltBefore + IP]))[0].h;
    assertEquals(log[0].ip_hash, expected);
    assertEquals(log[1].ip_hash, expected);
    // The salt is the one the order limit uses, and was not replaced.
    assertEquals((await rows(db, 'select count(*)::int as n from public.order_rate_salt'))[0].n, 1);
    assertEquals((await rows(db, 'select salt from public.order_rate_salt'))[0].salt, saltBefore);
    const dump = JSON.stringify({
      log,
      tickets: await rows(db, 'select to_jsonb(t) as r from public.tickets t'),
      events: await rows(db, 'select to_jsonb(e) as r from public.events e'),
    });
    assert(!dump.includes(IP));
  });
});

// ---------------------------------------------------------------------------
// Owner-issued tickets.
// ---------------------------------------------------------------------------
Deno.test('admin_issue_tickets: paid and free types, 1 to 20, source issued, no sale window or price checks', async () => {
  await withDb(async (db) => {
    const event = await mkEvent(db);
    const paid = await mkType(db, event.id, { name: 'VIP', price: 250, capacity: 25, saleEndsAt: at(-HOUR) });
    const r = await issue(db, paid.id, 20);
    assertEquals(r.ok, true);
    assertEquals(r.tickets.length, 20);
    for (const t of r.tickets) assertEquals(t.source, 'issued');
    assertEquals(await soldOf(db, paid.id), 20);
    assertEquals((await issue(db, paid.id, 21)).reason, 'bad_quantity');
    assertEquals((await issue(db, paid.id, 0)).reason, 'bad_quantity');
    assertEquals((await issue(db, newId(), 1)).reason, 'not_found');
    // A draft event can have tickets issued; a cancelled one cannot.
    await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', event.id, j({ status: 'draft' }));
    assertEquals((await issue(db, paid.id, 1)).ok, true);
    await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', event.id, j({ status: 'cancelled' }));
    assertEquals((await issue(db, paid.id, 1)).reason, 'event_cancelled');
    assertEquals(await soldOf(db, paid.id), 21);
  });
});

// ---------------------------------------------------------------------------
// Check-in.
// ---------------------------------------------------------------------------
Deno.test('check_in_ticket: the first call wins and the second is already, with the first time', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db);
    const [code] = codes(await rsvp(db, event.slug, type.id, 1));
    const a = await checkIn(db, code);
    assertEquals(a.result, 'ok');
    assert(a.checkedInAt);
    assertEquals(a.ticket.code, code);
    assertEquals(a.ticket.checkedInAt, a.checkedInAt);
    const b = await checkIn(db, code.toUpperCase());
    assertEquals(b.result, 'already');
    assertEquals(new Date(b.checkedInAt).getTime(), new Date(a.checkedInAt).getTime());
    assertEquals(
      (await rows(db, 'select count(*)::int as n from public.tickets where checked_in_at is not null'))[0].n,
      1,
    );
    assertEquals((await checkIn(db, 'f'.repeat(32))).result, 'not_found');
    assertEquals(await checkIn(db, ''), { result: 'not_found' });
  });
});

Deno.test('check_in_ticket: a void ticket is void, and the offline scan time is kept only when it is plausible', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 20);
    const [voidCode, a, b, c, d] = codes(await rsvp(db, event.slug, type.id, 4)).concat(codes(await rsvp(db, event.slug, type.id, 1)));
    await voidTicket(db, voidCode);
    const v = await checkIn(db, voidCode);
    assertEquals(v.result, 'void');
    assertEquals(v.checkedInAt, null);
    assertEquals((await rows(db, 'select checked_in_at from public.tickets where code = $1', [voidCode]))[0].checked_in_at, null);

    const t2 = new Date(Date.now() - 2 * HOUR);
    const kept = await checkIn(db, a, t2.toISOString());
    assertEquals(kept.result, 'ok');
    assertEquals(new Date(kept.checkedInAt).getTime(), t2.getTime());

    const future = await checkIn(db, b, at(HOUR));
    assert(Math.abs(new Date(future.checkedInAt).getTime() - Date.now()) < 60_000);
    const old = await checkIn(db, c, at(-25 * HOUR));
    assert(Math.abs(new Date(old.checkedInAt).getTime() - Date.now()) < 60_000);
    const edge = await checkIn(db, d, at(-23 * HOUR));
    assert(Math.abs(new Date(edge.checkedInAt).getTime() - (Date.now() - 23 * HOUR)) < 60_000);
  });
});

Deno.test('check_in_ticket: a ticket of another event is wrong_event and nothing is written', async () => {
  await withDb(async (db) => {
    const one = await freeEvent(db);
    const two = await freeEvent(db);
    const [code] = codes(await rsvp(db, one.event.slug, one.type.id, 1));
    const r = await checkIn(db, code, null, two.event.id);
    assertEquals(r.result, 'wrong_event');
    assertEquals(r.ticket.eventId, one.event.id);
    assertEquals((await rows(db, 'select checked_in_at from public.tickets where code = $1', [code]))[0].checked_in_at, null);
    assertEquals((await checkIn(db, code, null, one.event.id)).result, 'ok');
  });
});

// ---------------------------------------------------------------------------
// Void.
// ---------------------------------------------------------------------------
Deno.test('void_ticket: returns the seat once, a second void changes nothing, a used ticket cannot be voided', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 3);
    const [c1, c2, c3] = codes(await rsvp(db, event.slug, type.id, 3));
    assertEquals(await soldOf(db, type.id), 3);
    assertEquals((await rsvp(db, event.slug, type.id, 1)).available, 0);

    const v = await voidTicket(db, c1);
    assertEquals(v.ok, true);
    assertEquals(v.changed, true);
    assert(v.ticket.voidedAt);
    assertEquals(await soldOf(db, type.id), 2);
    const again = await voidTicket(db, c1);
    assertEquals(again.ok, true);
    assertEquals(again.changed, false);
    assertEquals(await soldOf(db, type.id), 2);

    // The freed seat can be taken, and only one.
    assertEquals((await rsvp(db, event.slug, type.id, 2)).available, 1);
    assertEquals((await rsvp(db, event.slug, type.id, 1)).ok, true);
    assertEquals(await soldOf(db, type.id), 3);

    // Used: no void, no capacity change.
    assertEquals((await checkIn(db, c2)).result, 'ok');
    const used = await voidTicket(db, c2);
    assertEquals(used.ok, false);
    assertEquals(used.reason, 'used');
    assertEquals(await soldOf(db, type.id), 3);
    assertEquals((await rows(db, 'select voided_at from public.tickets where code = $1', [c2]))[0].voided_at, null);

    assertEquals(await voidTicket(db, 'a'.repeat(32)), { ok: false, reason: 'not_found' });
    assertEquals((await voidTicket(db, c3.toUpperCase())).changed, true);
    assertEquals(await soldOf(db, type.id), 2);
  });
});

// ---------------------------------------------------------------------------
// Public reads.
// ---------------------------------------------------------------------------
Deno.test('public lists: upcoming soonest first, past newest first, drafts and cancelled never', async () => {
  await withDb(async (db) => {
    const later = await mkEvent(db, { title: 'Later', startsAt: at(5 * DAY) });
    const soon = await mkEvent(db, { title: 'Soon', startsAt: at(DAY) });
    await mkEvent(db, { title: 'Draft', status: 'draft' });
    await mkEvent(db, { title: 'Called off', status: 'cancelled' });
    const oldest = await mkEvent(db, { title: 'Oldest', startsAt: at(-10 * DAY), endsAt: at(-10 * DAY + 3 * HOUR) });
    const recent = await mkEvent(db, { title: 'Recent', startsAt: at(-2 * DAY), endsAt: at(-2 * DAY + 3 * HOUR) });
    const running = await mkEvent(db, { title: 'Running', startsAt: at(-HOUR) });
    await mkEvent(db, { title: 'Past draft', status: 'draft', startsAt: at(-5 * DAY) });
    assert(later && oldest && recent);

    const up = await call(db, 'public.list_events_public(false)');
    assertEquals(up.map((e: Json) => e.title), ['Running', 'Soon', 'Later']);
    const past = await call(db, 'public.list_events_public(true)');
    assertEquals(past.map((e: Json) => e.title), ['Recent', 'Oldest']);
    assertEquals(await call(db, 'public.list_events_public()'), up);
    assert(running && soon);
  });
});

Deno.test('public event: only the allow-listed fields, active types only, onSale and available worked out', async () => {
  await withDb(async (db) => {
    const event = await mkEvent(db, { description: 'Hello', venue: 'The Hall', city: 'Joburg', image: 'https://x.test/a.png' });
    await mkType(db, event.id, { name: 'Free', price: 0, capacity: 5, sort: 2 });
    await mkType(db, event.id, { name: 'VIP', price: 99.5, capacity: 5, sort: 1 });
    await mkType(db, event.id, { name: 'Hidden', active: false });
    await mkType(db, event.id, { name: 'Soon', saleStartsAt: at(HOUR), sort: 3 });
    const pub = await call(db, 'public.get_event_public($1)', event.slug);
    assertEquals(Object.keys(pub).sort(), [
      'city', 'description', 'endsAt', 'id', 'image', 'slug', 'startsAt', 'ticketTypes', 'title', 'venue',
    ]);
    assertEquals(pub.ticketTypes.map((t: Json) => t.name), ['VIP', 'Free', 'Soon']);
    for (const t of pub.ticketTypes) assertEquals(Object.keys(t).sort(), ['available', 'id', 'name', 'onSale', 'price']);
    assertEquals(pub.ticketTypes[0].price, 99.5);
    assertEquals(pub.ticketTypes.map((t: Json) => t.onSale), [true, true, false]);
    // Not published: null.
    const draft = await mkEvent(db, { status: 'draft' });
    assertEquals(await call(db, 'public.get_event_public($1)', draft.slug), null);
    assertEquals(await call(db, 'public.get_event_public($1)', 'nope'), null);
    // An ended event shows nothing as on sale.
    await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', event.id, j({ startsAt: at(-3 * DAY), endsAt: at(-2 * DAY) }));
    const ended = await call(db, 'public.get_event_public($1)', event.slug);
    assertEquals(ended.ticketTypes.map((t: Json) => t.onSale), [false, false, false]);
  });
});

// ---------------------------------------------------------------------------
// Admin: events and ticket types.
// ---------------------------------------------------------------------------
Deno.test('upsert_event: slug from the title, unique suffixes, kept on update; end can be cleared; bad dates refused', async () => {
  await withDb(async (db) => {
    const a = await mkEvent(db, { title: 'Summer Jam 2026!' });
    assertEquals(a.slug, 'summer-jam-2026');
    assertEquals(a.status, 'published');
    assertEquals((await mkEvent(db, { title: 'Summer Jam 2026' })).slug, 'summer-jam-2026-2');
    assertEquals((await mkEvent(db, { title: '???' })).slug, 'event');

    const u = await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', a.id, j({ title: 'Renamed', endsAt: at(2 * DAY) }));
    assertEquals(u.created, false);
    assertEquals(u.event.slug, 'summer-jam-2026');
    assertEquals(u.event.title, 'Renamed');
    assert(u.event.endsAt);
    const cleared = await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', a.id, j({ endsAt: null }));
    assertEquals(cleared.event.endsAt, null);
    assertEquals(cleared.event.title, 'Renamed');

    const bad = await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', a.id, j({ endsAt: at(-5 * DAY) }));
    assertEquals(bad, { ok: false, reason: 'bad_dates' });
    const taken = await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', a.id, j({ slug: 'event' }));
    assertEquals(taken, { ok: false, reason: 'slug_taken' });
    const own = await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', a.id, j({ slug: 'summer-jam-2026' }));
    assertEquals(own.ok, true);

    // A new event needs a title and a start time; nothing is created without them.
    assertEquals(await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', newId(), j({ title: 'No start' })), { ok: false, reason: 'missing_fields' });
    assertEquals(await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', newId(), j({ startsAt: at(DAY) })), { ok: false, reason: 'missing_fields' });
    assertEquals(await call(db, 'public.upsert_event($1::uuid, $2::jsonb)', newId(), j({ title: '  ', startsAt: at(DAY) })), { ok: false, reason: 'missing_fields' });

    const all = await call(db, 'public.list_events_admin()');
    assertEquals(all.length, 3);
    for (const e of all) assert(e.status && e.createdAt);
  });
});

Deno.test('upsert_ticket_type: capacity cannot go below sold, a new type needs a real event', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 5);
    await rsvp(db, event.slug, type.id, 4);
    const low = await call(db, 'public.upsert_ticket_type($1::uuid, $2::jsonb)', type.id, j({ capacity: 3 }));
    assertEquals(low, { ok: false, reason: 'capacity_below_sold', sold: 4 });
    const ok = await call(db, 'public.upsert_ticket_type($1::uuid, $2::jsonb)', type.id, j({ capacity: 4, price: 0 }));
    assertEquals(ok.ok, true);
    assertEquals(ok.ticketType.capacity, 4);
    assertEquals(ok.ticketType.sold, 4);
    assertEquals(ok.ticketType.available, 0);
    assertEquals(ok.ticketType.name, 'General');
    const orphan = await call(db, 'public.upsert_ticket_type($1::uuid, $2::jsonb)', newId(), j({ eventId: newId(), name: 'X', capacity: 1 }));
    assertEquals(orphan, { ok: false, reason: 'event_not_found' });
    const nameless = await call(db, 'public.upsert_ticket_type($1::uuid, $2::jsonb)', newId(), j({ eventId: event.id, capacity: 1 }));
    assertEquals(nameless, { ok: false, reason: 'missing_fields' });
    const dates = await call(db, 'public.upsert_ticket_type($1::uuid, $2::jsonb)', type.id, j({ saleStartsAt: at(2 * HOUR), saleEndsAt: at(HOUR) }));
    assertEquals(dates, { ok: false, reason: 'bad_dates' });
    assertEquals(await soldOf(db, type.id), 4);
  });
});

Deno.test('deletes: a type with sold or any ticket stays; an event with tickets stays; empty ones go', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 5);
    const spare = await mkType(db, event.id, { name: 'Spare' });
    const [code] = codes(await rsvp(db, event.slug, type.id, 1));

    assertEquals((await call(db, 'public.delete_ticket_type($1::uuid)', type.id)).reason, 'has_tickets');
    assertEquals((await call(db, 'public.delete_event($1::uuid)', event.id)).reason, 'has_tickets');
    // A void ticket still blocks: it points at the type and the event.
    await voidTicket(db, code);
    assertEquals(await soldOf(db, type.id), 0);
    assertEquals((await call(db, 'public.delete_ticket_type($1::uuid)', type.id)).reason, 'has_tickets');
    assertEquals((await call(db, 'public.delete_event($1::uuid)', event.id)).reason, 'has_tickets');

    assertEquals(await call(db, 'public.delete_ticket_type($1::uuid)', spare.id), { ok: true });
    assertEquals(await call(db, 'public.delete_ticket_type($1::uuid)', spare.id), { ok: false, reason: 'not_found' });

    const empty = await freeEvent(db, 5);
    await mkType(db, empty.event.id, { name: 'Two' });
    assertEquals(await call(db, 'public.delete_event($1::uuid)', empty.event.id), { ok: true });
    assertEquals(
      (await rows(db, 'select count(*)::int as n from public.ticket_types where event_id = $1', [empty.event.id]))[0].n,
      0,
    );
    assertEquals(await call(db, 'public.delete_event($1::uuid)', empty.event.id), { ok: false, reason: 'not_found' });
  });
});

Deno.test('list_event_tickets: holder details for the door, null for an unknown event', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db, 10);
    await rsvp(db, event.slug, type.id, 2);
    await issue(db, type.id, 1, newId(), { name: 'Walk In', phone: '0711111111' });
    const list = await call(db, 'public.list_event_tickets($1::uuid)', event.id);
    assertEquals(list.length, 3);
    assertEquals(list.filter((t: Json) => t.source === 'issued').length, 1);
    for (const t of list) assert(t.holderName && t.holderPhone && t.code);
    assertEquals(await call(db, 'public.list_event_tickets($1::uuid)', newId()), null);
    assertEquals(await call(db, 'public.list_event_tickets($1::uuid)', (await mkEvent(db)).id), []);
  });
});

// ---------------------------------------------------------------------------
// RLS and grants.
// ---------------------------------------------------------------------------
const TABLES = ['events', 'ticket_types', 'tickets', 'rsvp_ip_log'];
const PUBLIC_FUNCTIONS = [
  'public.list_events_public(boolean)',
  'public.get_event_public(text)',
  'public.get_ticket(text)',
  'public.rsvp_tickets(uuid,text,uuid,int,jsonb,text)',
  'public.admin_issue_tickets(uuid,uuid,int,jsonb)',
  'public.check_in_ticket(text,timestamptz,uuid)',
  'public.void_ticket(text)',
  'public.list_events_admin()',
  'public.list_event_tickets(uuid)',
  'public.upsert_event(uuid,jsonb)',
  'public.delete_event(uuid)',
  'public.upsert_ticket_type(uuid,jsonb)',
  'public.delete_ticket_type(uuid)',
  'public.event_ended(public.events)',
  'public.ticket_type_json(public.ticket_types,boolean)',
  'public.event_json(public.events,boolean)',
  'public.ticket_json(public.tickets)',
  'public.group_tickets_json(uuid)',
];

Deno.test('RLS and grants: tables have RLS and no policies; anon and authenticated can touch nothing', async () => {
  await withDb(async (db) => {
    const { event, type } = await freeEvent(db);
    await rsvp(db, event.slug, type.id, 1);
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
        await assertRejects(
          () => db.query(`select public.get_ticket('x')`),
          Error,
          'permission denied',
        );
      } finally {
        await db.exec('reset role');
      }
    }
  });
});

Deno.test('RLS and grants: every function is service_role only; issue_tickets is for no role at all', async () => {
  await withDb(async (db) => {
    for (const sig of PUBLIC_FUNCTIONS) {
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
    const internal = 'public.issue_tickets(uuid,uuid,uuid,int,jsonb,text)';
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assertEquals(
        (await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, internal]))[0].ok,
        false,
        `${role} ${internal}`,
      );
    }
    // Every function the migration creates is covered by one list or the other.
    const created = [...(await readMigration(EVENTS_MIGRATION)).matchAll(/create or replace function public\.(\w+)\(/g)]
      .map((m) => m[1]);
    const covered = new Set([...PUBLIC_FUNCTIONS, internal].map((s) => s.slice('public.'.length, s.indexOf('('))));
    for (const name of created) assert(covered.has(name), `${name} has no grant check`);
    assertEquals(created.length, covered.size);
  });
});

// ---------------------------------------------------------------------------
// The migration itself.
// ---------------------------------------------------------------------------
Deno.test('migration: no existing function changed, no existing table or order touched', async () => {
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

Deno.test('migration: a second run changes nothing and keeps the data and the grants', async () => {
  await withDb(async (db) => {
    const sql = await readMigration(EVENTS_MIGRATION);
    const dump = async () => ({
      tables: await rows(db, `select t.table_name, c.column_name, c.data_type from information_schema.tables t
        join information_schema.columns c using (table_schema, table_name)
        where t.table_schema = 'public' and t.table_name in ('events','ticket_types','tickets','rsvp_ip_log')
        order by 1, c.ordinal_position`),
      functions: await functionDefs(db),
      data: {
        events: await rows(db, 'select to_jsonb(e) as r from public.events e order by e.id'),
        types: await rows(db, 'select to_jsonb(t) as r from public.ticket_types t order by t.id'),
        tickets: await rows(db, 'select to_jsonb(t) as r from public.tickets t order by t.id'),
      },
    });
    const { event, type } = await freeEvent(db);
    await rsvp(db, event.slug, type.id, 2, newId(), IP);
    const first = await dump();
    await db.exec(sql);
    assertEquals(await dump(), first);
  });
});

Deno.test('teardown', async () => {
  if (afterDb) await (await afterDb).close();
  if (beforeDb) await (await beforeDb).close();
});
