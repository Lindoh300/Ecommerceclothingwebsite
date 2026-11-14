// Tests for supabase/migrations/20261031160000_list_sends.sql (sending to the mailing list), run against an in-process
// Postgres (PGlite) with every migration before it applied. Run with `deno task test:sql` from supabase/functions/server.
//
// PGlite is ONE connection, so these tests cannot show real races between concurrent transactions. They check the
// logic: the snapshot, the claim (limit, order, skipping, "sending" never claimed again, two claims never the same
// row), the finish and its retries, the summary, RLS and grants, and that the migration is additive and safe to re-run.
import { assert, assertEquals, assertRejects } from '@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.13';
import { pgcrypto } from 'npm:@electric-sql/pglite@0.5.13/contrib/pgcrypto';

// deno-lint-ignore no-explicit-any
type Json = any;
type Db = Awaited<ReturnType<PGlite['clone']>>;

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const readMigration = (name: string) => Deno.readTextFile(new URL(name, MIGRATIONS));
const LIST_SENDS_MIGRATION = '20261031160000_list_sends.sql';
// Every migration before the list-sends one, in order. The pg_cron migration is never loaded: PGlite has no pg_cron.
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

/** `before` plus the list-sends migration, applied once. */
function after(): Promise<Db> {
  afterDb ??= (async () => {
    const base = await before();
    functionsBefore = functionDefs(base);
    const db = await base.clone();
    await db.exec(await readMigration(LIST_SENDS_MIGRATION));
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

const TEXT = '[2026-10-31] Yes, I\'d like 4Nguru to send me news about new drops and events. I can opt out at any time.';
const newId = () => crypto.randomUUID();

/** public.create_list_send(id, subject, body) -> {created, send} */
const create = (db: Db, id: string = newId(), subject = 'New drop', body = 'The new range lands on Friday.') =>
  call(db, 'public.create_list_send($1::uuid, $2, $3)', id, subject, body);
/** public.claim_list_send_batch(id, limit) */
const claim = (db: Db, id: string, limit?: number) =>
  limit === undefined ? call(db, 'public.claim_list_send_batch($1::uuid)', id) : call(db, 'public.claim_list_send_batch($1::uuid, $2)', id, limit);
/** public.finish_list_send_batch(id, ids, ok) */
const finish = (db: Db, id: string, ids: string[], ok: boolean) =>
  call(db, 'public.finish_list_send_batch($1::uuid, $2::uuid[], $3)', id, ids, ok);
const summary = (db: Db, id: string) => call(db, 'public.list_send_summary($1::uuid)', id);
const states = async (db: Db, id: string) =>
  Object.fromEntries(
    (await rows(db, 'select state, count(*)::int as n from public.list_send_recipients where send_id = $1 group by state', [id])).map((r) => [r.state, r.n]),
  );
const subscribe = (db: Db, o: { phone?: string | null; email?: string | null }) =>
  call(db, 'public.subscribe($1, $2, $3, $4, $5, $6)', null, o.phone ?? null, o.email ?? null, TEXT, 'footer', null);
const unsubscribe = (db: Db, o: { phone?: string | null; email?: string | null }) =>
  call(db, 'public.unsubscribe_contact($1, $2, $3)', o.phone ?? null, o.email ?? null, null);
const subId = async (db: Db, email: string): Promise<string> =>
  (await rows(db, 'select id from public.subscribers where lower(email) = lower($1)', [email]))[0].id;

/** `n` subscribers with an email, named `${prefix}${i}@example.com`. */
async function join(db: Db, n: number, prefix = 'p') {
  await db.query(
    `insert into public.subscribers (email, consent_text, consent_at, source)
     select $1 || i || '@example.com', $2, now(), 'footer' from generate_series(0, $3::int - 1) i`,
    [prefix, TEXT, n],
  );
}

// ---------------------------------------------------------------------------
// The table rules.
// ---------------------------------------------------------------------------
Deno.test('list_sends: subject 1 to 150 and body 1 to 10000 characters after trimming; the text is kept as given', async () => {
  await withDb(async (db) => {
    const ins = (subject: string, body: string) =>
      db.query('insert into public.list_sends (id, subject, body) values ($1, $2, $3)', [newId(), subject, body]);
    await assertRejects(() => ins('', 'b'), Error, 'check');
    await assertRejects(() => ins('   ', 'b'), Error, 'check');
    await assertRejects(() => ins('x'.repeat(151), 'b'), Error, 'check');
    await assertRejects(() => ins('s', ''), Error, 'check');
    await assertRejects(() => ins('s', '  \t'), Error, 'check');
    await assertRejects(() => ins('s', 'x'.repeat(10001)), Error, 'check');
    await ins('x'.repeat(150), 'y'.repeat(10000));
    await ins(' s ', ' b ');
    // Through the function, too.
    await assertRejects(() => create(db, newId(), ' ', 'b'), Error, 'check');
    await assertRejects(() => create(db, newId(), 's', ' '), Error, 'check');
    assertEquals((await rows(db, 'select count(*)::int as n from public.list_sends'))[0].n, 2);
  });
});

Deno.test('list_send_recipients: state values, the subscriber must exist, one row per send and subscriber, send delete cascades', async () => {
  await withDb(async (db) => {
    await join(db, 1);
    const sub = await subId(db, 'p0@example.com');
    const id = newId();
    await db.query('insert into public.list_sends (id, subject, body) values ($1, $2, $3)', [id, 's', 'b']);
    const ins = (subscriber: string, state?: string) =>
      state === undefined
        ? db.query('insert into public.list_send_recipients (send_id, subscriber_id) values ($1, $2)', [id, subscriber])
        : db.query('insert into public.list_send_recipients (send_id, subscriber_id, state) values ($1, $2, $3)', [id, subscriber, state]);
    await assertRejects(() => ins(sub, 'queued'), Error, 'check');
    await assertRejects(() => ins(newId()), Error, 'foreign key');
    await assertRejects(() => db.query('insert into public.list_send_recipients (send_id, subscriber_id) values ($1, $2)', [newId(), sub]), Error, 'foreign key');
    await ins(sub);
    await assertRejects(() => ins(sub), Error, 'duplicate');
    const r = (await rows(db, 'select state, attempts from public.list_send_recipients'))[0];
    assertEquals(r, { state: 'pending', attempts: 0 });
    // The subscriber row stays when the send goes, and the recipients go with the send.
    await db.query('delete from public.list_sends where id = $1', [id]);
    assertEquals((await rows(db, 'select count(*)::int as n from public.list_send_recipients'))[0].n, 0);
    assertEquals((await rows(db, 'select count(*)::int as n from public.subscribers'))[0].n, 1);
    // A subscriber who is in a send cannot be deleted from under it.
    const id2 = newId();
    await create(db, id2);
    await assertRejects(() => db.query('delete from public.subscribers where id = $1', [sub]), Error, 'foreign key');
  });
});

// ---------------------------------------------------------------------------
// create_list_send.
// ---------------------------------------------------------------------------
Deno.test('create_list_send: snapshots people with an email and no opt-out; opted-out and phone-only people are not in it', async () => {
  await withDb(async (db) => {
    await join(db, 3);
    await subscribe(db, { phone: '0821234567' });
    await subscribe(db, { email: 'gone@example.com' });
    await unsubscribe(db, { email: 'gone@example.com' });
    // Phone and email together: has an email, so it is in.
    await subscribe(db, { phone: '0831234567', email: 'both@example.com' });
    const id = newId();
    const r = await create(db, id, 'New drop', 'Body text');
    assertEquals(r.created, true);
    assertEquals(r.send, {
      id,
      subject: 'New drop',
      body: 'Body text',
      total: 4,
      pending: 4,
      sending: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      createdAt: r.send.createdAt,
      finishedAt: null,
    });
    assert(typeof r.send.createdAt === 'string' && !Number.isNaN(Date.parse(r.send.createdAt)));
    const inSend = (await rows(db, `select lower(s.email) as email from public.list_send_recipients r join public.subscribers s on s.id = r.subscriber_id order by 1`)).map((x) => x.email);
    assertEquals(inSend, ['both@example.com', 'p0@example.com', 'p1@example.com', 'p2@example.com']);
    // Only the id is stored, never the address.
    const cols = (await rows(db, `select column_name from information_schema.columns where table_name = 'list_send_recipients' order by 1`)).map((c) => c.column_name);
    assertEquals(cols, ['attempts', 'send_id', 'state', 'subscriber_id', 'updated_at']);
  });
});

Deno.test('create_list_send: a repeat id changes nothing and returns the same summary; the list is not snapshotted again', async () => {
  await withDb(async (db) => {
    await join(db, 2);
    const id = newId();
    const a = await create(db, id, 'First', 'First body');
    await join(db, 1, 'late');
    await claim(db, id, 1);
    const b = await create(db, id, 'Second', 'Second body');
    assertEquals(a.created, true);
    assertEquals(b.created, false);
    assertEquals(b.send.subject, 'First');
    assertEquals(b.send.body, 'First body');
    assertEquals([b.send.total, b.send.pending, b.send.sending], [2, 1, 1]);
    assertEquals(b.send, await summary(db, id));
    assertEquals((await rows(db, 'select count(*)::int as n from public.list_sends'))[0].n, 1);
    assertEquals((await rows(db, 'select count(*)::int as n from public.list_send_recipients'))[0].n, 2);
  });
});

Deno.test('create_list_send: with nobody to send to it is finished at once; someone who joins later is not added', async () => {
  await withDb(async (db) => {
    await subscribe(db, { phone: '0821234567' });
    const id = newId();
    const r = await create(db, id);
    assertEquals([r.send.total, r.send.pending], [0, 0]);
    assert(r.send.finishedAt !== null);
    const c = await claim(db, id);
    assertEquals(c.recipients, []);
    assertEquals(c.summary.finishedAt, r.send.finishedAt);
  });
});

// ---------------------------------------------------------------------------
// claim_list_send_batch.
// ---------------------------------------------------------------------------
Deno.test('claim_list_send_batch: null for an unknown send', async () => {
  await withDb(async (db) => {
    assertEquals(await claim(db, newId()), null);
    assertEquals(await finish(db, newId(), [], true), null);
    assertEquals(await summary(db, newId()), null);
  });
});

Deno.test('claim_list_send_batch: oldest subscriber id first, up to the limit; rows become sending with one attempt; the address comes with them', async () => {
  await withDb(async (db) => {
    await join(db, 5);
    const id = newId();
    await create(db, id);
    const c = await claim(db, id, 3);
    const expected = (await rows(db, `select id, email from public.subscribers order by id limit 3`)).map((s) => ({ subscriberId: s.id, email: s.email }));
    assertEquals(c.recipients, expected);
    assertEquals([c.summary.pending, c.summary.sending, c.summary.total], [2, 3, 5]);
    assertEquals(c.summary.finishedAt, null);
    const rowsNow = await rows(db, `select state, attempts from public.list_send_recipients order by subscriber_id`);
    assertEquals(rowsNow.map((r) => `${r.state}/${r.attempts}`), ['sending/1', 'sending/1', 'sending/1', 'pending/0', 'pending/0']);
    // The default limit is 100, and a limit of 0 or less claims nothing.
    assertEquals((await claim(db, id, 0)).recipients, []);
    assertEquals((await claim(db, id)).recipients.length, 2);
  });
});

Deno.test('claim_list_send_batch: two claims never return the same row, and a row left sending is never claimed again', async () => {
  await withDb(async (db) => {
    await join(db, 7);
    const id = newId();
    await create(db, id);
    const a = await claim(db, id, 3);
    const b = await claim(db, id, 3);
    const c = await claim(db, id, 3);
    const d = await claim(db, id, 3);
    const all = [a, b, c, d].flatMap((x) => x.recipients.map((r: Json) => r.subscriberId));
    assertEquals(all.length, 7);
    assertEquals(new Set(all).size, 7);
    assertEquals(d.recipients, []);
    // Nobody finished them (a crash): they stay 'sending', are not offered again and the send is not finished.
    assertEquals(await states(db, id), { sending: 7 });
    assertEquals((await claim(db, id)).recipients, []);
    assertEquals((await summary(db, id)).finishedAt, null);
    assertEquals((await rows(db, 'select max(attempts)::int as m from public.list_send_recipients'))[0].m, 1);
  });
});

Deno.test('claim_list_send_batch: someone who opted out after create is skipped, not returned, and does not use up the limit', async () => {
  await withDb(async (db) => {
    await join(db, 6);
    const id = newId();
    await create(db, id);
    const order = (await rows(db, `select s.email from public.list_send_recipients r join public.subscribers s on s.id = r.subscriber_id where r.send_id = $1 order by r.subscriber_id`, [id])).map((r) => r.email as string);
    // Opt out the first two in claim order.
    await unsubscribe(db, { email: order[0] });
    await unsubscribe(db, { email: order[1].toUpperCase() });
    const c = await claim(db, id, 3);
    assertEquals(c.recipients.map((r: Json) => r.email), [order[2], order[3], order[4]]);
    assertEquals([c.summary.skipped, c.summary.sending, c.summary.pending], [2, 3, 1]);
    for (const r of c.recipients) assert(r.email !== order[0] && r.email !== order[1]);
    const last = await claim(db, id, 3);
    assertEquals(last.recipients.map((r: Json) => r.email), [order[5]]);
    assertEquals(last.summary.skipped, 2);
  });
});

Deno.test('claim_list_send_batch: a send where everyone left is finished by the claim; an opt-out mid-send is respected on retry too', async () => {
  await withDb(async (db) => {
    await join(db, 2);
    const id = newId();
    await create(db, id);
    await unsubscribe(db, { email: 'p0@example.com' });
    await unsubscribe(db, { email: 'p1@example.com' });
    const c = await claim(db, id);
    assertEquals(c.recipients, []);
    assertEquals([c.summary.skipped, c.summary.pending], [2, 0]);
    assert(c.summary.finishedAt !== null);

    // A batch fails, the person opts out, and the retry skips them.
    const id2 = newId();
    await join(db, 2, 'q');
    await create(db, id2);
    const first = await claim(db, id2);
    assertEquals(first.recipients.length, 2);
    await finish(db, id2, first.recipients.map((r: Json) => r.subscriberId), false);
    await unsubscribe(db, { email: 'q0@example.com' });
    const retry = await claim(db, id2);
    assertEquals(retry.recipients.map((r: Json) => r.email), ['q1@example.com']);
    assertEquals([retry.summary.skipped, retry.summary.sending], [1, 1]);
  });
});

Deno.test('claim_list_send_batch: the address is read at claim time, so a changed address is used', async () => {
  await withDb(async (db) => {
    await join(db, 1);
    const id = newId();
    await create(db, id);
    await db.query(`update public.subscribers set email = 'new@example.com'`);
    assertEquals((await claim(db, id)).recipients.map((r: Json) => r.email), ['new@example.com']);
    // An address removed after create (phone only now) is skipped.
    const id2 = newId();
    await join(db, 1, 'z');
    await create(db, id2);
    await db.query(`update public.subscribers set phone = '0821234567', email = null where email like 'z%'`);
    const c = await claim(db, id2);
    assertEquals(c.recipients.map((r: Json) => r.email), ['new@example.com']);
    assertEquals(c.summary.skipped, 1);
  });
});

Deno.test('claim_list_send_batch: 250 people come out as 100, 100 and 50, each once', async () => {
  await withDb(async (db) => {
    await join(db, 250);
    const id = newId();
    await create(db, id);
    const sizes: number[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const c = await claim(db, id, 100);
      sizes.push(c.recipients.length);
      for (const r of c.recipients) seen.add(r.subscriberId);
      if (c.recipients.length > 0) await finish(db, id, c.recipients.map((r: Json) => r.subscriberId), true);
    }
    assertEquals(sizes, [100, 100, 50, 0, 0]);
    assertEquals(seen.size, 250);
    const s = await summary(db, id);
    assertEquals([s.total, s.sent, s.pending, s.sending], [250, 250, 0, 0]);
    assert(s.finishedAt !== null);
  });
});

// ---------------------------------------------------------------------------
// finish_list_send_batch.
// ---------------------------------------------------------------------------
Deno.test('finish_list_send_batch: ok makes the batch sent; the send is finished when nothing is pending or sending', async () => {
  await withDb(async (db) => {
    await join(db, 3);
    const id = newId();
    await create(db, id);
    const c = await claim(db, id, 2);
    const ids = c.recipients.map((r: Json) => r.subscriberId);
    const s1 = await finish(db, id, ids, true);
    assertEquals([s1.sent, s1.pending, s1.sending], [2, 1, 0]);
    assertEquals(s1.finishedAt, null);
    const c2 = await claim(db, id);
    const s2 = await finish(db, id, c2.recipients.map((r: Json) => r.subscriberId), true);
    assertEquals([s2.sent, s2.pending], [3, 0]);
    assert(s2.finishedAt !== null);
    // finished_at is kept by later calls.
    assertEquals((await finish(db, id, ids, true)).finishedAt, s2.finishedAt);
    assertEquals((await claim(db, id)).summary.finishedAt, s2.finishedAt);
  });
});

Deno.test('finish_list_send_batch: only rows that are sending are touched', async () => {
  await withDb(async (db) => {
    await join(db, 3);
    const id = newId();
    await create(db, id);
    const c = await claim(db, id, 1);
    const sending = c.recipients[0].subscriberId;
    const pending = (await rows(db, `select subscriber_id from public.list_send_recipients where state = 'pending' limit 1`))[0].subscriber_id;
    // A pending row named in the call is not moved, by ok or by failure.
    await finish(db, id, [pending], true);
    await finish(db, id, [pending], false);
    assertEquals(await states(db, id), { sending: 1, pending: 2 });
    // Once sent, a row is not moved back by a late failure, and not sent again by a repeat.
    await finish(db, id, [sending], true);
    await finish(db, id, [sending], false);
    assertEquals(await states(db, id), { sent: 1, pending: 2 });
    // An unknown id, an empty list and null change nothing.
    await finish(db, id, [newId()], true);
    await finish(db, id, [], true);
    assertEquals((await call(db, 'public.finish_list_send_batch($1::uuid, null, true)', id)).pending, 2);
    // Another send's rows are not touched.
    const other = newId();
    await create(db, other);
    const oc = await claim(db, other, 1);
    await finish(db, id, [oc.recipients[0].subscriberId], true);
    assertEquals(await states(db, other), { sending: 1, pending: 2 });
  });
});

Deno.test('finish_list_send_batch: a failed batch goes back to pending twice, then is failed after the third attempt', async () => {
  await withDb(async (db) => {
    await join(db, 2);
    const id = newId();
    await create(db, id);
    for (const attempt of [1, 2, 3]) {
      const c = await claim(db, id);
      assertEquals(c.recipients.length, 2, `attempt ${attempt}`);
      assertEquals((await rows(db, 'select min(attempts)::int as a, max(attempts)::int as b from public.list_send_recipients'))[0], { a: attempt, b: attempt });
      const s = await finish(db, id, c.recipients.map((r: Json) => r.subscriberId), false);
      if (attempt < 3) {
        assertEquals([s.pending, s.failed, s.finishedAt], [2, 0, null]);
      } else {
        assertEquals([s.pending, s.failed, s.sending], [0, 2, 0]);
        assert(s.finishedAt !== null);
      }
    }
    assertEquals((await claim(db, id)).recipients, []);
    assertEquals(await states(db, id), { failed: 2 });
  });
});

Deno.test('finish_list_send_batch: a batch can fail and then succeed; mixed outcomes are counted', async () => {
  await withDb(async (db) => {
    await join(db, 4);
    const id = newId();
    await create(db, id);
    const a = await claim(db, id, 2);
    await finish(db, id, a.recipients.map((r: Json) => r.subscriberId), false);
    const b = await claim(db, id, 4);
    // The failed pair is first in id order, so they are retried first, with 2 attempts; the others have 1.
    assertEquals(b.recipients.length, 4);
    const s = await finish(db, id, b.recipients.map((r: Json) => r.subscriberId), true);
    assertEquals([s.sent, s.total, s.failed, s.pending], [4, 4, 0, 0]);
    assertEquals((await rows(db, 'select count(*)::int as n from public.list_send_recipients where attempts = 2'))[0].n, 2);
  });
});

// ---------------------------------------------------------------------------
// The summary and the list.
// ---------------------------------------------------------------------------
Deno.test('list_list_sends_admin: newest first, at most 50, empty is []; each entry is the summary', async () => {
  await withDb(async (db) => {
    assertEquals(await call(db, 'public.list_list_sends_admin()'), []);
    await join(db, 2);
    const ids: string[] = [];
    for (let i = 0; i < 52; i++) {
      const id = newId();
      ids.push(id);
      await create(db, id, `Send ${i}`, 'b');
    }
    const list = await call(db, 'public.list_list_sends_admin()');
    assertEquals(list.length, 50);
    assertEquals(list[0].id, ids[51]);
    assertEquals(list[49].id, ids[2]);
    assertEquals(list[0], await summary(db, ids[51]));
    assertEquals(Object.keys(list[0]).sort(), ['body', 'createdAt', 'failed', 'finishedAt', 'id', 'pending', 'sending', 'sent', 'skipped', 'subject', 'total']);
  });
});

Deno.test('summary: the five states add up to the total whatever happens', async () => {
  await withDb(async (db) => {
    await join(db, 6);
    const id = newId();
    await create(db, id);
    // Opt out the last in claim order, so the first claims are not affected.
    const last = (await rows(db, `select s.email from public.list_send_recipients r join public.subscribers s on s.id = r.subscriber_id
      where r.send_id = $1 order by r.subscriber_id desc limit 1`, [id]))[0].email;
    await unsubscribe(db, { email: last });
    const a = await claim(db, id, 2);
    await finish(db, id, [a.recipients[0].subscriberId], true);
    await claim(db, id, 1);
    const s = await summary(db, id);
    assertEquals(s.sent + s.pending + s.sending + s.failed + s.skipped, s.total);
    assertEquals([s.total, s.sent, s.sending, s.pending, s.skipped], [6, 1, 2, 3, 0]);
    const rest = await claim(db, id, 100);
    assertEquals(rest.recipients.length, 2);
    const t = rest.summary;
    assertEquals(t.sent + t.pending + t.sending + t.failed + t.skipped, t.total);
    assertEquals([t.sent, t.sending, t.pending, t.skipped], [1, 4, 0, 1]);
  });
});

// ---------------------------------------------------------------------------
// RLS and grants.
// ---------------------------------------------------------------------------
const TABLES = ['list_sends', 'list_send_recipients'];
const FUNCTIONS = [
  'public.list_send_summary(uuid)',
  'public.list_send_close_if_done(uuid)',
  'public.create_list_send(uuid,text,text)',
  'public.claim_list_send_batch(uuid,integer)',
  'public.finish_list_send_batch(uuid,uuid[],boolean)',
  'public.list_list_sends_admin()',
];

Deno.test('RLS and grants: both tables have RLS and no policies; anon and authenticated can touch nothing', async () => {
  await withDb(async (db) => {
    await join(db, 1);
    const id = newId();
    await create(db, id);
    for (const t of TABLES) {
      assertEquals((await rows(db, `select relrowsecurity as rls from pg_class where oid = $1::regclass`, [`public.${t}`]))[0].rls, true, t);
      assertEquals((await rows(db, `select count(*)::int as n from pg_policies where tablename = $1`, [t]))[0].n, 0, t);
      for (const role of ['anon', 'authenticated']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          assertEquals((await rows(db, `select has_table_privilege($1, $2::regclass, $3) as ok`, [role, `public.${t}`, priv]))[0].ok, false, `${role} ${priv} ${t}`);
        }
      }
    }
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        for (const t of TABLES) await assertRejects(() => db.query(`select * from public.${t}`), Error, 'permission denied');
        await assertRejects(() => db.query(`delete from public.list_sends`), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.list_list_sends_admin()`), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.create_list_send($1::uuid, 's', 'b')`, [newId()]), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.claim_list_send_batch($1::uuid, 100)`, [id]), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.finish_list_send_batch($1::uuid, '{}'::uuid[], true)`, [id]), Error, 'permission denied');
        await assertRejects(() => db.query(`select public.list_send_summary($1::uuid)`, [id]), Error, 'permission denied');
      } finally {
        await db.exec('reset role');
      }
    }
    // service_role can use them all.
    await db.exec('set role service_role');
    try {
      assertEquals((await call(db, 'public.list_list_sends_admin()')).length, 1);
      assertEquals((await claim(db, id)).recipients.length, 1);
    } finally {
      await db.exec('reset role');
    }
  });
});

