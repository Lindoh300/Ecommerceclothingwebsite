import type { Context, Hono } from 'npm:hono';
import { clientIp } from './app.ts';
import type { Deps } from './types.ts';
import { UUID_RE, validateGalleryInput, validateSubscribeInput, validateUnsubscribeInput } from './validation.ts';

const PREFIX = '/make-server-fbb8f0e1';

/**
 * The wording a person agrees to when they tick the box. The server stores this, never text from a request.
 * KEEP EQUAL to CONSENT_TEXT in src/app/api/communityConsent.ts (the sign-up form shows it); a test in
 * community.test.ts compares the two. Change the wording only together with CONSENT_VERSION.
 */
export const CONSENT_TEXT =
  "Yes, I'd like 4Nguru to send me news about new drops and events. I can opt out at any time.";
/** The date of the current wording. */
export const CONSENT_VERSION = '2026-10-31';
/** What is stored in subscribers.consent_text: the version, then the wording. */
export const STORED_CONSENT_TEXT = `[${CONSENT_VERSION}] ${CONSENT_TEXT}`;

type Guard = (c: Context) => Promise<Response | null>;

/**
 * Registers the community routes on `app`. `guard` returns an error Response when the caller is not an admin,
 * else null; every /admin route calls it before it reads anything.
 *   Public: GET /gallery, POST /subscribers, POST /subscribers/unsubscribe
 *   Admin:  GET /admin/subscribers, POST /admin/subscribers/:id/unsubscribe,
 *           GET /admin/gallery, PUT and DELETE /admin/gallery/:id
 */
export function registerCommunityRoutes(app: Hono, deps: Deps, guard: Guard): void {
  const community = deps.community;

  const readJson = async (c: Context): Promise<{ ok: true; body: unknown } | { ok: false }> => {
    try {
      return { ok: true, body: await c.req.json() };
    } catch {
      return { ok: false };
    }
  };

  // --- Public -----------------------------------------------------------------------------------------------

  app.get(`${PREFIX}/gallery`, async (c) => c.json(await community.listGalleryPublic()));

  // Always {ok:true} with 200 for a valid request, new or repeat, so the answer does not say who is on the list.
  // 5 sign-ups per client address per hour; no address, no limit.
  app.post(`${PREFIX}/subscribers`, async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateSubscribeInput(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const ip = clientIp(c.req.raw.headers);
    const r = await community.subscribe(v.value, STORED_CONSENT_TEXT, ip ?? undefined);
    if (!r.ok) {
      c.header('Retry-After', '3600');
      return c.json({
        error: 'Too many sign-ups from this connection. Please try again in an hour or message us on WhatsApp.',
        code: 'rate_limited',
      }, 429);
    }
    return c.json({ ok: true });
  });

  // Self-service opt-out by phone, email or both. 200 {ok:true} for a valid request whether or not the contact is on the
  // list, so the answer does not say who is. Shares the sign-up limit: 5 sign-ups and unsubscribes together per client
  // address per hour; no address, no limit. Nothing is deleted: the row stays as the record of the consent.
  app.post(`${PREFIX}/subscribers/unsubscribe`, async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateUnsubscribeInput(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const ip = clientIp(c.req.raw.headers);
    const r = await community.unsubscribeContact(v.value, ip ?? undefined);
    if (!r.ok) {
      c.header('Retry-After', '3600');
      return c.json({
        error: 'Too many requests from this connection. Please try again in an hour or message us on WhatsApp.',
        code: 'rate_limited',
      }, 429);
    }
    return c.json({ ok: true });
  });

  // --- Admin ------------------------------------------------------------------------------------------------

  app.get(`${PREFIX}/admin/subscribers`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    return c.json(await community.listSubscribers());
  });

  app.post(`${PREFIX}/admin/subscribers/:id/unsubscribe`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Subscriber not found' }, 404);
    const s = await community.unsubscribe(id.toLowerCase());
    if (!s) return c.json({ error: 'Subscriber not found' }, 404);
    return c.json(s);
  });

  app.get(`${PREFIX}/admin/gallery`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    return c.json(await community.listGalleryAdmin());
  });

  // Create or update under a client id. A new item needs an image.
  app.put(`${PREFIX}/admin/gallery/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'id must be a UUID' }, 400);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateGalleryInput(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const r = await community.upsertGalleryItem(id.toLowerCase(), v.value);
    if (!r.ok) {
      if (r.reason === 'event_not_found') return c.json({ error: 'That event does not exist' }, 400);
      return c.json({ error: 'A new gallery item needs an image' }, 400);
    }
    return c.json(r.item, r.created ? 201 : 200);
  });

  app.delete(`${PREFIX}/admin/gallery/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Gallery item not found' }, 404);
    if (!(await community.deleteGalleryItem(id.toLowerCase()))) return c.json({ error: 'Gallery item not found' }, 404);
    return c.body(null, 204);
  });
}
