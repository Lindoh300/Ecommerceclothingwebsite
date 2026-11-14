// Tests for the "Your fit, here" wall: the sync (fit_sync.ts), its routes (fit_routes.ts), the in-memory store in
// dev.ts and the Instagram boundary (instagram.ts, against a stubbed fetch). The SQL functions the store mirrors are
// tested in supabase/tests/fit_photos.test.ts.
import { assert, assertEquals, assertFalse } from '@std/assert';
import { createApp } from './app.ts';
import { createMemoryDeps } from './dev.ts';
import { createFakeInstagram, fakeImageUrl, instagramTime, sampleTagged } from './fake_instagram.ts';
import { FIT_ADMIN_MIN_AGE, FIT_PUBLIC_MIN_AGE, FIT_WALL_SIZE, parseInstagramTime, syncFits } from './fit_sync.ts';
import {
  createInstagramProvider,
  isInstagramImageUrl,
  loadInstagramProvider,
  MAX_IMAGE_BYTES,
} from './instagram.ts';
import type { AdminFitPhoto, Deps, FitPhoto, FitSyncStatus, TaggedMedia } from './types.ts';

const P = '/make-server-fbb8f0e1';
const ADMIN = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };
const USER = { Authorization: 'Bearer user' };
const MINUTE = 60_000;

const isAdmin: Deps['isAdmin'] = (h) =>
  Promise.resolve(h === 'Bearer admin' ? 'ok' : h === 'Bearer user' ? 'forbidden' : 'unauthenticated');

interface Options {
  /** false = Instagram off (no secrets). */
  on?: boolean;
  media?: TaggedMedia[];
}

async function setup(opts: Options = {}) {
  const clock = { now: Date.parse('2026-11-01T12:00:00Z') };
  const fake = createFakeInstagram(opts.media ?? sampleTagged());
  const base = await createMemoryDeps(isAdmin, false, null, () => clock.now, opts.on === false ? null : fake);
  const stored: string[] = [];
  const removed: string[] = [];
  const tasks: Promise<unknown>[] = [];
  const deps: Deps = {
    ...base,
    storeFitImage: (path) => {
      stored.push(path);
      return Promise.resolve(`https://img.example/${path}`);
    },
    removeFitImage: (path) => {
      removed.push(path);
      return Promise.resolve();
    },
    background: (task) => {
      tasks.push(task);
    },
  };
  const app = createApp(deps);
  const req = (method: string, path: string, headers: Record<string, string> = ADMIN) =>
    app.request(`${P}${path}`, { method, headers });
  return {
    clock,
    fake,
    deps,
    app,
    stored,
    removed,
    /** Waits for every background sync started so far. */
    settle: async () => {
      await Promise.all(tasks.splice(0));
    },
    wall: async (): Promise<FitPhoto[]> => await (await req('GET', '/fits', {})).json(),
    admin: async (): Promise<{ enabled: boolean; photos: Omit<AdminFitPhoto, 'path'>[]; status: FitSyncStatus }> =>
      await (await req('GET', '/admin/fits')).json(),
    sync: async () => await (await req('POST', '/admin/fits/sync')).json() as { result: string },
    req,
  };
}

const ids = (photos: { id: string }[]) => photos.map((p) => p.id);
const SAMPLE = sampleTagged();
/** The seven photo posts in the samples (the third is a video), newest first. */
const PHOTO_IDS = SAMPLE.filter((m) => m.mediaType !== 'VIDEO').map((m) => m.id);
const VIDEO_ID = SAMPLE[2].id;

const postId = (n: number) => String(18_000_000_000_000_000n + BigInt(n)); // past 2^53, so a BigInt
const post = (n: number, over: Partial<TaggedMedia> = {}): TaggedMedia => ({
  id: postId(n),
  mediaType: 'IMAGE',
  mediaUrl: fakeImageUrl(postId(n)),
  username: `newer.fit${n}`,
  permalink: `https://www.instagram.com/p/newer${n}/`,
  timestamp: instagramTime(Date.parse('2026-11-01T00:00:00Z') + n * 3_600_000),
  ...over,
});

