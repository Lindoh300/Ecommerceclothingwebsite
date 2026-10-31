import type { Context, Hono } from 'npm:hono';
import { clientIp } from './app.ts';
import type { Deps } from './types.ts';
import { UUID_RE, validateRestockInput } from './validation.ts';

const PREFIX = '/make-server-fbb8f0e1';

type Guard = (c: Context) => Promise<Response | null>;

/**
 * Registers the restock alert routes on `app`. `guard` returns an error Response when the caller is not an admin,
 * else null; every /admin route calls it before it reads anything.
 *   Public: POST /products/:id/restock-alert
 *   Admin:  GET /admin/restock-requests, DELETE /admin/restock-requests/:id
 * Nothing is sent automatically: the owner sees who is waiting, tells them, and removes the row.
 */
export function registerRestockRoutes(app: Hono, deps: Deps, guard: Guard): void {
  const restock = deps.restock;

  // --- Public -----------------------------------------------------------------------------------------------

  // A customer leaves a phone or an email (exactly one) on an out-of-stock option. A new request and a repeat give the
  // identical 200 {ok:true}, so the answer does not say who is waiting. Shares the sign-up limit: 5 sign-ups,
  // unsubscribes and restock requests together per client address per hour; no address, no limit.
  app.post(`${PREFIX}/products/:id/restock-alert`, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON' }, 400);
    }
    const v = validateRestockInput(body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const ip = clientIp(c.req.raw.headers);
    const r = await restock.request({ productId: c.req.param('id'), ...v.value }, ip ?? undefined);
    if (r.ok) return c.json({ ok: true });
    if (r.reason === 'not_found') return c.json({ error: 'Product not found' }, 404);
    if (r.reason === 'in_stock') return c.json({ error: 'That option is in stock', code: 'in_stock' }, 409);
    c.header('Retry-After', '3600');
    return c.json({
      error: 'Too many requests from this connection. Please try again in an hour or message us on WhatsApp.',
      code: 'rate_limited',
    }, 429);
  });

  // --- Admin ------------------------------------------------------------------------------------------------

  // Oldest first, with the option's current stock so the owner can see what has come back.
  app.get(`${PREFIX}/admin/restock-requests`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    return c.json(await restock.list());
  });

  // The owner has told the person: remove the row.
  app.delete(`${PREFIX}/admin/restock-requests/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Request not found' }, 404);
    if (!(await restock.remove(id.toLowerCase()))) return c.json({ error: 'Request not found' }, 404);
    return c.body(null, 204);
  });
}
