-- Order fulfilment for the 4Nguru storefront edge function (sections 6 and 8
-- of the delivery / online payment work). Safe to re-run: every statement is
-- create or replace, create if not exists, or a grant.
--
-- Additive only. Nothing applied earlier is edited. This file
--   * replaces set_order_status (same signature) with one extra allowed move:
--       cancelled -> refunded, only while payment_flag = 'refund_due'
--     and clears that flag. Every other rule is exactly as in
--     20261030100000_order_lifecycle.sql;
--   * adds set_order_tracking, extend_order and lookup_order;
--   * adds the table order_lookup_log (the per-address limit on lookups).
-- Re-running 20261030100000_order_lifecycle.sql ALONE would put the old
-- set_order_status back, so apply the migrations in order; this one is last.
--
-- Why cancelled -> refunded: a payment that arrives after an order was
-- cancelled, when the stock is gone, leaves the order cancelled with
-- payment_flag = 'refund_due' (record_payment). The owner pays the money back
-- and moves the order to refunded, which clears the flag. A cancelled order
-- with no such flag was never paid, so it still cannot be refunded.
-- Refunding never returns stock (a cancelled order's stock is already back).
-- Any move to refunded clears a refund_due flag, so an expired order that was
-- flagged does not keep it after the refund. An amount_mismatch flag stays.
--
-- LOCK ORDER is written at the top of 20261030000000_catalogue.sql: the order
-- row, then the variant rows by id. set_order_tracking and extend_order lock
-- the order row and nothing else. lookup_order locks no order: it takes only
-- the per-address advisory lock (like place_order_v3, always last).

-- ---------------------------------------------------------------------------
-- set_order_status: as before, plus cancelled -> refunded when refund_due.
-- Allowed moves (from -> to):
--   pending           -> paid, cancelled
--   awaiting_payment  -> paid, cancelled, expired
--   paid              -> packed, refunded
--   packed            -> shipped, refunded
--   shipped           -> delivered, refunded
--   delivered         -> refunded
--   expired           -> refunded
--   cancelled         -> refunded, ONLY when payment_flag = 'refund_due'
--   refunded          -> nothing
-- ---------------------------------------------------------------------------
create or replace function public.set_order_status(p_id uuid, p_status text, p_from text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_order.status = p_status and (p_from is null or p_from = v_order.status) then
    return jsonb_build_object('ok', true, 'changed', false, 'order', public.order_json(v_order));
  end if;

  if (p_from is not null and p_from <> v_order.status)
     or not (
       exists (
         select 1
         from (values
           ('pending', 'paid'),
           ('pending', 'cancelled'),
           ('awaiting_payment', 'paid'),
           ('awaiting_payment', 'cancelled'),
           ('awaiting_payment', 'expired'),
           ('paid', 'packed'),
           ('paid', 'refunded'),
           ('packed', 'shipped'),
           ('packed', 'refunded'),
           ('shipped', 'delivered'),
           ('shipped', 'refunded'),
           ('delivered', 'refunded'),
           ('expired', 'refunded')
         ) as t(f, t)
         where t.f = v_order.status and t.t = p_status
       )
       -- is not distinct from: a NULL flag must make this false, not NULL (NOT NULL is NULL, which would allow the move).
       or (v_order.status = 'cancelled' and p_status = 'refunded' and v_order.payment_flag is not distinct from 'refund_due')
     )
  then
    return jsonb_build_object(
      'ok', false,
      'reason', 'bad_transition',
      'from', v_order.status,
      'to', p_status,
      'order', public.order_json(v_order)
    );
  end if;

  if p_status in ('cancelled', 'expired') then
    perform public.order_return_stock(v_order.lines);
  end if;

  update public.orders
  set status = p_status,
      paid_at = case when p_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
      expires_at = case
        when p_status in ('paid', 'packed', 'shipped', 'delivered', 'refunded') then null
        else expires_at
      end,
      payment_flag = case
        when p_status = 'refunded' and payment_flag = 'refund_due' then null
        else payment_flag
      end
  where id = p_id
  returning * into v_order;

  return jsonb_build_object('ok', true, 'changed', true, 'order', public.order_json(v_order));
end;
$$;

-- ---------------------------------------------------------------------------
-- set_order_tracking: store the courier, tracking number and tracking link of
-- an order that is packed or shipped. p_tracking is a JSON object with any of
-- courier, number, url:
--   * a key that is missing keeps the stored value;
--   * a string is trimmed, and an empty or null value clears the field.
-- The edge function validates the text (length, https link) before it gets
-- here; this function only stores it. Returns one of:
--   {ok:true,  order:{...}}
--   {ok:false, reason:'not_found'}
--   {ok:false, reason:'bad_status', order:{...}}   not packed or shipped
-- Lock order: the order row only.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_tracking(p_id uuid, p_tracking jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_t jsonb := case when jsonb_typeof(p_tracking) = 'object' then p_tracking else '{}'::jsonb end;
begin
  select * into v_order from public.orders where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_order.status not in ('packed', 'shipped') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status', 'order', public.order_json(v_order));
  end if;

  update public.orders
  set tracking_courier = case when v_t ? 'courier' then nullif(btrim(v_t ->> 'courier'), '') else tracking_courier end,
      tracking_number = case when v_t ? 'number' then nullif(btrim(v_t ->> 'number'), '') else tracking_number end,
      tracking_url = case when v_t ? 'url' then nullif(btrim(v_t ->> 'url'), '') else tracking_url end
  where id = p_id
  returning * into v_order;

  return jsonb_build_object('ok', true, 'order', public.order_json(v_order));
end;
$$;

-- ---------------------------------------------------------------------------
-- extend_order: give a pending order that is still waiting 48 more hours:
--   expires_at = greatest(expires_at, now()) + 48 hours
-- so an order whose time is up but which the expiry job has not reached yet
-- gets a full 48 hours from now, and one with time left gets 48 hours added.
-- Only a pending order with an expires_at (an order from before expiry existed
-- has none and is never touched by the job). Returns one of:
--   {ok:true,  order:{...}}
--   {ok:false, reason:'not_found'}
--   {ok:false, reason:'not_extendable', order:{...}}
-- Lock order: the order row only, the same row expire_one_order locks, so the
-- two cannot both win.
-- ---------------------------------------------------------------------------
create or replace function public.extend_order(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_order.status <> 'pending' or v_order.expires_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_extendable', 'order', public.order_json(v_order));
  end if;

  update public.orders
  set expires_at = greatest(expires_at, now()) + interval '48 hours'
  where id = p_id
  returning * into v_order;

  return jsonb_build_object('ok', true, 'order', public.order_json(v_order));
end;
$$;

-- ---------------------------------------------------------------------------
-- Order lookup: a customer finds their order id from its reference and phone.
-- order_lookup_log is like order_ip_log (place_order_v3): the address is kept
-- only as a salted SHA-256 hash (the salt is order_rate_salt's), and rows older
-- than an hour are deleted. Service role only (RLS on, no policies).
-- ---------------------------------------------------------------------------
create table if not exists public.order_lookup_log (
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists order_lookup_log_hash_created_idx on public.order_lookup_log (ip_hash, created_at);
create index if not exists order_lookup_log_created_idx on public.order_lookup_log (created_at);

alter table public.order_lookup_log enable row level security;
revoke all on table public.order_lookup_log from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- lookup_order: find the id of the newest order whose reference is p_ref
-- (8 characters, any case) and whose customer phone matches p_phone. Phones
-- match by their digits, comparing the LAST 9 digits only, so 0821234567 and
-- +27 82 123 4567 are the same number. A phone with fewer than 7 digits never
-- matches. Returns one of:
--   {ok:true,  id:'...'}
--   {ok:false, reason:'not_found'}      wrong reference, wrong phone, or either
--                                       malformed: the same answer for all
--   {ok:false, reason:'rate_limited'}   10 lookups from this address in the
--                                       last hour already
-- p_ip is the caller's address; with no address there is no limit. Every
-- lookup counts, found or not. A refused one is not logged, so it does not
-- extend the wait. The count and insert run under a per-address advisory
-- lock (a different key from place_order_v3's), which is the only lock taken.
-- Old rows of other addresses are cleaned up a few at a time, skipping any
-- row another call has locked, so two calls never wait on each other here.
-- ---------------------------------------------------------------------------
create or replace function public.lookup_order(p_ref text, p_phone text, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text := nullif(btrim(p_ip), '');
  v_ref text := upper(btrim(coalesce(p_ref, '')));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_salt text;
  v_hash text;
  v_count int;
  v_id uuid;
begin
  if v_ip is not null then
    select salt into v_salt from public.order_rate_salt where id;
    if v_salt is null then
      insert into public.order_rate_salt (id) values (true) on conflict do nothing;
      select salt into v_salt from public.order_rate_salt where id;
    end if;
    v_hash := encode(sha256(convert_to(v_salt || v_ip, 'UTF8')), 'hex');
    perform pg_advisory_xact_lock(hashtextextended('order_lookup:' || v_hash, 0));
    delete from public.order_lookup_log
    where ip_hash = v_hash and created_at <= now() - interval '1 hour';
    select count(*) into v_count
    from public.order_lookup_log
    where ip_hash = v_hash and created_at > now() - interval '1 hour';
    if v_count >= 10 then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
    insert into public.order_lookup_log (ip_hash) values (v_hash);

    delete from public.order_lookup_log
    where ctid in (
      select l.ctid from public.order_lookup_log l
      where l.created_at <= now() - interval '1 hour'
      limit 200
      for update skip locked
    );
  end if;

  if char_length(v_ref) <> 8 or char_length(v_digits) < 7 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select o.id into v_id
  from public.orders o
  where upper(o.ref) = v_ref
    and right(regexp_replace(coalesce(o.customer ->> 'phone', ''), '\D', '', 'g'), 9) = right(v_digits, 9)
  order by o.created_at desc, o.id
  limit 1;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Only the edge function (service role) may call these.
-- ---------------------------------------------------------------------------
revoke execute on function public.set_order_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_order_status(uuid, text, text) to service_role;

revoke execute on function public.set_order_tracking(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_order_tracking(uuid, jsonb) to service_role;

revoke execute on function public.extend_order(uuid) from public, anon, authenticated;
grant execute on function public.extend_order(uuid) to service_role;

revoke execute on function public.lookup_order(text, text, text) from public, anon, authenticated;
grant execute on function public.lookup_order(text, text, text) to service_role;
