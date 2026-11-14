-- Restock alerts for the 4Nguru storefront edge function (Phase F). Additive and
-- safe to re-run: the table uses "if not exists", functions use "create or
-- replace" and nothing existing is touched, except unsubscribe_contact, which is
-- replaced by a copy that also removes restock requests (see below). It needs
-- 20261031130000_community.sql (normalise_phone, subscribe_ip_log) and
-- 20261031140000_unsubscribe.sql (unsubscribe_contact).
--
-- A customer leaves a phone number or an email address on a size and colour that
-- is out of stock. The owner sees who is waiting and, once they have told the
-- person, removes the row. Nothing is sent automatically.
--
-- Table: restock_requests, one row per variant and contact. Exactly one of phone
-- and email is set, with the same value checks as subscribers. The phone is
-- unique per variant after normalise_phone, the email unique lower-cased, so a
-- repeat from the same contact is one row. A request goes when its product or
-- variant is deleted (on delete cascade). RLS is on, there are no policies and
-- nothing is granted to anon or authenticated, as for subscribers. All changes
-- go through the functions below, which only service_role may call.
--
-- request_restock_alert: the address limit is the one from subscribe, sharing
-- subscribe_ip_log, so sign-ups, unsubscribes and restock requests together are
-- 5 per client address in a rolling hour (same salted SHA-256 of the address,
-- same cleanup; no address, no limit; over the limit nothing is written). Then:
-- the variant must belong to the product and the product must be active, else
-- {ok:false, reason:'not_found'}; a variant with stock is {ok:false, reason:
-- 'in_stock'}. A repeat from the same contact for the same variant changes
-- nothing and still returns {ok:true}, so the answer does not say who is waiting.
-- This is personal data that must not linger: every call also deletes requests
-- older than 180 days, at most 200 rows per call.
--
-- unsubscribe_contact is replaced with the same signature and behaviour, plus one
-- thing: in the same update branch, the restock requests that match the contact
-- (normalised phone or lower-cased email) are deleted. /unsubscribe promises no
-- more messages, and a restock request is a promise to send one.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Table.
-- ---------------------------------------------------------------------------
create table if not exists public.restock_requests (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  phone text check (phone is null or coalesce(char_length(public.normalise_phone(phone)), 0) between 9 and 15),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  created_at timestamptz not null default now(),
  check ((phone is null) <> (email is null))
);

create unique index if not exists restock_requests_phone_uniq
  on public.restock_requests (variant_id, public.normalise_phone(phone)) where phone is not null;
create unique index if not exists restock_requests_email_uniq
  on public.restock_requests (variant_id, lower(email)) where email is not null;
create index if not exists restock_requests_created_idx on public.restock_requests (created_at);

alter table public.restock_requests enable row level security;
revoke all on table public.restock_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Customer: ask to be told.
-- ---------------------------------------------------------------------------

-- The caller has already checked the input (a variant id, exactly one real
-- contact). Returns {ok:true} for a new request and for a repeat,
-- {ok:false, reason:'rate_limited'} over the address limit (nothing is written),
-- {ok:false, reason:'not_found'} for an unknown or inactive product or a variant
-- of another product, and {ok:false, reason:'in_stock'} when the variant has stock.
create or replace function public.request_restock_alert(
  p_product_id text,
  p_variant_id uuid,
  p_phone text,
  p_email text,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip text := nullif(btrim(coalesce(p_ip, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_salt text;
  v_hash text;
  v_count int;
  v_stock int;
begin
  -- The address limit first, shared with subscribe. No address, no check.
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

  -- Personal data must not linger: old requests go, a few at a time.
  delete from public.restock_requests
  where ctid in (
    select r.ctid from public.restock_requests r
    where r.created_at <= now() - interval '180 days'
    limit 200
    for update skip locked
  );

  select v.stock into v_stock
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.id = p_variant_id and v.product_id = p_product_id and p.active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_stock > 0 then
    return jsonb_build_object('ok', false, 'reason', 'in_stock');
  end if;

  -- A repeat from the same contact for the same variant is not an error and not a new row.
  insert into public.restock_requests (product_id, variant_id, phone, email)
  values (p_product_id, p_variant_id, v_phone, v_email)
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner: who is waiting.
-- ---------------------------------------------------------------------------

-- Oldest first. Each request carries the product and the variant's current size,
-- colour and stock, so the owner can see what has come back.
create or replace function public.list_restock_requests_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'productId', r.product_id,
        'productName', p.name,
        'productSlug', p.slug,
        'variantId', r.variant_id,
        'size', v.size,
        'color', v.color,
        'stock', v.stock,
        'phone', r.phone,
        'email', r.email,
        'createdAt', r.created_at
      )
      order by r.created_at, r.id
    ),
    '[]'::jsonb
  )
  from public.restock_requests r
  join public.products p on p.id = r.product_id
  join public.product_variants v on v.id = r.variant_id
$$;

-- True when the request existed.
create or replace function public.delete_restock_request(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.restock_requests where id = p_id;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- unsubscribe_contact: as in 20261031140000_unsubscribe.sql, plus the removal of
-- the contact's restock requests in the same branch as the opt-out.
-- ---------------------------------------------------------------------------
create or replace function public.unsubscribe_contact(
  p_phone text,
  p_email text,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip text := nullif(btrim(coalesce(p_ip, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_pn text;
  v_salt text;
  v_hash text;
  v_count int;
begin
  -- The address limit first, shared with subscribe. No address, no check.
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
  if v_pn is not null or v_email is not null then
    update public.subscribers set unsubscribed_at = coalesce(unsubscribed_at, now())
    where (v_pn is not null and phone is not null and public.normalise_phone(phone) = v_pn)
       or (v_email is not null and email is not null and lower(email) = lower(v_email));
    delete from public.restock_requests
    where (v_pn is not null and phone is not null and public.normalise_phone(phone) = v_pn)
       or (v_email is not null and email is not null and lower(email) = lower(v_email));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only.
-- ---------------------------------------------------------------------------
revoke execute on function public.request_restock_alert(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.request_restock_alert(text, uuid, text, text, text) to service_role;
revoke execute on function public.list_restock_requests_admin() from public, anon, authenticated;
grant execute on function public.list_restock_requests_admin() to service_role;
revoke execute on function public.delete_restock_request(uuid) from public, anon, authenticated;
grant execute on function public.delete_restock_request(uuid) to service_role;
revoke execute on function public.unsubscribe_contact(text, text, text) from public, anon, authenticated;
grant execute on function public.unsubscribe_contact(text, text, text) to service_role;
