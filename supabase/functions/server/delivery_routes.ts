import type { Context, Hono } from 'npm:hono';
import type { Deps } from './types.ts';
import { validateDeliveryOptionInput } from './validation.ts';

const PREFIX = '/make-server-fbb8f0e1';

type Guard = (c: Context) => Promise<Response | null>;

/**
 * Registers the admin delivery option routes on `app`. `guard` returns an error Response when the caller is not an
 * admin, else null; every route calls it before it reads anything.
 *   GET /admin/delivery-options        every option, active or not
 *   PUT /admin/delivery-options/:id    set name, price and active (all required)
 * Options cannot be created or deleted: checkout is coded for door, locker and collect.
 */
export function registerDeliveryRoutes(app: Hono, deps: Deps, guard: Guard): void {
  const options = deps.deliveryOptions;

  app.get(`${PREFIX}/admin/delivery-options`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    return c.json(await options.listAll());
  });

  app.put(`${PREFIX}/admin/delivery-options/:id`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON' }, 400);
    }
    const v = validateDeliveryOptionInput(body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const r = await options.update(c.req.param('id'), v.value);
    if (r.ok) return c.json(r.option);
    if (r.reason === 'not_found') return c.json({ error: 'Delivery option not found' }, 404);
    return c.json({ error: 'At least one delivery option must stay on', code: 'last_active' }, 409);
  });
}
