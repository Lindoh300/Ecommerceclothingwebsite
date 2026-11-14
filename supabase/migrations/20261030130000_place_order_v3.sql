-- place_order_v3 for the 4Nguru storefront edge function (section 2 of the
-- delivery / online payment work). Safe to re-run.
--
-- It is built ON TOP of place_order_v2, which is not changed: v2 does the
-- idempotent replay, the variant locks, the stock check and the stock
-- decrement, and inserts the order. v3 then adds the delivery and payment
-- details to the order row it just created, in the same transaction, so a
-- failure anywhere leaves nothing changed (stock included).
--
-- p_opts (all optional):
--   delivery:      {method, address?, locker?}  method must be an ACTIVE row of
--                  delivery_options. The fee is read from that row; a fee in
--                  p_opts is never looked at.
--   paymentMethod: 'whatsapp' (default) or 'online'. Online orders start as
--                  awaiting_payment, the others as pending.
--   ip:            the caller's address (the edge function reads Cloudflare's
--                  cf-connecting-ip). Optional: with no ip there is no limit.
-- Returns what place_order_v2 returns, or {ok:false, reason:'unknown_delivery'},
-- or {ok:false, reason:'rate_limited'} (section 4, below).
-- An idempotent replay (created = false) is returned as v2 returned it, with no
-- changes, so the fee is never added twice.
-- Lock order is the one in 20261030000000_catalogue.sql: v2 takes the variants;
-- v3 then only updates the order row it inserted itself.
--
-- Section 4, abuse limits:
--   * expires_at: a pending order (paid on WhatsApp) lasts 48 hours, an
--     awaiting_payment order 30 minutes. expire_due_orders (below) cancels or
--     expires what is still waiting after that, and the stock goes back.
--   * At most 5 orders per client address per rolling hour. The address is
--     stored only as a salted SHA-256 hash (order_rate_salt, order_ip_log); the
--     raw address is never written anywhere. sha256() is core Postgres, so no
--     pgcrypto is needed. An order over the limit gets {ok:false,
--     reason:'rate_limited'} and NOTHING is kept: stock, order and log row are
--     all rolled back.
--   * The limit check is the LAST step, after v2 and the order update, for two
--     reasons. First, an idempotent replay and a stock rejection return before
--     it, so they never count. Second, the per-address advisory lock is the
--     last lock taken and is held to the end of the transaction, so a slow
--     caller never holds it while waiting on a variant or order lock (the
--     lock order stays: order row, variants by id, products row, advisory
--     lock). The advisory lock makes the count-then-insert for one address
--     atomic across concurrent orders.

-- ---------------------------------------------------------------------------
-- Rate limit tables. Service role only (RLS on, no policies).
-- ---------------------------------------------------------------------------
create table if not exists public.order_rate_salt (
  id boolean primary key default true check (id),
  salt text not null default gen_random_uuid()::text || gen_random_uuid()::text
);

insert into public.order_rate_salt (id) values (true) on conflict do nothing;

