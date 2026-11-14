import type { Context, Hono } from 'npm:hono';
import { listEmail, MAX_BATCH } from './mailer.ts';
import type { Deps } from './types.ts';
import { UUID_RE, validateListSendInput, validateListSendTest } from './validation.ts';

const PREFIX = '/make-server-fbb8f0e1';

type Guard = (c: Context) => Promise<Response | null>;

/**
 * Registers the routes that send an email to the mailing list. `guard` returns an error Response when the caller is not
 * an admin, else null; every route calls it before it reads anything. All are admin routes.
 *   GET  /admin/list-sends               {emailOn, sends}: the past sends, newest first, and whether sending is switched on
 *   POST /admin/list-sends/test          one list email to one address, to see how it looks
 *   PUT  /admin/list-sends/:id           create a send under a client id (snapshots the list); a repeat id changes nothing
 *   POST /admin/list-sends/:id/continue  send the next batch of up to 100; the screen calls it until nothing is pending
 *
 * Email is on only when deps.mailer and deps.siteUrl are both set (RESEND_API_KEY, EMAIL_FROM and SITE_URL). Every
 * message is built by listEmail, so each carries the unsubscribe lines and the List-Unsubscribe header. The address of
 * a recipient is read when its batch is claimed, so a person who opts out mid-send is skipped. Nothing here logs an
 * address or any of the text.
 */
export function registerListSendRoutes(app: Hono, deps: Deps, guard: Guard): void {
  const sends = deps.listSends;
  const emailOn = () => deps.mailer !== null && deps.siteUrl !== null;
  const off = (c: Context) => c.json({ error: 'Email is not switched on', code: 'email_off' }, 503);

  const readJson = async (c: Context): Promise<{ ok: true; body: unknown } | { ok: false }> => {
    try {
      return { ok: true, body: await c.req.json() };
    } catch {
      return { ok: false };
    }
  };

  app.get(`${PREFIX}/admin/list-sends`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    return c.json({ emailOn: emailOn(), sends: await sends.listAdmin() });
  });

  // Registered before the :id routes. 'test' is not a UUID, so it could not clash anyway.
  app.post(`${PREFIX}/admin/list-sends/test`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const { mailer, siteUrl } = deps;
    if (mailer === null || siteUrl === null) return off(c);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateListSendTest(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    try {
      await mailer.send(listEmail(v.value.to, v.value.subject, v.value.body, siteUrl));
    } catch {
      // Nothing from the request or the error is logged: no address, no text.
      console.error('List send test email failed');
      return c.json({ error: 'The email could not be sent', code: 'send_failed' }, 502);
    }
    return c.json({ ok: true });
  });

  app.put(`${PREFIX}/admin/list-sends/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    if (!emailOn()) return off(c);
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'id must be a UUID' }, 400);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: 'Malformed JSON' }, 400);
    const v = validateListSendInput(parsed.body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const r = await sends.create(id.toLowerCase(), v.value);
    return c.json(r.send, r.created ? 201 : 200);
  });

  app.post(`${PREFIX}/admin/list-sends/:id/continue`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const { mailer, siteUrl } = deps;
    if (mailer === null || siteUrl === null) return off(c);
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Send not found' }, 404);
    const claimed = await sends.claimBatch(id.toLowerCase(), MAX_BATCH);
    if (!claimed) return c.json({ error: 'Send not found' }, 404);
    if (claimed.recipients.length === 0) return c.json({ send: claimed.summary, batchFailed: false });

    // From here on the batch is 'sending' and must be settled, whatever happens. A throw while building or sending
    // puts it back for another try (up to 3 attempts); only a crash leaves it 'sending', and that is never re-sent.
    const { subject, body } = claimed.summary;
    const ids = claimed.recipients.map((r) => r.subscriberId);
    let ok = false;
    try {
      await mailer.sendBatch(claimed.recipients.map((r) => listEmail(r.email, subject, body, siteUrl)));
      ok = true;
    } catch (e) {
      // The mailer's message holds a status or a network reason, never the key. No address or text is logged.
      console.error(`List send batch of ${ids.length} failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
    const send = await sends.finishBatch(id.toLowerCase(), ids, ok);
    if (!send) return c.json({ error: 'Send not found' }, 404);
    return c.json({ send, batchFailed: !ok });
  });
}