// --- Off ------------------------------------------------------------------------------------------------------

Deno.test('fits off: the wall is [], nothing is called, Sync now is 503 and the admin says disabled', async () => {
  const t = await setup({ on: false });
  let calls = 0;
  const counted = new Proxy(t.deps.fits, {
    get: (target, prop, receiver) => {
      calls++;
      return Reflect.get(target, prop, receiver);
    },
  });
  const deps = { ...t.deps, fits: counted, background: () => calls++, storeFitImage: () => (calls++, Promise.resolve('')) };
  const app = createApp(deps);
  const r = await app.request(`${P}/fits`);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), []);
  assertEquals(calls, 0);
  assertEquals(await syncFits(deps, 0), 'off');
  assertEquals(calls, 0);

  const sync = await t.req('POST', '/admin/fits/sync');
  assertEquals(sync.status, 503);
  assertEquals((await sync.json()).code, 'instagram_off');
  const admin = await t.admin();
  assertEquals(admin.enabled, false);
  assertEquals(admin.photos, []);
  assertEquals(t.fake.listCalls, 0);
});

// --- The wall ---------------------------------------------------------------------------------------------------

Deno.test('fits: a visit starts a background sync; the wall is the newest 6 photo posts, newest first', async () => {
  const t = await setup();
  assertEquals(await t.wall(), []); // the first visit answers with what is stored: nothing yet
  await t.settle();
  const wall = await t.wall();
  assertEquals(wall.length, FIT_WALL_SIZE);
  assertEquals(ids(wall), PHOTO_IDS.slice(0, FIT_WALL_SIZE));
  assertEquals(wall[0], {
    id: PHOTO_IDS[0],
    image: `https://img.example/fits/${PHOTO_IDS[0]}.jpg`,
    username: 'sample.fit1',
    permalink: 'https://www.instagram.com/p/sample1/',
    postedAt: '2026-10-31T12:00:00.000Z',
  });
  assertEquals(t.stored.length, FIT_WALL_SIZE);
  assertEquals((await t.admin()).status, { lastOkAt: new Date(t.clock.now).toISOString(), lastError: '' });
});

Deno.test('fits: videos and reels are skipped, and so is a post with no picture or an unreadable time', async () => {
  const t = await setup({
    media: [
      post(1, { mediaType: 'VIDEO' }),
      post(2, { mediaType: 'REELS' }),
      post(3, { mediaUrl: null }),
      post(4, { timestamp: 'yesterday' }),
      post(5, { mediaType: 'CAROUSEL_ALBUM' }),
      post(6),
    ],
  });
  assertEquals(await t.sync(), { result: 'ok' });
  assertEquals(ids(await t.wall()), [post(6).id, post(5).id]);
  assertFalse(t.fake.downloads.some((u) => u.includes(VIDEO_ID)));
  assertEquals(t.fake.downloads.length, 2);
});

Deno.test('fits: a tie on time goes to the larger id first', async () => {
  const same = '2026-11-01T09:00:00+0000';
  const t = await setup({ media: [post(1, { timestamp: same }), post(3, { timestamp: same }), post(2, { timestamp: same })] });
  await t.sync();
  assertEquals(ids(await t.wall()), [post(3).id, post(2).id, post(1).id]);
});

Deno.test('fits: a post without a numeric id, a username or a link is not put on the wall', async () => {
  const t = await setup({
    media: [
      post(1, { id: '../../etc' }),
      post(2, { username: '' }),
      post(3, { permalink: '' }),
      post(4),
    ],
  });
  await t.sync();
  assertEquals(ids(await t.wall()), [post(4).id]);
  assertEquals(t.stored, [`fits/${post(4).id}.jpg`]);
});

