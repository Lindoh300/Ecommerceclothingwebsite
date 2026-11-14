-- "Your fit, here" wall for the 4Nguru storefront: photos other people tagged
-- the shop in on Instagram, copied to our own storage, newest 6 shown on
-- /community. Additive and safe to re-run: tables use "if not exists",
-- functions use "create or replace" and nothing existing is touched. No pg_cron
-- and no pg_net: the edge function does the syncing.
--
-- Tables: fit_photos, fit_sync. RLS is on, there are no policies and nothing is
-- granted to anon or authenticated, as for orders and events. All changes go
-- through the functions below, which only service_role may call.
--
-- fit_photos: one row per Instagram media id. image is our public copy's URL and
-- path its Storage path. Hiding a photo (hide_fit_photo) blanks image and path
-- and sets hidden, but keeps the row, so the sync never brings that post back:
-- upsert_fit_photo leaves a hidden row alone.
--
-- fit_sync: a singleton row (id = 1) that stops two syncs running at once and
-- records the last success and the last error.

create table if not exists public.fit_photos (
  media_id text primary key,
  image text not null default '',
  path text not null default '',
  username text not null default '',
  permalink text not null default '',
  posted_at timestamptz not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists fit_photos_visible_idx
  on public.fit_photos (hidden, posted_at desc, media_id desc);

create table if not exists public.fit_sync (
  id int primary key default 1 check (id = 1),
  started_at timestamptz,
  last_ok_at timestamptz,
  last_error text not null default ''
);

alter table public.fit_photos enable row level security;
alter table public.fit_sync enable row level security;
revoke all on public.fit_photos from public, anon, authenticated;
revoke all on public.fit_sync from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reads.
-- ---------------------------------------------------------------------------

-- The newest 6 visible photos, as a jsonb array (empty when none).
create or replace function public.list_fit_photos_public()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', media_id, 'image', image, 'username', username,
    'permalink', permalink, 'postedAt', posted_at
  ) order by posted_at desc, media_id desc), '[]'::jsonb)
  from (
    select * from public.fit_photos
    where hidden = false and image <> ''
    order by posted_at desc, media_id desc
    limit 6
  ) t
$$;

-- Every row, newest first, with the Storage path and hidden flag.
create or replace function public.list_fit_photos_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', media_id, 'image', image, 'path', path, 'username', username,
    'permalink', permalink, 'postedAt', posted_at, 'hidden', hidden
  ) order by posted_at desc, media_id desc), '[]'::jsonb)
  from public.fit_photos
$$;

-- ---------------------------------------------------------------------------
-- Writes.
-- ---------------------------------------------------------------------------

-- Insert or update one photo. A hidden row is never changed (false); else true.
create or replace function public.upsert_fit_photo(p_input jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := p_input->>'id';
begin
  if exists (select 1 from public.fit_photos where media_id = v_id and hidden) then
    return false;
  end if;
  insert into public.fit_photos (media_id, image, path, username, permalink, posted_at)
  values (
    v_id,
    coalesce(p_input->>'image', ''),
    coalesce(p_input->>'path', ''),
    coalesce(p_input->>'username', ''),
    coalesce(p_input->>'permalink', ''),
    (p_input->>'postedAt')::timestamptz
  )
  on conflict (media_id) do update set
    image = excluded.image,
    path = excluded.path,
    username = excluded.username,
    permalink = excluded.permalink,
    posted_at = excluded.posted_at
  where public.fit_photos.hidden = false;
  return true;
end;
$$;

-- True if a row went.
create or replace function public.delete_fit_photo(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from public.fit_photos where media_id = p_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Hide a photo: blank image and path, keep the row. Returns the OLD path so the
-- caller can delete the file.
create or replace function public.hide_fit_photo(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  select path into v_path from public.fit_photos where media_id = p_id for update;
  if not found then
    return jsonb_build_object('found', false, 'path', '');
  end if;
  update public.fit_photos set hidden = true, image = '', path = '' where media_id = p_id;
  return jsonb_build_object('found', true, 'path', v_path);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sync bookkeeping.
-- ---------------------------------------------------------------------------

-- Claim the sync: true only if no run started in the last p_min_age_seconds.
create or replace function public.claim_fit_sync(p_min_age_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  insert into public.fit_sync (id) values (1) on conflict (id) do nothing;
  update public.fit_sync set started_at = now()
  where id = 1
    and (started_at is null or started_at <= now() - make_interval(secs => p_min_age_seconds));
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Record how a run ended. A success (empty error) also sets last_ok_at.
create or replace function public.finish_fit_sync(p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fit_sync (id) values (1) on conflict (id) do nothing;
  update public.fit_sync set
    last_error = coalesce(p_error, ''),
    last_ok_at = case when coalesce(p_error, '') = '' then now() else last_ok_at end
  where id = 1;
end;
$$;

create or replace function public.fit_sync_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('lastOkAt', last_ok_at, 'lastError', last_error) from public.fit_sync where id = 1),
    jsonb_build_object('lastOkAt', null, 'lastError', '')
  )
$$;

revoke execute on function public.list_fit_photos_public() from public, anon, authenticated;
revoke execute on function public.list_fit_photos_admin() from public, anon, authenticated;
revoke execute on function public.upsert_fit_photo(jsonb) from public, anon, authenticated;
revoke execute on function public.delete_fit_photo(text) from public, anon, authenticated;
revoke execute on function public.hide_fit_photo(text) from public, anon, authenticated;
revoke execute on function public.claim_fit_sync(integer) from public, anon, authenticated;
revoke execute on function public.finish_fit_sync(text) from public, anon, authenticated;
revoke execute on function public.fit_sync_status() from public, anon, authenticated;
grant execute on function public.list_fit_photos_public() to service_role;
grant execute on function public.list_fit_photos_admin() to service_role;
grant execute on function public.upsert_fit_photo(jsonb) to service_role;
grant execute on function public.delete_fit_photo(text) to service_role;
grant execute on function public.hide_fit_photo(text) to service_role;
grant execute on function public.claim_fit_sync(integer) to service_role;
grant execute on function public.finish_fit_sync(text) to service_role;
grant execute on function public.fit_sync_status() to service_role;
