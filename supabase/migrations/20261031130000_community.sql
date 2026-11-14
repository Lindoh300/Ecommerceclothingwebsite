-- Community for the 4Nguru storefront edge function (Phase F, first slice: the
-- event photo gallery and the mailing list with recorded consent). Additive and
-- safe to re-run: tables use "if not exists", functions use "create or replace"
-- and nothing existing is touched. Orders, events and checkout are not changed.
--
-- Tables: subscribers, gallery_items, subscribe_ip_log. RLS is on, there are no
-- policies and nothing is granted to anon or authenticated, as for orders and
-- events. All changes go through the functions below, which only service_role
-- may call (normalise_phone too: the table indexes use it, and the functions
-- that write run as their owner).
--
-- Subscribers: a person is one row. At least one of phone or email is required.
-- The phone is unique after normalise_phone (digits only; a leading 0 becomes
-- 27, a leading 00 is dropped), the email is unique lower-cased. consent_text is
-- the exact wording the person agreed to (the edge function sends its own fixed,
-- version-dated text, never text from a request) and consent_at is when. A
-- repeat sign-up refreshes both and clears unsubscribed_at, and the caller gets
-- the same answer as for a new one, so the list cannot be probed. Opting out
-- sets unsubscribed_at; the row is kept as the record of the consent.
--
-- Sign-up limit: 5 sign-ups per client address in a rolling hour. The address
-- is stored only as a salted SHA-256 hash (the salt is order_rate_salt's), in
-- subscribe_ip_log. No address, no limit. Lock order: the address lock first,
-- then the one 'subscribe' lock that stops two sign-ups of the same contact
-- from racing into the unique indexes.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------

-- Digits only; "00" dropped; a leading 0 is South Africa's trunk prefix and
-- becomes 27. Null when no digits are left.
create or replace function public.normalise_phone(p_phone text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    case when d like '0%' then '27' || substr(d, 2) else d end,
    ''
  )
  from (select regexp_replace(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '^00', '') as d) s
$$;

-- ---------------------------------------------------------------------------
-- Tables.
-- ---------------------------------------------------------------------------
create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  name text check (name is null or (btrim(name) <> '' and char_length(name) <= 100)),
  phone text check (phone is null or coalesce(char_length(public.normalise_phone(phone)), 0) between 9 and 15),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  consent_text text not null check (btrim(consent_text) <> ''),
  consent_at timestamptz not null,
  source text not null check (source in ('community', 'footer', 'event')),
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);

create unique index if not exists subscribers_phone_uniq
  on public.subscribers (public.normalise_phone(phone)) where phone is not null;
create unique index if not exists subscribers_email_uniq
  on public.subscribers (lower(email)) where email is not null;
create index if not exists subscribers_created_idx on public.subscribers (created_at desc);

create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  image text not null check (btrim(image) <> ''),
  caption text not null default '',
  event_id uuid references public.events (id) on delete set null,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists gallery_items_sort_idx on public.gallery_items (active, sort, created_at desc);
create index if not exists gallery_items_event_idx on public.gallery_items (event_id);

create table if not exists public.subscribe_ip_log (
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists subscribe_ip_log_hash_created_idx on public.subscribe_ip_log (ip_hash, created_at);
create index if not exists subscribe_ip_log_created_idx on public.subscribe_ip_log (created_at);

alter table public.subscribers enable row level security;
alter table public.gallery_items enable row level security;
alter table public.subscribe_ip_log enable row level security;
revoke all on table public.subscribers from public, anon, authenticated;
revoke all on table public.gallery_items from public, anon, authenticated;
revoke all on table public.subscribe_ip_log from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- JSON helpers.
-- ---------------------------------------------------------------------------

-- A gallery item. Public: id, image, caption, eventId. Admin adds sort, active
-- and createdAt.
create or replace function public.gallery_item_json(p_item public.gallery_items, p_admin boolean default false)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
      'id', p_item.id,
      'image', p_item.image,
      'caption', p_item.caption,
      'eventId', p_item.event_id
    )
    || case when p_admin then jsonb_build_object(
      'sort', p_item.sort,
      'active', p_item.active,
      'createdAt', p_item.created_at
    ) else '{}'::jsonb end