Deno.test('fits: a seventh, newer post pushes the oldest off the wall and its file is removed', async () => {
  const t = await setup();
  await t.sync();
  const oldest = PHOTO_IDS[FIT_WALL_SIZE - 1];
  assert(ids(await t.wall()).includes(oldest));
  t.stored.length = 0;
  const newer = post(1, { timestamp: instagramTime(Date.parse('2026-11-01T11:00:00Z')) });
  t.fake.setMedia([newer, ...SAMPLE]);
  assertEquals(await t.sync(), { result: 'ok' });
  const wall = await t.wall();
  assertEquals(ids(wall), [newer.id, ...PHOTO_IDS.slice(0, FIT_WALL_SIZE - 1)]);
  assertEquals(wall.length, FIT_WALL_SIZE);
  assertEquals(t.removed, [`fits/${oldest}.jpg`]);
  assertEquals(t.stored, [`fits/${newer.id}.jpg`]); // photos already on the wall are not downloaded again
  assertFalse((await t.admin()).photos.some((p) => p.id === oldest));
});

Deno.test('fits: a deleted or untagged post leaves the wall, and the next post fills the place', async () => {
  const t = await setup();
  await t.sync();
  const gone = PHOTO_IDS[1];
  t.fake.setMedia(SAMPLE.filter((m) => m.id !== gone));
  assertEquals(await t.sync(), { result: 'ok' });
  assertEquals(ids(await t.wall()), [PHOTO_IDS[0], ...PHOTO_IDS.slice(2, 7)]);
  assert(t.removed.includes(`fits/${gone}.jpg`));
});

Deno.test('fits: a file that cannot be removed does not fail the sync', async () => {
  const t = await setup();
  await t.sync();
  const deps = { ...t.deps, removeFitImage: () => Promise.reject(new Error('storage down')) };
  t.fake.setMedia(SAMPLE.slice(0, 1));
  assertEquals(await syncFits(deps, 0), 'ok');
  assertEquals(ids(await t.wall()), [PHOTO_IDS[0]]);
});

Deno.test('fits: a failed image is skipped, the next post fills the slot, and the status says image_failed', async () => {
  const t = await setup();
  t.fake.failDownloads([PHOTO_IDS[2]]);
  assertEquals(await t.sync(), { result: 'failed' });
  const wall = await t.wall();
  assertEquals(ids(wall), [...PHOTO_IDS.slice(0, 2), ...PHOTO_IDS.slice(3, 7)]);
  assertEquals(wall.length, FIT_WALL_SIZE);
  assertEquals((await t.admin()).status.lastError, 'image_failed');
  // Next time it works and the status is clean again.
  t.fake.failDownloads([]);
  assertEquals(await t.sync(), { result: 'ok' });
  assertEquals((await t.admin()).status.lastError, '');
  assertEquals(ids(await t.wall()), PHOTO_IDS.slice(0, FIT_WALL_SIZE));
});

Deno.test('fits: a file stored for a photo whose row could not be saved is removed again', async () => {
  const t = await setup({ media: [post(1)] });
  const deps = { ...t.deps, fits: { ...t.deps.fits, upsert: () => Promise.reject(new Error('db down')) } };
  assertEquals(await syncFits(deps, 0), 'failed');
  assertEquals(t.removed, [`fits/${post(1).id}.jpg`]);
  assertEquals((await t.deps.fits.status()).lastError, 'image_failed');
});

Deno.test('fits: an Instagram failure leaves the wall alone and records fetch_failed', async () => {
  const t = await setup();
  await t.sync();
  const before = await t.wall();
  t.removed.length = 0;
  t.stored.length = 0;
  t.fake.failList(new Error('HTTP 500'));
  assertEquals(await t.sync(), { result: 'failed' });
  assertEquals(await t.wall(), before);
  assertEquals(t.removed, []);
  assertEquals(t.stored, []);
  const { status } = await t.admin();
  assertEquals(status.lastError, 'fetch_failed');
  assertEquals(status.lastOkAt, new Date(t.clock.now).toISOString()); // the earlier success is still the last one
  t.fake.failList(null);
  assertEquals(await t.sync(), { result: 'ok' });
  assertEquals((await t.admin()).status.lastError, '');
});