Deno.test('RLS and grants: every function is service_role only, and the list covers every function the migration creates', async () => {
  await withDb(async (db) => {
    for (const sig of FUNCTIONS) {
      for (const role of ['anon', 'authenticated']) {
        assertEquals((await rows(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]))[0].ok, false, `${role} ${sig}`);
      }
      assertEquals((await rows(db, `select has_function_privilege('service_role', $1, 'execute') as ok`, [sig]))[0].ok, true, sig);
    }
    const created = [...(await readMigration(LIST_SENDS_MIGRATION)).matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    const covered = new Set(FUNCTIONS.map((s) => s.slice('public.'.length, s.indexOf('('))));
    for (const name of created) assert(covered.has(name), `${name} has no grant check`);
    assertEquals(created.length, covered.size);
  });
});

// ---------------------------------------------------------------------------
// The migration itself.
// ---------------------------------------------------------------------------
Deno.test('migration: adds six functions and changes no existing one', async () => {
  const db = await after();
  const base = await functionsBefore!;
  const now = await functionDefs(db);
  const byName = new Map(now.map((f) => [f.sig as string, f]));
  for (const f of base) {
    const same = byName.get(f.sig);
    assert(same, `${f.sig} is gone`);
    assertEquals(same.acl, f.acl, `${f.sig} grants changed`);
    assertEquals(same.def, f.def, `${f.sig} changed`);
  }
  assertEquals(
    now.filter((f) => !base.some((b) => b.sig === f.sig)).map((f) => f.sig).sort(),
    [
      'claim_list_send_batch(uuid,integer)',
      'create_list_send(uuid,text,text)',
      'finish_list_send_batch(uuid,uuid[],boolean)',
      'list_list_sends_admin()',
      'list_send_close_if_done(uuid)',
      'list_send_summary(uuid)',
    ],
  );
});

