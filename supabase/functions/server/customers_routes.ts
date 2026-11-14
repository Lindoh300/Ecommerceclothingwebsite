import type { Context, Hono } from 'npm:hono';
import type { Deps } from './types.ts';

const PREFIX = '/make-server-fbb8f0e1';

type Guard = (c: Context) => Promise<Response | null>;

/**
 * Registers the admin customer list on `app`. `guard` returns an error Response when the caller is not an admin, else
 * null; the route calls it before it reads anything.
 *   GET /admin/customers    every customer built from the orders (list_customers), newest last order first
 * Read-only. Nothing about a customer is logged here.
 */
export function registerCustomerRoutes(app: Hono, deps: Deps, guard: Guard): void {
  app.get(`${PREFIX}/admin/customers`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    return c.json(await deps.customers.list());
  });
}