Deno.test('fits: an unexpected failure records sync_failed and returns failed', async () => {
  const t = await setup();
  const deps = { ...t.deps, fits: { ...t.deps.fits, listAdmin: () => Promise.reject(new Error('boom')) } };
  assertEquals(await syncFits(deps, 0), 'failed');
  assertEquals((await t.deps.fits.status()).lastError, 'sync_failed');
});

Deno.test('fits: the log has codes only, never a username, a URL or the token in an error', async () => {
  const t = await setup();
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  try {
    t.fake.failList(new Error('request to https://graph.facebook.com/1/tags?access_token=SECRET-TOKEN failed'));
    await t.sync();
    t.fake.failList(null);
    t.fake.failDownloads([PHOTO_IDS[0]]);
    await t.sync();
  } finally {
    console.error = original;
  }
  assert(logged.length >= 2);
  const all = logged.join('\n');
  for (const secret of ['SECRET-TOKEN', 'graph.facebook', 'sample.fit', 'instagram.com', 'cdninstagram']) {
    assertFalse(all.includes(secret), secret);
  }
});

Deno.test('fits: a claim stops a second public sync within 15 minutes; Sync now and the next quarter hour run', async () => {
  const t = await setup();
  assertEquals(await syncFits(t.deps, FIT_PUBLIC_MIN_AGE), 'ok');
  assertEquals(t.fake.listCalls, 1);
  t.clock.now += 14 * MINUTE;
  assertEquals(await syncFits(t.deps, FIT_PUBLIC_MIN_AGE), 'skipped');
  assertEquals(t.fake.listCalls, 1);
  // Visits go through the route the same way.
  await t.wall();
  await t.settle();
  assertEquals(t.fake.listCalls, 1);
  // The owner's button and hide or show ignore the age.
  assertEquals(await t.sync(), { result: 'ok' });
  assertEquals(t.fake.listCalls, 2);
  t.clock.now += 15 * MINUTE;
  assertEquals(await syncFits(t.deps, FIT_PUBLIC_MIN_AGE), 'ok');
  assertEquals(t.fake.listCalls, 3);
});

Deno.test('fits: a failed sync still counts as an attempt, so a broken Instagram is not hammered', async () => {
  const t = await setup();
  t.fake.failList(new Error('down'));
  assertEquals(await syncFits(t.deps, FIT_PUBLIC_MIN_AGE), 'failed');
  assertEquals(await syncFits(t.deps, FIT_PUBLIC_MIN_AGE), 'skipped');
  assertEquals(t.fake.listCalls, 1);
});

Deno.test('fits: a background sync that rejects does not break the visit', async () => {
  const t = await setup();
  const boom = { ...t.deps, fits: { ...t.deps.fits, claimSync: () => Promise.reject(new Error('db down')) } };
  const tasks: Promise<unknown>[] = [];
  const app = createApp({ ...boom, background: (p) => void tasks.push(p) });
  const r = await app.request(`${P}/fits`);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), []);
  assertEquals(await Promise.all(tasks), ['failed']);
});

// --- Admin routes ---------------------------------------------------------------------------------------------

Deno.test('fits admin: every admin route is 401 without a session and 403 for a user who is not an admin', async () => {
  const t = await setup();
  const routes: [string, string][] = [
    ['GET', '/admin/fits'],
    ['POST', '/admin/fits/sync'],
    ['POST', '/admin/fits/123/hide'],
    ['POST', '/admin/fits/123/show'],
  ];
  for (const [method, path] of routes) {
    assertEquals((await t.req(method, path, {})).status, 401, `${method} ${path}`);
    assertEquals((await t.req(method, path, USER)).status, 403, `${method} ${path}`);
  }
  assertEquals(t.fake.listCalls, 0);
});

