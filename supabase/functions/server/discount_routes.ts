import type { Context, Hono } from 'npm:hono';
import type { Deps } from './types.ts';
import { UUID_RE, validateDiscountInput } from './validation.ts';

const PREFIX = '/make-server-fbb8f0e1';

type Guard = (c: Context) => Promise<Response | null>;

/**
 * Registers the admin discount code routes on `app`. `guard` returns an error Response when the caller is not an
 * admin, else null; every route calls it before it reads anything.
 *   GET /admin/discounts        every code, newest first, with the number of uses
 *   PUT /admin/discounts/:id    create or update by id (a UUID the screen makes); 409 code_taken for a duplicate code
 * There is no delete: the owner turns a code off. `uses` is counted by the server and is never read from the body.
 */
export function registerDiscountRoutes(app: Hono, deps: Deps, guard: Guard): void {
  app.get(`${PREFIX}/admin/discounts`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    return c.json(await deps.discounts.list());
  });

  app.put(`${PREFIX}/admin/discounts/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'id must be a UUID' }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON' }, 400);
    }
    const v = validateDiscountInput(body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const r = await deps.discounts.upsert(id.toLowerCase(), v.value);
    if (r.ok) return c.json(r.discount);
    return c.json({ error: 'That code already exists', code: 'code_taken' }, 409);
  });
}
