// HTTP tests for the routes that send an email to the mailing list (list_send_routes.ts), against the in-memory stores
// in dev.ts. The SQL functions they mirror are tested in supabase/tests/list_send.test.ts.
import { assert, assertEquals } from '@std/assert';
import { createApp } from './app.ts';
import { createMemoryDeps, memoryListSends } from './dev.ts';
import { createFakeMailer, type Mailer } from './mailer.ts';
import type { Deps, ListSendStore, ListSendSummary } from './types.ts';

const P = '/make-server-fbb8f0e1';
const JSON_H = { 'Content-Type': 'application/json' };
const ADMIN = { Authorization: 'Bearer admin', ...JSON_H };
const SITE = 'https://shop.example.com';
const newId = () => crypto.randomUUID();

const isAdmin: Deps['isAdmin'] = (h) =>
  Promise.resolve(h === 'Bearer admin' ? 'ok' : h === 'Bearer user' ? 'forbidden' : 'unauthenticated');

/** Memory stores with a fake mailer and a site address (email on), unless `on` is false. */
async function setup(on = true) {
  const mailer = createFakeMailer();
  const base = await createMemoryDeps(isAdmin);
  const deps: Deps = { ...base, mailer: on ? mailer : null, siteUrl: on ? SITE : null };
  return { app: createApp(deps), deps, mailer, base };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const send = (app: Ctx['app'], method: string, path: string, body?: unknown, headers: Record<string, string> = ADMIN) =>
  app.request(`${P}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const TEXT = { subject: 'New drop on Friday', body: 'Hi all,\n\nThe new range lands on Friday.' };

/** Adds `n` subscribers with an email (a.0@example.com ...) and returns their ids. */
async function join(ctx: Ctx, n: number, prefix = 'p'): Promise<string[]> {
  for (let i = 0; i < n; i++) {
    const r = await ctx.deps.community.subscribe({ email: `${prefix}${i}@example.com`, source: 'footer' }, 'consent');
    assert(r.ok);
  }
  return (await ctx.deps.community.listSubscribers()).filter((s) => s.email?.startsWith(prefix)).map((s) => s.id);
}
const subFor = async (ctx: Ctx, email: string) => (await ctx.deps.community.listSubscribers()).find((s) => s.email === email)!;
const put = async (ctx: Ctx, id: string = newId(), body: unknown = TEXT) => await send(ctx.app, 'PUT', `/admin/list-sends/${id}`, body);
const cont = async (ctx: Ctx, id: string) => await send(ctx.app, 'POST', `/admin/list-sends/${id}/continue`);
const contJson = async (ctx: Ctx, id: string): Promise<{ send: ListSendSummary; batchFailed: boolean }> => await (await cont(ctx, id)).json();

/** Calls continue until nothing is pending, as the screen does. */
async function runAll(ctx: Ctx, id: string, maxCalls = 50) {
  let last = await contJson(ctx, id);
  for (let i = 0; i < maxCalls && last.send.pending > 0; i++) last = await contJson(ctx, id);
  return last;
}

// ---------------------------------------------------------------------------------------------------------------
// Guard and switch
// ---------------------------------------------------------------------------------------------------------------
Deno.test('list sends: every route is 401 or 403 for a non-admin and touches no store and no mailer', async () => {
  const ctx = await setup();
  let calls = 0;
  const count = <T extends unknown[], R>(f: (...a: T) => R) => (...a: T): R => (calls++, f(...a));
  const counted: ListSendStore = {
    create: count(ctx.deps.listSends.create),
    claimBatch: count(ctx.deps.listSends.claimBatch),
    finishBatch: count(ctx.deps.listSends.finishBatch),
    listAdmin: count(ctx.deps.listSends.listAdmin),
  };
  const mailer: Mailer = {
    send: count(ctx.mailer.send),
    sendBatch: count(ctx.mailer.sendBatch),
  };
  const app = createApp({ ...ctx.deps, listSends: counted, mailer });
  const id = newId();
  const routes: [string, string, unknown?][] = [
    ['GET', '/admin/list-sends'],
    ['POST', '/admin/list-sends/test', { ...TEXT, to: 'a@example.com' }],
    ['PUT', `/admin/list-sends/${id}`, TEXT],
    ['POST', `/admin/list-sends/${id}/continue`],
  ];
  for (const [method, path, body] of routes) {
    for (const [headers, status] of [[JSON_H, 401], [{ Authorization: 'Bearer user', ...JSON_H }, 403]] as const) {
      const r = await send(app, method, path, body, headers);
      assertEquals(r.status, status, `${method} ${path}`);
    }
  }
  assertEquals(calls, 0);
  assertEquals(ctx.mailer.sent.length, 0);
});

Deno.test('list sends: GET lists the sends, newest first, with emailOn and no-store', async () => {
  const ctx = await setup();
  await join(ctx, 1);
  const a = newId();
  const b = newId();
  await put(ctx, a);
  await put(ctx, b);
  const r = await send(ctx.app, 'GET', '/admin/list-sends');
  assertEquals(r.status, 200);
  assertEquals(r.headers.get('Cache-Control'), 'no-store');
  const j = await r.json();
  assertEquals(j.emailOn, true);
  assertEquals(j.sends.map((s: ListSendSummary) => s.id), [b, a]);
});

Deno.test('list sends: emailOn needs both the mailer and the site address', async () => {
  const base = await createMemoryDeps(isAdmin);
  const mailer = createFakeMailer();
  for (const [m, s, on] of [[null, null, false], [mailer, null, false], [null, SITE, false], [mailer, SITE, true]] as const) {
    const app = createApp({ ...base, mailer: m, siteUrl: s });
    assertEquals((await (await send(app, 'GET', '/admin/list-sends')).json()).emailOn, on);
  }
});

Deno.test('list sends: with email off, test, create and continue are 503 email_off and nothing is stored or sent', async () => {
  const ctx = await setup(false);
  await join(ctx, 2);
  const id = newId();
  for (const [method, path, body] of [
    ['POST', '/admin/list-sends/test', { ...TEXT, to: 'a@example.com' }],
    ['PUT', `/admin/list-sends/${id}`, TEXT],
    ['POST', `/admin/list-sends/${id}/continue`],
  ] as [string, string, unknown?][]) {
    const r = await send(ctx.app, method, path, body);
    assertEquals(r.status, 503, path);
    assertEquals((await r.json()).code, 'email_off');
  }
  assertEquals(ctx.mailer.sent.length, 0);
  assertEquals(await ctx.deps.listSends.listAdmin(), []);
  // The list is still readable, and says email is off.
  assertEquals((await (await send(ctx.app, 'GET', '/admin/list-sends')).json()).emailOn, false);
});

Deno.test('list sends: a site address with a mailer but no SITE_URL is off too', async () => {
  const base = await createMemoryDeps(isAdmin);
  const mailer = createFakeMailer();
  const app = createApp({ ...base, mailer, siteUrl: null });
  assertEquals((await send(app, 'POST', '/admin/list-sends/test', { ...TEXT, to: 'a@example.com' })).status, 503);
  assertEquals((await send(app, 'PUT', `/admin/list-sends/${newId()}`, TEXT)).status, 503);
  assertEquals(mailer.sent.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// Test email
// ---------------------------------------------------------------------------------------------------------------
Deno.test('list sends: the test email goes to one address with the unsubscribe line and header', async () => {
  const ctx = await setup();
  const r = await send(ctx.app, 'POST', '/admin/list-sends/test', { ...TEXT, to: ' owner@example.com ' });
  assertEquals(r.status, 200);
  assertEquals(ctx.mailer.sent.length, 1);
  const m = ctx.mailer.sent[0];
  assertEquals(m.to, 'owner@example.com');
  assertEquals(m.subject, TEXT.subject);
  assertEquals(m.text, `${TEXT.body}\n\n--\nYou are getting this because you joined the 4Nguru list.\nTo stop, go to ${SITE}/unsubscribe`);
  assertEquals(m.headers, { 'List-Unsubscribe': `<${SITE}/unsubscribe>` });
});

Deno.test('list sends: the test email is validated', async () => {
  const ctx = await setup();
  const bad: unknown[] = [
    'text',
    {},
    { ...TEXT },
    { ...TEXT, to: 'nope' },
    { ...TEXT, to: 5 },
    { ...TEXT, to: 'a@example.com', subject: '  ' },
    { ...TEXT, to: 'a@example.com', subject: 'two\nlines' },
    { ...TEXT, to: 'a@example.com', subject: 'x'.repeat(151) },
    { ...TEXT, to: 'a@example.com', body: ' ' },
    { ...TEXT, to: 'a@example.com', body: 'x'.repeat(10001) },
  ];
  for (const b of bad) assertEquals((await send(ctx.app, 'POST', '/admin/list-sends/test', b)).status, 400, JSON.stringify(b)?.slice(0, 60));
  const r = await ctx.app.request(`${P}/admin/list-sends/test`, { method: 'POST', headers: ADMIN, body: '{' });
  assertEquals(r.status, 400);
  assertEquals(ctx.mailer.sent.length, 0);
});

Deno.test('list sends: a test email that fails is 502 send_failed and logs no address and no text', async () => {
  const ctx = await setup();
  ctx.mailer.failNext = 1;
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(' '));
  try {
    const r = await send(ctx.app, 'POST', '/admin/list-sends/test', { ...TEXT, to: 'owner@example.com' });
    assertEquals(r.status, 502);
    assertEquals(await r.json(), { error: 'The email could not be sent', code: 'send_failed' });
  } finally {
    console.error = orig;
  }
  assert(logged.length > 0);
  for (const line of logged) assert(!line.includes('owner@example.com') && !line.includes('new range') && !line.includes(TEXT.subject), line);
});

// ---------------------------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------------------------
Deno.test('list sends: create snapshots the list; opted-out and phone-only people are not in it', async () => {
  const ctx = await setup();
  await join(ctx, 3);
  await ctx.deps.community.subscribe({ phone: '0821234567', source: 'footer' }, 'consent');
  await ctx.deps.community.subscribe({ email: 'gone@example.com', source: 'footer' }, 'consent');
  await ctx.deps.community.unsubscribeContact({ email: 'gone@example.com' });
  const r = await put(ctx);
  assertEquals(r.status, 201);
  const s: ListSendSummary = await r.json();
  assertEquals([s.total, s.pending, s.sending, s.sent, s.failed, s.skipped], [3, 3, 0, 0, 0, 0]);
  assertEquals([s.subject, s.body, s.finishedAt], [TEXT.subject, TEXT.body, null]);
  // The mailer is not called by create.
  assertEquals(ctx.mailer.sent.length, 0);
});

Deno.test('list sends: someone who joins after create is not in that send', async () => {
  const ctx = await setup();
  await join(ctx, 2);
  const id = newId();
  await put(ctx, id);
  await join(ctx, 1, 'late');
  const last = await runAll(ctx, id);
  assertEquals(last.send.total, 2);
  assertEquals(ctx.mailer.sent.map((m) => m.to).sort(), ['p0@example.com', 'p1@example.com']);
});

Deno.test('list sends: a repeat id creates once and returns the first summary with 200', async () => {
  const ctx = await setup();
  await join(ctx, 2);
  const id = newId();
  const first = await put(ctx, id);
  assertEquals(first.status, 201);
  const a: ListSendSummary = await first.json();
  await join(ctx, 1, 'later');
  const second = await put(ctx, id.toUpperCase(), { subject: 'Other', body: 'Other text' });
  assertEquals(second.status, 200);
  assertEquals(await second.json(), a);
  assertEquals((await ctx.deps.listSends.listAdmin()).length, 1);
});

Deno.test('list sends: with nobody on the list the send is finished at once', async () => {
  const ctx = await setup();
  const r = await put(ctx);
  const s: ListSendSummary = await r.json();
  assertEquals([s.total, s.pending], [0, 0]);
  assert(s.finishedAt !== null);
  const c = await contJson(ctx, s.id);
  assertEquals(c.batchFailed, false);
  assertEquals(ctx.mailer.batchSizes, []);
});

Deno.test('list sends: create is validated; the id must be a UUID', async () => {
  const ctx = await setup();
  assertEquals((await send(ctx.app, 'PUT', '/admin/list-sends/not-a-uuid', TEXT)).status, 400);
  for (const b of ['x', {}, { subject: 'a' }, { body: 'a' }, { subject: ' ', body: 'a' }, { subject: 'a\r\nBcc: x', body: 'a' }, { subject: 'a', body: '  ' }, { subject: 5, body: 'a' }, { subject: 'x'.repeat(151), body: 'a' }, { subject: 'a', body: 'x'.repeat(10001) }]) {
    assertEquals((await put(ctx, newId(), b)).status, 400, JSON.stringify(b).slice(0, 60));
  }
  const r = await ctx.app.request(`${P}/admin/list-sends/${newId()}`, { method: 'PUT', headers: ADMIN, body: '{' });
  assertEquals(r.status, 400);
  // The limits themselves are fine, and the text is stored trimmed.
  const ok = await put(ctx, newId(), { subject: `  ${'x'.repeat(150)}  `, body: `\n${'y'.repeat(10000)}\n` });
  assertEquals(ok.status, 201);
  const s: ListSendSummary = await ok.json();
  assertEquals([s.subject.length, s.body.length], [150, 10000]);
  assertEquals((await ctx.deps.listSends.listAdmin()).length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// Continue
// ---------------------------------------------------------------------------------------------------------------
Deno.test('list sends: continue sends one email per person and finishes', async () => {
  const ctx = await setup();
  await join(ctx, 3);
  const id = newId();
  await put(ctx, id);
  const c = await contJson(ctx, id);
  assertEquals(c.batchFailed, false);
  assertEquals([c.send.sent, c.send.pending, c.send.sending, c.send.total], [3, 0, 0, 3]);
  assert(c.send.finishedAt !== null);
  assertEquals(ctx.mailer.sent.map((m) => m.to).sort(), ['p0@example.com', 'p1@example.com', 'p2@example.com']);
  assertEquals(ctx.mailer.batchSizes, [3]);
  // A further call sends nothing and does not call the mailer.
  const again = await contJson(ctx, id);
  assertEquals(again.batchFailed, false);
  assertEquals(again.send.sent, 3);
  assertEquals(ctx.mailer.batchSizes, [3]);
  assertEquals(ctx.mailer.sent.length, 3);
  const listed = (await (await send(ctx.app, 'GET', '/admin/list-sends')).json()).sends[0];
  assertEquals(listed.sent, 3);
});

Deno.test('list sends: every email has the unsubscribe line and header, and no address in the link', async () => {
  const ctx = await setup();
  await join(ctx, 4);
  const id = newId();
  await put(ctx, id);
  await runAll(ctx, id);
  assertEquals(ctx.mailer.sent.length, 4);
  for (const m of ctx.mailer.sent) {
    assertEquals(m.subject, TEXT.subject);
    assertEquals(m.text, `${TEXT.body}\n\n--\nYou are getting this because you joined the 4Nguru list.\nTo stop, go to ${SITE}/unsubscribe`);
    assertEquals(m.headers, { 'List-Unsubscribe': `<${SITE}/unsubscribe>` });
    assert(!m.text.includes('@') && !m.headers!['List-Unsubscribe'].includes('@'));
  }
});

Deno.test('list sends: continue on an unknown or malformed id is 404 and sends nothing', async () => {
  const ctx = await setup();
  await join(ctx, 1);
  assertEquals((await cont(ctx, newId())).status, 404);
  assertEquals((await cont(ctx, 'nope')).status, 404);
  assertEquals(ctx.mailer.sent.length, 0);
});

Deno.test('list sends: a person who opts out after create is skipped', async () => {
  const ctx = await setup();
  await join(ctx, 3);
  const id = newId();
  await put(ctx, id);
  await ctx.deps.community.unsubscribeContact({ email: 'p1@example.com' });
  const last = await runAll(ctx, id);
  assertEquals([last.send.sent, last.send.skipped, last.send.pending], [2, 1, 0]);
  assert(last.send.finishedAt !== null);
  assertEquals(ctx.mailer.sent.map((m) => m.to).sort(), ['p0@example.com', 'p2@example.com']);
});

Deno.test('list sends: a person who opts out between two batches gets nothing from the second', async () => {
  const ctx = await setup();
  await join(ctx, 150);
  const id = newId();
  await put(ctx, id);
  const first = await contJson(ctx, id);
  assertEquals(first.send.sent, 100);
  const sentTo = new Set(ctx.mailer.sent.map((m) => m.to));
  // Opt out two of the 50 still waiting.
  const waiting = (await ctx.deps.community.listSubscribers()).filter((s) => !sentTo.has(s.email!));
  assertEquals(waiting.length, 50);
  for (const s of waiting.slice(0, 2)) await ctx.deps.community.unsubscribe(s.id);
  const optedOut = new Set(waiting.slice(0, 2).map((s) => s.email));
  const last = await runAll(ctx, id);
  assertEquals([last.send.sent, last.send.skipped, last.send.pending], [148, 2, 0]);
  for (const m of ctx.mailer.sent) assert(!optedOut.has(m.to), m.to);
  assertEquals(new Set(ctx.mailer.sent.map((m) => m.to)).size, 148);
});

Deno.test('list sends: 250 people go in batches of 100, 100 and 50, each once', async () => {
  const ctx = await setup();
  await join(ctx, 250);
  const id = newId();
  await put(ctx, id);
  const sizes: number[] = [];
  let last = await contJson(ctx, id);
  sizes.push(last.send.sent);
  while (last.send.pending > 0) {
    last = await contJson(ctx, id);
    sizes.push(last.send.sent);
  }
  assertEquals(sizes, [100, 200, 250]);
  assertEquals(ctx.mailer.batchSizes, [100, 100, 50]);
  assertEquals(new Set(ctx.mailer.sent.map((m) => m.to)).size, 250);
  assertEquals(ctx.mailer.sent.length, 250);
  assert(last.send.finishedAt !== null);
});

Deno.test('list sends: a failed batch goes back to pending and is retried, then sent', async () => {
  const ctx = await setup();
  await join(ctx, 2);
  const id = newId();
  await put(ctx, id);
  ctx.mailer.failNext = 1;
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(' '));
  try {
    const first = await cont(ctx, id);
    assertEquals(first.status, 200);
    const a = await first.json();
    assertEquals(a.batchFailed, true);
    assertEquals([a.send.pending, a.send.sending, a.send.sent, a.send.failed], [2, 0, 0, 0]);
    assertEquals(a.send.finishedAt, null);
  } finally {
    console.error = orig;
  }
  for (const line of logged) assert(!line.includes('@example.com') && !line.includes('new range'), line);
  assertEquals(ctx.mailer.sent.length, 0);
  const b = await contJson(ctx, id);
  assertEquals(b.batchFailed, false);
  assertEquals([b.send.sent, b.send.pending], [2, 0]);
  assertEquals(ctx.mailer.sent.length, 2);
});

Deno.test('list sends: a batch that fails three times is failed and not tried again', async () => {
  const ctx = await setup();
  await join(ctx, 2);
  const id = newId();
  await put(ctx, id);
  ctx.mailer.failNext = 10;
  const orig = console.error;
  console.error = () => {};
  try {
    const a = await contJson(ctx, id);
    const b = await contJson(ctx, id);
    assertEquals([a.send.pending, b.send.pending, a.batchFailed, b.batchFailed], [2, 2, true, true]);
    const c = await contJson(ctx, id);
    assertEquals(c.batchFailed, true);
    assertEquals([c.send.failed, c.send.pending, c.send.sending, c.send.sent], [2, 0, 0, 0]);
    assert(c.send.finishedAt !== null);
    // Done: another call does not touch the mailer.
    const before = ctx.mailer.batchSizes.length;
    const d = await contJson(ctx, id);
    assertEquals(d.batchFailed, false);
    assertEquals(ctx.mailer.batchSizes.length, before);
  } finally {
    console.error = orig;
  }
  assertEquals(ctx.mailer.batchSizes, [2, 2, 2]);
  assertEquals(ctx.mailer.sent.length, 0);
});

Deno.test('list sends: a mailer that throws still settles the batch (never left sending)', async () => {
  const ctx = await setup();
  await join(ctx, 2);
  const boom: Mailer = {
    send: () => Promise.reject(new Error('down')),
    sendBatch: () => Promise.reject(new Error('down')),
  };
  const app = createApp({ ...ctx.deps, mailer: boom });
  const id = newId();
  await send(app, 'PUT', `/admin/list-sends/${id}`, TEXT);
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await send(app, 'POST', `/admin/list-sends/${id}/continue`);
    const j = await r.json();
    assertEquals([j.batchFailed, j.send.sending, j.send.pending], [true, 0, 2]);
  } finally {
    console.error = orig;
  }
});

Deno.test('list sends: the address is read when the batch is claimed, not when the send is created', async () => {
  // The recipient row holds the subscriber id. The stores have no address edit, so the list the send reads from is
  // a plain array that the test changes between create and claim.
  const sub = { id: newId(), name: null, phone: null, email: 'old@example.com', source: 'footer' as const, consentAt: '', unsubscribedAt: null, createdAt: '' };
  const subs = [sub];
  const store = memoryListSends(undefined, undefined, () => Promise.resolve(subs));
  const id = newId();
  await store.create(id, TEXT);
  subs[0] = { ...sub, email: 'new@example.com' };
  const c = await store.claimBatch(id);
  assertEquals(c!.recipients, [{ subscriberId: sub.id, email: 'new@example.com' }]);
});

Deno.test('list sends: a row left sending is never claimed again', async () => {
  const ctx = await setup();
  await join(ctx, 3);
  const id = newId();
  await put(ctx, id);
  // A claim whose process died before it finished.
  const crashed = await ctx.deps.listSends.claimBatch(id, 2);
  assertEquals(crashed!.recipients.length, 2);
  const last = await runAll(ctx, id);
  assertEquals([last.send.sent, last.send.sending, last.send.pending], [1, 2, 0]);
  assertEquals(last.send.finishedAt, null);
  const crashedTo = new Set(crashed!.recipients.map((r) => r.email));
  for (const m of ctx.mailer.sent) assert(!crashedTo.has(m.to), m.to);
  assertEquals(ctx.mailer.sent.length, 1);
});

Deno.test('list sends: /config is unchanged', async () => {
  const ctx = await setup();
  assertEquals(await (await ctx.app.request(`${P}/config`)).json(), { onlinePayments: false });
});