Deno.test('fits admin: the list has the hidden flag and the status, and never the storage path', async () => {
  const t = await setup();
  await t.sync();
  const r = await t.req('GET', '/admin/fits');
  assertEquals(r.headers.get('cache-control'), 'no-store');
  const body = await r.json();
  assertEquals(body.enabled, true);
  assertEquals(body.photos.length, FIT_WALL_SIZE);
  for (const p of body.photos) {
    assertEquals(Object.keys(p).sort(), ['hidden', 'id', 'image', 'permalink', 'postedAt', 'username']);
  }
  assertFalse(JSON.stringify(body).includes('"path"'));
});

Deno.test('fits admin: a bad id is 400 on hide and show', async () => {
  const t = await setup();
  for (const id of ['abc', '12a', '1e5', '1.5', 'x'.repeat(5), '1'.repeat(41), '%20']) {
    assertEquals((await t.req('POST', `/admin/fits/${id}/hide`)).status, 400, id);
    assertEquals((await t.req('POST', `/admin/fits/${id}/show`)).status, 400, id);
  }
});

Deno.test('fits admin: hiding an unknown photo is 404 and nothing is removed', async () => {
  const t = await setup();
  await t.sync();
  t.removed.length = 0;
  const r = await t.req('POST', '/admin/fits/99999/hide');
  assertEquals(r.status, 404);
  assertEquals(t.removed, []);
  assertEquals((await t.wall()).length, FIT_WALL_SIZE);
});

Deno.test('fits admin: a hidden photo never comes back, its file goes and the next post fills the gap', async () => {
  const t = await setup();
  await t.sync();
  const hidden = PHOTO_IDS[1];
  t.removed.length = 0;
  const r = await t.req('POST', `/admin/fits/${hidden}/hide`);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { ok: true });
  assertEquals(t.removed, [`fits/${hidden}.jpg`]);
  await t.settle(); // the sync the hide started
  const wall = await t.wall();
  assertEquals(ids(wall), [PHOTO_IDS[0], ...PHOTO_IDS.slice(2, 7)]);
  assertEquals(wall.length, FIT_WALL_SIZE);
  // Several more syncs, still tagged on Instagram, still gone.
  await t.sync();
  await t.sync();
  assertFalse(ids(await t.wall()).includes(hidden));
  const row = (await t.admin()).photos.find((p) => p.id === hidden);
  assertEquals(row?.hidden, true);
  assertEquals(row?.image, '');
  // The hidden post is not downloaded again.
  assertEquals(t.stored.filter((p) => p === `fits/${hidden}.jpg`).length, 1);
});

Deno.test('fits admin: show deletes the hidden row so the next sync may bring the photo back', async () => {
  const t = await setup();
  await t.sync();
  const id = PHOTO_IDS[0];
  await t.req('POST', `/admin/fits/${id}/hide`);
  await t.settle();
  assertFalse(ids(await t.wall()).includes(id));
  const r = await t.req('POST', `/admin/fits/${id}/show`);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { ok: true });
  assertFalse((await t.admin()).photos.some((p) => p.id === id && p.hidden));
  await t.settle(); // the sync that show started
  assertEquals(ids(await t.wall()), PHOTO_IDS.slice(0, FIT_WALL_SIZE));
});

Deno.test('fits admin: show on a photo that is not hidden changes nothing', async () => {
  const t = await setup();
  await t.sync();
  const before = await t.wall();
  t.removed.length = 0;
  assertEquals((await t.req('POST', `/admin/fits/${PHOTO_IDS[0]}/show`)).status, 200);
  await t.settle();
  assertEquals(await t.wall(), before);
  assertEquals(t.removed, []);
});