create table if not exists public.order_ip_log (
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists order_ip_log_hash_created_idx on public.order_ip_log (ip_hash, created_at);

alter table public.order_rate_salt enable row level security;
alter table public.order_ip_log enable row level security;
revoke all on table public.order_rate_salt from public, anon, authenticated;
revoke all on table public.order_ip_log from public, anon, authenticated;

create or replace function public.place_order_v3(
  p_id uuid,
  p_items jsonb,
  p_customer jsonb,
  p_opts jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res jsonb;
  v_order public.orders;
  v_delivery jsonb := case when jsonb_typeof(p_opts -> 'delivery') = 'object' then p_opts -> 'delivery' else null end;
  v_opt public.delivery_options;
  v_payment text := coalesce(p_opts ->> 'paymentMethod', 'whatsapp');
  v_ip text := case when jsonb_typeof(p_opts -> 'ip') = 'string' then nullif(btrim(p_opts ->> 'ip'), '') else null end;
  v_salt text;
  v_hash text;
  v_count int;
begin
  -- Early, before any lock: an unknown or inactive delivery method.
  if v_delivery is not null then
    select * into v_opt
    from public.delivery_options
    where id = v_delivery ->> 'method' and active;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'unknown_delivery');
    end if;
  end if;

  begin
    v_res := public.place_order_v2(p_id, p_items, p_customer);
    if not coalesce((v_res ->> 'ok')::boolean, false) or not coalesce((v_res ->> 'created')::boolean, false) then
      return v_res;
    end if;

    update public.orders
    set delivery_method = v_opt.id,
        delivery_address = nullif(v_delivery -> 'address', 'null'::jsonb),
        delivery_locker = v_delivery ->> 'locker',
        delivery_fee = coalesce(v_opt.price, 0),
        total = total + coalesce(v_opt.price, 0),
        payment_method = v_payment,
        status = case when v_payment = 'online' then 'awaiting_payment' else status end,
        expires_at = now() + case when v_payment = 'online' then interval '30 minutes' else interval '48 hours' end
    where id = p_id
    returning * into v_order;

    -- The rate limit, last (see the header for why). No address, no check.
    if v_ip is not null then
      select salt into v_salt from public.order_rate_salt where id;
      if v_salt is null then
        insert into public.order_rate_salt (id) values (true) on conflict do nothing;
        select salt into v_salt from public.order_rate_salt where id;
      end if;
      v_hash := encode(sha256(convert_to(v_salt || v_ip, 'UTF8')), 'hex');
      perform pg_advisory_xact_lock(hashtextextended('order_ip:' || v_hash, 0));
      delete from public.order_ip_log
      where ip_hash = v_hash and created_at <= now() - interval '1 hour';
      select count(*) into v_count
      from public.order_ip_log
      where ip_hash = v_hash and created_at > now() - interval '1 hour';
      if v_count >= 5 then
        raise exception 'too many orders from this address' using errcode = 'NG429';
      end if;
      insert into public.order_ip_log (ip_hash) values (v_hash);
    end if;

    return jsonb_build_object('ok', true, 'created', true, 'order', public.order_json(v_order));
  exception
    when sqlstate 'NG429' then
      -- Leaving this block undoes everything it did: the stock v2 took, the
      -- order row and any log row.
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end;
end;
$$;

revoke execute on function public.place_order_v3(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.place_order_v3(uuid, jsonb, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Order expiry. expire_due_orders is run by pg_cron every five minutes (see
-- 20261030140000_order_expiry_cron.sql); it can also be called by hand.
--
-- It is split in two ON PURPOSE:
--   * expire_one_order is a SECURITY DEFINER function: it locks the order row,
--     rechecks that the order is still due, and goes through set_order_status
--     (which returns the stock under the catalogue lock order: order row, then
--     variants).
--   * expire_due_orders is a PROCEDURE that is NOT security definer and has no
--     SET clause, because Postgres forbids COMMIT inside a security definer
--     routine and inside one with a SET clause. It collects the due ids into an
--     array first, then handles each order in its own transaction: call
--     expire_one_order inside a begin/exception block (one failing order is
--     logged as a warning and does not stop the rest), then COMMIT. The COMMIT
--     releases that order's row and variant locks, so the variant locks of two
--     orders are never held together and the job cannot deadlock against
--     place_order_v3 or another order. All names are schema-qualified because
--     there is no SET search_path.
-- An order with a NULL expires_at (every order from before this migration) is
-- never touched; nothing is backfilled.
-- ---------------------------------------------------------------------------
create or replace function public.expire_one_order(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_res jsonb;
begin
  select * into v_order from public.orders where id = p_id for update;
  if not found
     or v_order.expires_at is null
     or v_order.expires_at > now()
     or v_order.status not in ('pending', 'awaiting_payment')
  then
    return 'skipped';
  end if;

  -- A due pending order is cancelled, a due awaiting_payment order expires.
  v_res := public.set_order_status(
    p_id,
    case when v_order.status = 'pending' then 'cancelled' else 'expired' end,
    v_order.status
  );
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    return 'skipped';
  end if;
  return v_res -> 'order' ->> 'status';
end;
$$;

create or replace procedure public.expire_due_orders()
language plpgsql
as $$
declare
  v_ids uuid[];
  v_id uuid;
begin
  select coalesce(array_agg(o.id order by o.expires_at, o.id), '{}'::uuid[]) into v_ids
  from public.orders o
  where o.status in ('pending', 'awaiting_payment')
    and o.expires_at is not null
    and o.expires_at <= now();

  foreach v_id in array v_ids loop
    begin
      perform public.expire_one_order(v_id);
    exception when others then
      raise warning 'expire_due_orders: order % failed: % (%)', v_id, sqlerrm, sqlstate;
    end;
    commit;
  end loop;

  -- Rate-limit rows older than an hour are of no use, for every address.
  delete from public.order_ip_log where created_at < now() - interval '1 hour';
end;
$$;

revoke execute on function public.expire_one_order(uuid) from public, anon, authenticated;
grant execute on function public.expire_one_order(uuid) to service_role;
revoke execute on procedure public.expire_due_orders() from public, anon, authenticated;