Deno.test('migration: a second run changes nothing and keeps the data and the grants', async () => {
  await withDb(async (db) => {
    const sql = await readMigration(LIST_SENDS_MIGRATION);
    const dump = async () => ({
      columns: await rows(db, `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name in ('list_sends', 'list_send_recipients') order by table_name, ordinal_position`),
      indexes: await rows(db, `select indexname, indexdef from pg_indexes where tablename in ('list_sends', 'list_send_recipients') order by 1`),
      constraints: await rows(db, `select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid in ('public.list_sends'::regclass, 'public.list_send_recipients'::regclass) order by 1, 2`),
      rls: await rows(db, `select relname, relrowsecurity from pg_class where oid in ('public.list_sends'::regclass, 'public.list_send_recipients'::regclass) order by 1`),
      tableAcl: await rows(db, `select relname, relacl::text as acl from pg_class where oid in ('public.list_sends'::regclass, 'public.list_send_recipients'::regclass) order by 1`),
      functions: await functionDefs(db),
      sends: await rows(db, 'select to_jsonb(s) as r from public.list_sends s order by s.id'),
      recipients: await rows(db, 'select to_jsonb(r) as r from public.list_send_recipients r order by r.send_id, r.subscriber_id'),
    });
    await join(db, 4);
    const id = newId();
    await create(db, id);
    const c = await claim(db, id, 2);
    await finish(db, id, [c.recipients[0].subscriberId], true);
    const first = await dump();
    assertEquals(first.recipients.length, 4);
    await db.exec(sql);
    assertEquals(await dump(), first);
    await db.exec(sql);
    assertEquals(await dump(), first);
    // It still works afterwards, and the state is where it was left: one sent, one sending, two pending.
    assertEquals(await states(db, id), { sent: 1, sending: 1, pending: 2 });
    assertEquals((await create(db, id)).created, false);
    assertEquals((await claim(db, id)).recipients.length, 2);
  });
});

Deno.test('teardown', async () => {
  if (afterDb) await (await afterDb).close();
  if (beforeDb) await (await beforeDb).close();
});
