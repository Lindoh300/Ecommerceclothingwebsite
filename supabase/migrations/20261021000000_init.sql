-- Initial schema for the 4Nguru storefront edge function (make-server-fbb8f0e1).
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Key-value table used by supabase/functions/server/kv_store.tsx.
-- ---------------------------------------------------------------------------
create table if not exists public.kv_store_fbb8f0e1 (
  key text not null primary key,
  value jsonb not null
);

-- RLS is on and there are deliberately NO policies. The anon and authenticated
-- roles cannot read or write this table. Only the edge function, which uses the
-- service role key, can access it, because the service role bypasses RLS.
alter table public.kv_store_fbb8f0e1 enable row level security;

-- Belt and braces: remove any table privileges granted to the client roles.
revoke all on public.kv_store_fbb8f0e1 from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket for product images.
-- ---------------------------------------------------------------------------
-- The bucket is public, so anyone can read an image by its URL. Uploads,
-- updates and deletes go through the edge function with the service role key.
-- There are deliberately NO insert, update or delete policies on storage.objects
-- for this bucket, so anon and authenticated clients cannot write to it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