$$;

-- A subscriber for the owner. The consent wording is not listed; it is in the table.
create or replace function public.subscriber_json(p_sub public.subscribers)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_sub.id,
    'name', p_sub.name,
    'phone', p_sub.phone,
    'email', p_sub.email,
    'source', p_sub.source,
    'consentAt', p_sub.consent_at,
    'unsubscribedAt', p_sub.unsubscribed_at,
    'createdAt', p_sub.created_at
  )
$$;

-- ---------------------------------------------------------------------------
-- Gallery.
-- ---------------------------------------------------------------------------

-- Active items, by sort then newest.
create or replace function public.list_gallery_public()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(public.gallery_item_json(g) order by g.sort, g.created_at desc, g.id),
    '[]'::jsonb
  )
  from public.gallery_items g
  where g.active
$$;

-- Every item, hidden ones too, in the same order.
create or replace function public.list_gallery_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(public.gallery_item_json(g, true) order by g.sort, g.created_at desc, g.id),
    '[]'::jsonb
  )
  from public.gallery_items g
$$;

-- Create or update under a client id. Keys: image, caption, eventId (null
-- clears), sort, active; a missing key keeps the stored value. A new item needs
-- an image. Returns {ok, created, item} or {ok:false, reason:
-- 'missing_fields' | 'event_not_found'}.
create or replace function public.upsert_gallery_item(p_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ex public.gallery_items;
  v_new public.gallery_items;
  v_event uuid;
  v_found boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('gallery_item:' || p_id::text, 0));
  select * into v_ex from public.gallery_items where id = p_id for update;
  v_found := found;

  if p_input ? 'eventId' and jsonb_typeof(p_input -> 'eventId') <> 'null' then
    v_event := (p_input ->> 'eventId')::uuid;
    if not exists (select 1 from public.events where id = v_event) then
      return jsonb_build_object('ok', false, 'reason', 'event_not_found');
    end if;
  elsif p_input ? 'eventId' then
    v_event := null;
  else
    v_event := v_ex.event_id;
  end if;

  if not v_found then
    if nullif(btrim(coalesce(p_input ->> 'image', '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'missing_fields');
    end if;
    insert into public.gallery_items (id, image, caption, event_id, sort, active)
    values (
      p_id,
      btrim(p_input ->> 'image'),
      coalesce(p_input ->> 'caption', ''),
      v_event,
      coalesce((p_input ->> 'sort')::int, 0),
      coalesce((p_input ->> 'active')::boolean, true)
    )
    returning * into v_new;
    return jsonb_build_object('ok', true, 'created', true, 'item', public.gallery_item_json(v_new, true));
  end if;

  update public.gallery_items set
    image = case when p_input ? 'image' and nullif(btrim(p_input ->> 'image'), '') is not null
                 then btrim(p_input ->> 'image') else image end,
    caption = case when p_input ? 'caption' then coalesce(p_input ->> 'caption', '') else caption end,
    event_id = v_event,
    sort = case when p_input ? 'sort' then (p_input ->> 'sort')::int else sort end,
    active = case when p_input ? 'active' then (p_input ->> 'active')::boolean else active end
  where id = p_id
  returning * into v_new;
  return jsonb_build_object('ok', true, 'created', false, 'item', public.gallery_item_json(v_new, true));
end;
$$;

-- True when the item existed.
create or replace function public.delete_gallery_item(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.gallery_items where id = p_id;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mailing list.
-- ---------------------------------------------------------------------------

-- Signs a person up, or renews their consent. The caller has already checked the
-- input (a ticked box, one real contact, a known source). Returns {ok:true}
-- whether the person was new or not, or {ok:false, reason:'rate_limited'} when
-- the address has signed up 5 times in the past hour (nothing is written then).
create or replace function public.subscribe(
  p_name text,
  p_phone text,
  p_email text,
  p_consent_text text,
  p_source text,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip text := nullif(btrim(coalesce(p_ip, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_pn text;
  v_salt text;
  v_hash text;
  v_count int;
  v_pid uuid;
  v_eid uuid;
  v_id uuid;
begin
  -- The address limit first (see the header). No address, no check.
  if v_ip is not null then
    select salt into v_salt from public.order_rate_salt where id;
    if v_salt is null then
      insert into public.order_rate_salt (id) values (true) on conflict do nothing;
      select salt into v_salt from public.order_rate_salt where id;
    end if;
    v_hash := encode(sha256(convert_to(v_salt || v_ip, 'UTF8')), 'hex');
    perform pg_advisory_xact_lock(hashtextextended('subscribe_ip:' || v_hash, 0));
    delete from public.subscribe_ip_log
    where ip_hash = v_hash and created_at <= now() - interval '1 hour';
    select count(*) into v_count
    from public.subscribe_ip_log
    where ip_hash = v_hash and created_at > now() - interval '1 hour';
    if v_count >= 5 then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
    insert into public.subscribe_ip_log (ip_hash) values (v_hash);

    delete from public.subscribe_ip_log
    where ctid in (
      select l.ctid from public.subscribe_ip_log l
      where l.created_at <= now() - interval '1 hour'
      limit 200
      for update skip locked
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('subscribe', 0));

  v_pn := public.normalise_phone(v_phone);
  if v_pn is not null then
    select id into v_pid from public.subscribers
    where phone is not null and public.normalise_phone(phone) = v_pn;
  end if;
  if v_email is not null then
    select id into v_eid from public.subscribers where email is not null and lower(email) = lower(v_email);
  end if;
  v_id := coalesce(v_pid, v_eid);

  if v_id is null then
    insert into public.subscribers (name, phone, email, consent_text, consent_at, source)
    values (v_name, v_phone, v_email, p_consent_text, now(), p_source);
  else
    -- A contact the person gave that belongs to another row is not copied over.
    update public.subscribers set
      name = coalesce(v_name, name),
      phone = case when phone is null and v_pid is null then v_phone else phone end,
      email = case when email is null and v_eid is null then v_email else email end,
      consent_text = p_consent_text,
      consent_at = now(),
      unsubscribed_at = null
    where id = v_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Every subscriber, newest first, opted-out ones too.
create or replace function public.list_subscribers_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(public.subscriber_json(s) order by s.created_at desc, s.id),
    '[]'::jsonb
  )
  from public.subscribers s
$$;

-- Opts a subscriber out. The first time sets unsubscribed_at; a second call
-- keeps the first time. Returns the subscriber, or null when there is none.
create or replace function public.admin_unsubscribe_subscriber(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.subscribers;
begin
  update public.subscribers set unsubscribed_at = coalesce(unsubscribed_at, now())
  where id = p_id
  returning * into v_s;
  if not found then
    return null;
  end if;
  return public.subscriber_json(v_s);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only.
-- ---------------------------------------------------------------------------
revoke execute on function public.normalise_phone(text) from public, anon, authenticated;
grant execute on function public.normalise_phone(text) to service_role;
revoke execute on function public.gallery_item_json(public.gallery_items, boolean) from public, anon, authenticated;
grant execute on function public.gallery_item_json(public.gallery_items, boolean) to service_role;
revoke execute on function public.subscriber_json(public.subscribers) from public, anon, authenticated;
grant execute on function public.subscriber_json(public.subscribers) to service_role;
revoke execute on function public.list_gallery_public() from public, anon, authenticated;
grant execute on function public.list_gallery_public() to service_role;
revoke execute on function public.list_gallery_admin() from public, anon, authenticated;
grant execute on function public.list_gallery_admin() to service_role;
revoke execute on function public.upsert_gallery_item(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_gallery_item(uuid, jsonb) to service_role;
revoke execute on function public.delete_gallery_item(uuid) from public, anon, authenticated;
grant execute on function public.delete_gallery_item(uuid) to service_role;
revoke execute on function public.subscribe(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.subscribe(text, text, text, text, text, text) to service_role;
revoke execute on function public.list_subscribers_admin() from public, anon, authenticated;
grant execute on function public.list_subscribers_admin() to service_role;
revoke execute on function public.admin_unsubscribe_subscriber(uuid) from public, anon, authenticated;
grant execute on function public.admin_unsubscribe_subscriber(uuid) to service_role;
