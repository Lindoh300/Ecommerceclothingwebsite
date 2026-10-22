import { createClient } from 'jsr:@supabase/supabase-js@2.49.8';
import * as kv from './kv_store.tsx';
import { createApp } from './app.ts';
import type { Deps } from './types.ts';

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const BUCKET = 'product-images';
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const client = () => createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));

const deps: Deps = {
  kv,
  async isAdmin(authHeader) {
    const m = authHeader?.match(/^Bearer\s+(.+)$/i);
    if (!m) return 'unauthenticated';
    const { data, error } = await client().auth.getUser(m[1]);
    if (error || !data?.user) return 'unauthenticated';
    return data.user.app_metadata?.role === 'admin' ? 'ok' : 'forbidden';
  },
  async uploadImage(file) {
    const supabase = client();
    const ext = EXT[file.type] ?? 'bin';
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type });
    if (error) throw new Error(error.message);
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  },
};

Deno.serve(createApp(deps).fetch);
