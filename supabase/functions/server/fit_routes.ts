import type { Context, Hono } from 'npm:hono';
import { FIT_ADMIN_MIN_AGE, FIT_PUBLIC_MIN_AGE, syncFits } from './fit_sync.ts';
import type { Deps } from './types.ts';

const PREFIX = '/make-server-fbb8f0e1';
/** Instagram post ids are digits. */
const FIT_ID_RE = /^[0-9]{1,40}$/;

type Guard = (c: Context) => Promise<Response | null>;

/**
 * Registers the "Your fit, here" routes on `app`. `guard` returns an error Response when the caller is not an admin,
 * else null; every /admin route calls it before it reads anything.
 *   Public: GET /fits
 *   Admin:  GET /admin/fits, POST /admin/fits/sync, POST /admin/fits/:id/hide, POST /admin/fits/:id/show
 * Off (an empty wall, 503 for Sync now) until both Instagram secrets are set.
 */
export function registerFitRoutes(app: Hono, deps: Deps, guard: Guard): void {
  const { fits } = deps;

  // Starts a sync after the answer has gone. It never throws and never blocks the caller.
  const syncInBackground = (minAgeSeconds: number) => {
    try {
      deps.background(syncFits(deps, minAgeSeconds).catch(() => 'failed'));
    } catch {
      // nothing to do: the next visit or the Sync now button tries again
    }
  };

  // --- Public -----------------------------------------------------------------------------------------------

  // The wall. A visit starts a sync at most every 15 minutes, but the answer is what is stored now, so a visitor
  // never waits on Instagram.
  app.get(`${PREFIX}/fits`, async (c) => {
    if (!deps.instagram) return c.json([]);
    syncInBackground(FIT_PUBLIC_MIN_AGE);
    return c.json(await fits.listPublic());
  });

  // --- Admin ------------------------------------------------------------------------------------------------

  // Every stored photo with its hidden flag, and how the last sync went. The bucket path is not sent.
  app.get(`${PREFIX}/admin/fits`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    const [rows, status] = await Promise.all([fits.listAdmin(), fits.status()]);
    return c.json({
      enabled: deps.instagram !== null,
      photos: rows.map(({ path: _path, ...photo }) => photo),
      status,
    });
  });

  // Sync now: always runs, and the owner waits for the result.
  app.post(`${PREFIX}/admin/fits/sync`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    if (!deps.instagram) {
      return c.json({ error: 'Instagram is not connected', code: 'instagram_off' }, 503);
    }
    return c.json({ result: await syncFits(deps, FIT_ADMIN_MIN_AGE) });
  });

  // Take a photo off the wall for good: the row stays hidden so the next sync does not bring it back, and its file
  // goes. The next post fills the gap.
  app.post(`${PREFIX}/admin/fits/:id/hide`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!FIT_ID_RE.test(id)) return c.json({ error: 'Invalid photo id' }, 400);
    const r = await fits.hide(id);
    if (!r.found) return c.json({ error: 'Photo not found' }, 404);
    if (r.path) {
      try {
        await deps.removeFitImage(r.path);
      } catch {
        console.error('fit hide: file_remove_failed');
      }
    }
    syncInBackground(FIT_ADMIN_MIN_AGE);
    return c.json({ ok: true });
  });

  // Let a hidden photo back: its row is deleted, so the next sync may bring it onto the wall again if it is still
  // among the newest. A photo that is not hidden is left alone.
  app.post(`${PREFIX}/admin/fits/:id/show`, async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!FIT_ID_RE.test(id)) return c.json({ error: 'Invalid photo id' }, 400);
    const row = (await fits.listAdmin()).find((r) => r.id === id);
    if (row?.hidden) await fits.remove(id);
    syncInBackground(FIT_ADMIN_MIN_AGE);
    return c.json({ ok: true });
  });
}