Deno.test('fits admin: hide still works when the file cannot be removed', async () => {
  const t = await setup();
  await t.sync();
  const app = createApp({ ...t.deps, removeFitImage: () => Promise.reject(new Error('storage down')) });
  const r = await app.request(`${P}/admin/fits/${PHOTO_IDS[0]}/hide`, { method: 'POST', headers: ADMIN });
  assertEquals(r.status, 200);
  assertFalse(ids(await t.wall()).includes(PHOTO_IDS[0]));
});

Deno.test('fits admin: Sync now with Instagram down answers failed, not an error', async () => {
  const t = await setup();
  t.fake.failList(new Error('down'));
  const r = await t.req('POST', '/admin/fits/sync');
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { result: 'failed' });
  assertEquals(FIT_ADMIN_MIN_AGE, 0);
});

// --- The in-memory store (mirrors the SQL functions) ------------------------------------------------------------

Deno.test('memory fits: hide blanks the image and path, keeps the row, and upsert leaves it alone', async () => {
  const t = await setup({ on: false });
  const { fits } = t.deps;
  const photo = { id: '5', image: 'https://x/5.jpg', path: 'fits/5.jpg', username: 'a', permalink: 'https://p', postedAt: '2026-11-01T00:00:00.000Z' };
  assertEquals(await fits.upsert(photo), true);
  assertEquals(await fits.hide('5'), { found: true, path: 'fits/5.jpg' });
  assertEquals(await fits.hide('5'), { found: true, path: '' });
  assertEquals(await fits.hide('6'), { found: false, path: '' });
  assertEquals(await fits.upsert(photo), false);
  assertEquals(await fits.listPublic(), []);
  assertEquals((await fits.listAdmin())[0], { ...photo, image: '', path: '', hidden: true });
  assertEquals(await fits.remove('5'), true);
  assertEquals(await fits.remove('5'), false);
  assertEquals(await fits.upsert(photo), true);
});

Deno.test('memory fits: the public list is the newest 6 with a picture; the admin list has every row', async () => {
  const t = await setup({ on: false });
  const { fits } = t.deps;
  for (let i = 1; i <= 8; i++) {
    await fits.upsert({
      id: String(i),
      image: i === 8 ? '' : `https://x/${i}.jpg`,
      path: `fits/${i}.jpg`,
      username: 'a',
      permalink: 'https://p',
      postedAt: new Date(Date.parse('2026-11-01T00:00:00Z') + i * 1000).toISOString(),
    });
  }
  assertEquals(ids(await fits.listPublic()), ['7', '6', '5', '4', '3', '2']);
  assertEquals((await fits.listAdmin()).length, 8);
  assertEquals((await fits.status()), { lastOkAt: null, lastError: '' });
});

// --- The Instagram boundary -------------------------------------------------------------------------------------

const TOKEN = 'EAAB-secret-token-123';

interface Call {
  url: string;
  init?: RequestInit;
}

function stub(respond: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(respond(url));
  };
  return { calls, fetchImpl, provider: createInstagramProvider(TOKEN, '1784', fetchImpl) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const GOOD_URL = 'https://scontent-jnb1-1.cdninstagram.com/v/t51/photo.jpg?x=1';
const image = (bytes: number, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'image/jpeg', ...headers } });

async function rejection(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected a rejection');
}

Deno.test('instagram: loadInstagramProvider is null unless both values are set and not blank', () => {
  assertEquals(loadInstagramProvider(undefined, undefined), null);
  assertEquals(loadInstagramProvider('token', undefined), null);
  assertEquals(loadInstagramProvider(undefined, '123'), null);
  assertEquals(loadInstagramProvider('', '123'), null);
  assertEquals(loadInstagramProvider('token', '   '), null);
  assertEquals(loadInstagramProvider('  ', '123'), null);
  assert(loadInstagramProvider(' token ', ' 123 ') !== null);
});

