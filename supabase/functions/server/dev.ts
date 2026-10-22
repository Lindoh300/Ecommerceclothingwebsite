// Local dev server with no Supabase. Run with: deno run --allow-net dev.ts
// Admin token: "Bearer dev-admin". Data lives in memory and resets on restart.
import { createApp } from './app.ts';
import type { Deps, KvLike } from './types.ts';

export function memoryKv(): KvLike {
  const m = new Map<string, unknown>();
  return {
    get: (k) => Promise.resolve(m.has(k) ? structuredClone(m.get(k)) : undefined),
    set: (k, v) => {
      m.set(k, structuredClone(v));
      return Promise.resolve();
    },
    del: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
    getByPrefix: (p) =>
      Promise.resolve([...m.entries()].filter(([k]) => k.startsWith(p)).map(([, v]) => structuredClone(v))),
  };
}

if (import.meta.main) {
  const deps: Deps = {
    kv: memoryKv(),
    isAdmin: (h) => Promise.resolve(h === 'Bearer dev-admin' ? 'ok' : 'unauthenticated'),
    uploadImage: () => Promise.resolve(`https://picsum.photos/seed/${crypto.randomUUID()}/800/800`),
  };
  Deno.serve({ port: 8787 }, createApp(deps).fetch);
}