Deno.test('instagram: listTagged asks the Graph API for the tags, first page only, and maps the answer', async () => {
  const s = stub(() =>
    json({
      data: [
        { id: '1', media_type: 'IMAGE', media_url: 'https://x/1.jpg', permalink: 'https://p/1', timestamp: '2026-11-01T10:00:00+0000', username: 'u1' },
        { id: '2', media_type: 'VIDEO', permalink: 'https://p/2', timestamp: '2026-11-01T09:00:00+0000', username: 'u2' },
        { media_type: 'IMAGE' },
      ],
      paging: { next: 'https://graph.facebook.com/next' },
    })
  );
  const media = await s.provider.listTagged(25);
  assertEquals(s.calls.length, 1);
  const url = new URL(s.calls[0].url);
  assertEquals(url.origin + url.pathname, 'https://graph.facebook.com/1784/tags');
  assertEquals(url.searchParams.get('fields'), 'id,media_type,media_url,permalink,timestamp,username');
  assertEquals(url.searchParams.get('limit'), '25');
  assertEquals(url.searchParams.get('access_token'), TOKEN);
  assert(s.calls[0].init?.signal instanceof AbortSignal);
  assertEquals(media, [
    { id: '1', mediaType: 'IMAGE', mediaUrl: 'https://x/1.jpg', username: 'u1', permalink: 'https://p/1', timestamp: '2026-11-01T10:00:00+0000' },
    { id: '2', mediaType: 'VIDEO', mediaUrl: null, username: 'u2', permalink: 'https://p/2', timestamp: '2026-11-01T09:00:00+0000' },
  ]);
});

Deno.test('instagram: listTagged throws on a non-200 with the status only, and never has the token or the URL', async () => {
  for (const status of [400, 401, 403, 429, 500, 302]) {
    const s = stub(() => new Response(JSON.stringify({ error: { message: `bad token ${TOKEN}` } }), { status }));
    const message = await rejection(s.provider.listTagged(25));
    assert(message.includes(String(status)), message);
    assertFalse(message.includes(TOKEN), message);
    assertFalse(message.includes('graph.facebook'), message);
    assertFalse(message.includes('bad token'), message);
  }
});

Deno.test('instagram: a fetch error that carries the URL and token does not reach the thrown message', async () => {
  const leaky = createInstagramProvider(TOKEN, '1784', (url) =>
    Promise.reject(new TypeError(`error sending request for url (${url}): connection reset`)));
  const message = await rejection(leaky.listTagged(25));
  assertFalse(message.includes(TOKEN), message);
  assertFalse(message.includes('graph.facebook'), message);
  const downloading = await rejection(leaky.download(GOOD_URL));
  assertFalse(downloading.includes(TOKEN), downloading);
  assertFalse(downloading.includes('cdninstagram'), downloading);
});

Deno.test('instagram: an unreadable answer throws without the token', async () => {
  for (const body of ['not json', JSON.stringify({ data: 'x' }), JSON.stringify([])]) {
    const s = stub(() => new Response(body, { status: 200 }));
    assertFalse((await rejection(s.provider.listTagged(25))).includes(TOKEN));
  }
});

Deno.test('instagram: download refuses an http URL, a foreign host and a look-alike host without fetching', async () => {
  const s = stub(() => image(10));
  for (
    const url of [
      'http://scontent.cdninstagram.com/photo.jpg',
      'https://example.com/photo.jpg',
      'https://cdninstagram.com.evil.example/photo.jpg',
      'https://evilcdninstagram.com/photo.jpg',
      'https://scontent.cdninstagram.com.evil.example/photo.jpg',
      'https://cdninstagram.com/photo.jpg',
      'https://fbcdn.net/photo.jpg',
      'https://user@evil.example/photo.jpg',
      'ftp://scontent.cdninstagram.com/photo.jpg',
      'file:///etc/passwd',
      'not a url',
      '',
    ]
  ) {
    const message = await rejection(s.provider.download(url));
    assertFalse(message.includes(TOKEN));
    assertFalse(isInstagramImageUrl(url), url);
  }
  assertEquals(s.calls.length, 0);
});

Deno.test('instagram: download takes the two Instagram image hosts, with redirects refused', async () => {
  const s = stub(() => image(2048));
  for (const url of [GOOD_URL, 'https://scontent.xx.fbcdn.net/v/t39/photo.jpg', 'https://instagram.fjnb1-1.fna.fbcdn.net/a.jpg']) {
    const file = await s.provider.download(url);
    assertEquals(file.type, 'image/jpeg');
    assertEquals(file.size, 2048);
  }
  assertEquals(s.calls.length, 3);
  for (const c of s.calls) {
    assertEquals(c.init?.redirect, 'error');
    assert(c.init?.signal instanceof AbortSignal);
    assertFalse('Authorization' in ((c.init?.headers as Record<string, string>) ?? {}));
  }
});

Deno.test('instagram: download refuses a body over 5 MB, by Content-Length and by the real bytes', async () => {
  const declared = stub(() => image(10, { 'content-length': String(MAX_IMAGE_BYTES + 1) }));
  assert((await rejection(declared.provider.download(GOOD_URL))).includes('too large'));

  // No Content-Length (chunked) and a header that lies: only the bytes that arrive count.
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  const undeclared = stub(() => new Response(big, { status: 200, headers: { 'content-type': 'image/png' } }));
  assert((await rejection(undeclared.provider.download(GOOD_URL))).includes('too large'));
  const lying = stub(() => {
    const r = new Response(big, { status: 200, headers: { 'content-type': 'image/png' } });
    Object.defineProperty(r, 'headers', {
      value: new Headers({ 'content-type': 'image/png', 'content-length': '100' }),
    });
    return r;
  });
  assert((await rejection(lying.provider.download(GOOD_URL))).includes('too large'));

  // Exactly 5 MB is allowed.
  const exact = stub(() => image(MAX_IMAGE_BYTES));
  assertEquals((await exact.provider.download(GOOD_URL)).size, MAX_IMAGE_BYTES);
});

Deno.test('instagram: download takes jpeg, png and webp only, and a good answer only', async () => {
  for (const [type, ext] of [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/JPEG; charset=x', 'jpg']]) {
    const s = stub(() => image(64, { 'content-type': type }));
    const file = await s.provider.download(GOOD_URL);
    assert(file.name.endsWith(`.${ext}`), file.name);
  }
  for (const type of ['image/gif', 'image/svg+xml', 'text/html', 'application/octet-stream', '']) {
    const s = stub(() => image(64, { 'content-type': type }));
    await rejection(s.provider.download(GOOD_URL));
  }
  await rejection(stub(() => new Response('gone', { status: 404, headers: { 'content-type': 'image/jpeg' } })).provider.download(GOOD_URL));
  await rejection(stub(() => image(0)).provider.download(GOOD_URL));
});

Deno.test('instagram: timestamps in Instagram\'s own format are read, and anything else is refused', () => {
  assertEquals(parseInstagramTime('2026-11-01T10:00:00+0000'), '2026-11-01T10:00:00.000Z');
  assertEquals(parseInstagramTime('2026-11-01T12:00:00+0200'), '2026-11-01T10:00:00.000Z');
  assertEquals(parseInstagramTime('2026-11-01T10:00:00-0530'), '2026-11-01T15:30:00.000Z');
  assertEquals(parseInstagramTime('2026-11-01T10:00:00+00:00'), '2026-11-01T10:00:00.000Z');
  assertEquals(parseInstagramTime('2026-11-01T10:00:00Z'), '2026-11-01T10:00:00.000Z');
  assertEquals(parseInstagramTime(''), null);
  assertEquals(parseInstagramTime('soon'), null);
});
