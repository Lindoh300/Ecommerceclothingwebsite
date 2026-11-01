-- Discount codes for the 4Nguru storefront edge function. Safe to re-run, and safe while the current edge function
-- is running: it only adds tables, columns, functions and one trigger. place_order_v3, place_order_v2 and every other
-- existing function keep working exactly as before; the one function replaced is order_json, which keeps its old keys
-- and gains two (discountCode, discountAmount). Apply this migration BEFORE deploying the edge function that calls
-- place_order_v4.
--
-- The owner manages codes (list_discounts, upsert_discount); an order can carry one code; the server works out the
-- discount. A code is never deleted, the owner turns it off.
--
--   discount_codes        code (upper case, unique), kind percent or fixed, value, min_spend, expires_at, max_uses,
--                         uses, active.
--   orders.discount_id    the code row (NO foreign key, so a code row can never block anything), plus the code text
--   orders.discount_code  and the amount taken off, kept on the order as they were when it was placed.
--   orders.discount_amount
--
-- The rule (discount_rule, the only place it is written; discount_preview, check_discount and place_order_v4 all call
-- it). "goods" means total - delivery_fee; delivery is never discounted.
--   * an unknown code, active = false, expires_at <= now(), or max_uses reached (uses >= max_uses): reason
--     'discount_invalid'. One reason for all four on purpose, so a guesser learns nothing.
--   * goods < min_spend: reason 'discount_minimum' (the result includes minSpend).
--   * percent: round(goods * value / 100, 2). fixed: least(value, goods).
--
-- place_order_v4(p_id, p_items, p_customer, p_opts) is built ON TOP of place_order_v3, which is not changed. With no
-- p_opts.discountCode it IS place_order_v3. With a code it first takes one of the client address's 20 code attempts an
-- hour (below), then calls v3 inside a sub-block; if v3 is not ok, or created is false (an idempotent replay), v3's
-- result is returned untouched, so a replay never spends a use or discounts twice.
-- Then it locks the code row (the LAST lock), applies the rule, and on any failure raises the sqlstate NG409 so the
-- block's handler undoes everything v3 did (stock, order row, rate log row) and returns the failure. An online order
-- that would reach a total of 0 or less fails the same way (discount_invalid): Paystack cannot take a zero amount. A
-- WhatsApp order may reach zero.
--
-- LOCK ORDER (extends the one at the top of 20261030000000_catalogue.sql): the order row, then the variant rows by
-- id, then the products row, then the per-address advisory lock taken last by place_order_v3, and now the
-- discount_codes row after all of those. The code row MUST come last: set_order_status holds the variants BEFORE it
-- updates the order row, and that update fires the trigger below, which updates the code row. (cancel_order_v2 only
-- calls set_order_status; expire_one_order and record_payment follow the same order.) If place_order_v4 took the code
-- row before calling v3, it would hold the code and wait for the variants while a cancel held the variants and waited
-- for the code. A transaction that holds the code row never waits for anything else, so it cannot be part of a circle.
-- There is one more lock, the per-address CODE-CHECK advisory lock ('discount_check:' + hash). It is taken FIRST in
-- place_order_v4 when a code is sent (before any other lock, while the transaction holds nothing), and by check_discount
-- (which takes no other lock). It is held to the end of the transaction and is only ever taken by those two callers. A
-- transaction waiting for it therefore holds no other lock, so nothing it waits for can be waiting for something it
-- holds: it cannot be part of a circle. Different from v3's 'order_ip:' lock, which is still taken later and last.
--
-- Code guessing: a failed code in place_order_v4 rolls back the order's own rate log row (NG409, as for v3), so on its
-- own that would let someone try unlimited codes through POST /orders and never meet the limit of check_discount.
-- Both therefore take their attempt from the same helper, discount_attempt_allowed(p_ip): 20 per client address per
-- rolling hour, shared between orders and checks. In place_order_v4 the helper runs BEFORE the sub-block, so its log
-- row survives the rollback. It is skipped when the order id already exists (an idempotent replay is never limited or
-- counted) and when no address is passed (the owner's orders and calls without an address stay unlimited). An attempt
-- is counted before anything else is looked at, so a code sent with an order that then fails on stock or delivery still
-- used one attempt. Over the limit the answer is {ok:false, reason:'rate_limited'} and nothing is done.
--
-- Giving a use back is a trigger on orders (AFTER UPDATE OF status), not code in the functions, so cancel_order_v2,
-- set_order_status, expire_one_order and record_payment are all covered and none of them changes:
--   * into cancelled or expired from any other status: uses = greatest(uses - 1, 0);
--   * out of cancelled or expired into any status other than those two and refunded (a late payment): uses + 1, with
--     no max_uses check, because that money has already been taken;
--   * cancelled or expired -> refunded changes nothing.
-- A code row that no longer exists is a no-op.
--
-- check_discount(p_code, p_goods, p_ip) is the public check: 20 attempts per client address per rolling hour (shared
-- with orders sent with a code, see above). The address is stored only as a salted SHA-256 hash (order_rate_salt, like
-- place_order_v3), rows older than an hour are deleted, and no address is ever written raw. No address, no limit. A
-- refused attempt is not logged.
--
-- All functions: security definer, search_path = public, execute for service_role only.

-- ---------------------------------------------------------------------------
-- Tables and columns.
-- ---------------------------------------------------------------------------
create table if not exists public.discount_codes (
  id uuid primary key,
  code text not null unique check (code = upper(code)),
  kind text not null check (kind in ('percent', 'fixed')),
  value numeric(12, 2) not null check (value > 0),
  min_spend numeric(12, 2) not null default 0 check (min_spend >= 0),
  expires_at timestamptz,
  max_uses int check (max_uses > 0),
  uses int not null default 0 check (uses >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint discount_codes_percent_max check (kind <> 'percent' or value <= 100)
);

alter table public.discount_codes enable row level security;
revoke all on table public.discount_codes from public, anon, authenticated;

alter table public.orders add column if not exists discount_id uuid;
alter table public.orders add column if not exists discount_code text;
alter table public.orders add column if not exists discount_amount numeric(12, 2) not null default 0;

create table if not exists public.discount_check_log (
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists discount_check_log_hash_created_idx on public.discount_check_log (ip_hash, created_at);

alter table public.discount_check_log enable row level security;
revoke all on table public.discount_check_log from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- order_json: the current content (20261030100000_order_lifecycle.sql) plus discountCode and discountAmount.
-- ---------------------------------------------------------------------------
create or replace function public.order_json(o public.orders)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', o.id,
    'ref', o.ref,
    'createdAt', o.created_at,
    'status', o.status,
    'lines', o.lines,
    'total', o.total,
    'customer', o.customer,
    'deliveryFee', o.delivery_fee,
    'delivery', case
      when o.delivery_method is null then null
      else jsonb_build_object('method', o.delivery_method, 'fee', o.delivery_fee)
        || case when o.delivery_address is null then '{}'::jsonb else jsonb_build_object('address', o.delivery_address) end
        || case when o.delivery_locker is null then '{}'::jsonb else jsonb_build_object('locker', o.delivery_locker) end
    end,
    'paymentMethod', o.payment_method,
    'paymentFlag', o.payment_flag,
    'paidAt', o.paid_at,
    'expiresAt', o.expires_at,
    'tracking', case
      when o.tracking_courier is null and o.tracking_number is null and o.tracking_url is null then null
      else jsonb_build_object(
        'courier', o.tracking_courier,
        'number', o.tracking_number,
        'url', o.tracking_url
      )
    end,
    'discountCode', o.discount_code,
    'discountAmount', trim_scale(o.discount_amount)
  );
$$;

revoke execute on function public.order_json(public.orders) from public, anon, authenticated;
grant execute on function public.order_json(public.orders) to service_role;

-- ---------------------------------------------------------------------------
-- discount_rule: THE rule. Internal helper: a code row and the goods amount in, {ok:true, amount} or
-- {ok:false, reason:'discount_invalid'} or {ok:false, reason:'discount_minimum', minSpend} out. Reads nothing else
-- and locks nothing; the caller decides whether the row was locked.
-- ---------------------------------------------------------------------------
create or replace function public.discount_rule(d public.discount_codes, p_goods numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_goods numeric := greatest(coalesce(p_goods, 0), 0);
  v_amount numeric;
begin
  if not d.active
     or (d.expires_at is not null and d.expires_at <= now())
     or (d.max_uses is not null and d.uses >= d.max_uses)
  then
    return jsonb_build_object('ok', false, 'reason', 'discount_invalid');
  end if;

  if v_goods < d.min_spend then
    return jsonb_build_object('ok', false, 'reason', 'discount_minimum', 'minSpend', trim_scale(d.min_spend));
  end if;

  if d.kind = 'percent' then
    v_amount := round(v_goods * d.value / 100, 2);
  else
    v_amount := least(d.value, v_goods);
  end if;
  return jsonb_build_object('ok', true, 'amount', trim_scale(v_amount));
end;
$$;

-- ---------------------------------------------------------------------------
-- discount_preview: a pure read. No lock, no limit. {ok:true, code, amount} or {ok:false, reason[, minSpend]}.
-- ---------------------------------------------------------------------------
create or replace function public.discount_preview(p_code text, p_goods numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.discount_codes;
  v_rule jsonb;
begin
  select * into v_row
  from public.discount_codes
  where code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'discount_invalid');
  end if;

  v_rule := public.discount_rule(v_row, p_goods);
  if not (v_rule ->> 'ok')::boolean then
    return v_rule;
  end if;
  return jsonb_build_object('ok', true, 'code', v_row.code, 'amount', v_rule -> 'amount');
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order_v4: place_order_v3 plus an optional p_opts.discountCode (see the header).
-- ---------------------------------------------------------------------------
create or replace function public.place_order_v4(
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
  v_code text := case
    when jsonb_typeof(p_opts -> 'discountCode') = 'string' then nullif(upper(btrim(p_opts ->> 'discountCode')), '')
    else null
  end;
  v_ip text := case when jsonb_typeof(p_opts -> 'ip') = 'string' then nullif(btrim(p_opts ->> 'ip'), '') else null end;
  v_res jsonb;
  v_order public.orders;
  v_row public.discount_codes;
  v_rule jsonb;
  v_amount numeric;
  v_fail jsonb;
begin
  if v_code is null then
    return public.place_order_v3(p_id, p_items, p_customer, p_opts);
  end if;

  -- The code attempt limit, FIRST and OUTSIDE the sub-block below, so a failed code cannot roll its log row back. A
  -- replay (the order id already exists) is never limited or counted.
  if v_ip is not null
     and not exists (select 1 from public.orders where id = p_id)
     and not public.discount_attempt_allowed(v_ip)
  then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  begin
    v_res := public.place_order_v3(p_id, p_items, p_customer, p_opts);
    if not coalesce((v_res ->> 'ok')::boolean, false) or not coalesce((v_res ->> 'created')::boolean, false) then
      return v_res;
    end if;

    -- The code row is the LAST lock (see the header).
    select * into v_row from public.discount_codes where code = v_code for update;
    if not found then
      v_fail := jsonb_build_object('ok', false, 'reason', 'discount_invalid');
      raise exception 'discount code not usable' using errcode = 'NG409';
    end if;

    select * into v_order from public.orders where id = p_id;
    v_rule := public.discount_rule(v_row, v_order.total - v_order.delivery_fee);
    if not (v_rule ->> 'ok')::boolean then
      v_fail := v_rule;
      raise exception 'discount code not usable' using errcode = 'NG409';
    end if;

    v_amount := (v_rule ->> 'amount')::numeric;
    -- Paystack cannot take a zero amount, so an online order must keep a total above zero.
    if v_order.payment_method = 'online' and v_order.total - v_amount <= 0 then
      v_fail := jsonb_build_object('ok', false, 'reason', 'discount_invalid');
      raise exception 'discount code not usable' using errcode = 'NG409';
    end if;

    update public.orders
    set discount_id = v_row.id,
        discount_code = v_row.code,
        discount_amount = v_amount,
        total = total - v_amount
    where id = p_id
    returning * into v_order;

    update public.discount_codes set uses = uses + 1 where id = v_row.id;

    return jsonb_build_object('ok', true, 'created', true, 'order', public.order_json(v_order));
  exception
    when sqlstate 'NG409' then
      -- Leaving this block undoes everything v3 did: the stock, the order row and the rate log row. v_fail was set
      -- before the raise; plpgsql variables are not rolled back.
      return v_fail;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Giving a use back (see the header). A trigger so no order function has to change.
-- ---------------------------------------------------------------------------
create or replace function public.discount_release_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.discount_id is null or old.status is not distinct from new.status then
    return null;
  end if;

  if new.status in ('cancelled', 'expired') and old.status not in ('cancelled', 'expired') then
    update public.discount_codes set uses = greatest(uses - 1, 0) where id = old.discount_id;
  elsif old.status in ('cancelled', 'expired') and new.status not in ('cancelled', 'expired', 'refunded') then
    -- A late payment. The money is already taken, so there is no max_uses check.
    update public.discount_codes set uses = uses + 1 where id = old.discount_id;
  end if;
  return null;
end;
$$;

create or replace trigger orders_discount_use
  after update of status on public.orders
  for each row
  when (old.discount_id is not null and old.status is distinct from new.status)
  execute function public.discount_release_use();

-- ---------------------------------------------------------------------------
-- Admin: list_discounts and upsert_discount.
-- ---------------------------------------------------------------------------
create or replace function public.discount_json(d public.discount_codes)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', d.id,
    'code', d.code,
    'kind', d.kind,
    'value', trim_scale(d.value),
    'minSpend', trim_scale(d.min_spend),
    'expiresAt', d.expires_at,
    'maxUses', d.max_uses,
    'uses', d.uses,
    'active', d.active,
    'createdAt', d.created_at
  );
$$;

-- list_discounts: every code, newest first.
create or replace function public.list_discounts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.discount_json(d) order by d.created_at desc, d.id), '[]'::jsonb)
  from public.discount_codes d;
$$;

-- upsert_discount: creates or updates by id. Sets code, kind, value, min_spend, expires_at, max_uses and active from
-- p_input, never uses. A key missing from p_input takes its default (min_spend 0, expires_at and max_uses null,
-- active true); code, kind and value are required. The edge function has already checked the values; the table's
-- check constraints are the backstop and raise. A duplicate code is {ok:false, reason:'code_taken'}.
create or replace function public.upsert_discount(p_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.discount_codes;
begin
  insert into public.discount_codes (id, code, kind, value, min_spend, expires_at, max_uses, active)
  values (
    p_id,
    upper(btrim(p_input ->> 'code')),
    p_input ->> 'kind',
    (p_input ->> 'value')::numeric,
    coalesce((p_input ->> 'minSpend')::numeric, 0),
    nullif(p_input ->> 'expiresAt', '')::timestamptz,
    (p_input ->> 'maxUses')::int,
    coalesce((p_input ->> 'active')::boolean, true)
  )
  on conflict (id) do update
  set code = excluded.code,
      kind = excluded.kind,
      value = excluded.value,
      min_spend = excluded.min_spend,
      expires_at = excluded.expires_at,
      max_uses = excluded.max_uses,
      active = excluded.active
  returning * into v_row;

  return jsonb_build_object('ok', true, 'discount', public.discount_json(v_row));
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'code_taken');
end;
$$;

-- ---------------------------------------------------------------------------
-- discount_attempt_allowed: the one limit on trying codes, 20 per client address per rolling hour. Internal helper
-- for check_discount and place_order_v4. Returns true (and logs the attempt) when the address is under the limit;
-- false, logging nothing, when it is over. No address (null or blank): true, nothing logged. Takes only the advisory
-- lock, which makes count-then-insert for one address atomic (see the LOCK ORDER note in the header).
-- ---------------------------------------------------------------------------
create or replace function public.discount_attempt_allowed(p_ip text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text := nullif(btrim(coalesce(p_ip, '')), '');
  v_salt text;
  v_hash text;
  v_count int;
begin
  if v_ip is null then
    return true;
  end if;
  select salt into v_salt from public.order_rate_salt where id;
  if v_salt is null then
    insert into public.order_rate_salt (id) values (true) on conflict do nothing;
    select salt into v_salt from public.order_rate_salt where id;
  end if;
  v_hash := encode(sha256(convert_to(v_salt || v_ip, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('discount_check:' || v_hash, 0));
  delete from public.discount_check_log where created_at <= now() - interval '1 hour';
  select count(*) into v_count
  from public.discount_check_log
  where ip_hash = v_hash and created_at > now() - interval '1 hour';
  if v_count >= 20 then
    return false;
  end if;
  insert into public.discount_check_log (ip_hash) values (v_hash);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- check_discount: the public check, one attempt of the limit above.
-- ---------------------------------------------------------------------------
create or replace function public.check_discount(p_code text, p_goods numeric, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.discount_attempt_allowed(p_ip) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  return public.discount_preview(p_code, p_goods);
end;
$$;

-- ---------------------------------------------------------------------------
-- Only the edge function (service role) may call these.
-- ---------------------------------------------------------------------------
revoke execute on function public.discount_rule(public.discount_codes, numeric) from public, anon, authenticated;
grant execute on function public.discount_rule(public.discount_codes, numeric) to service_role;
revoke execute on function public.discount_preview(text, numeric) from public, anon, authenticated;
grant execute on function public.discount_preview(text, numeric) to service_role;
revoke execute on function public.place_order_v4(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.place_order_v4(uuid, jsonb, jsonb, jsonb) to service_role;
revoke execute on function public.discount_release_use() from public, anon, authenticated;
grant execute on function public.discount_release_use() to service_role;
revoke execute on function public.discount_json(public.discount_codes) from public, anon, authenticated;
grant execute on function public.discount_json(public.discount_codes) to service_role;
revoke execute on function public.list_discounts() from public, anon, authenticated;
grant execute on function public.list_discounts() to service_role;
revoke execute on function public.upsert_discount(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_discount(uuid, jsonb) to service_role;
revoke execute on function public.discount_attempt_allowed(text) from public, anon, authenticated;
grant execute on function public.discount_attempt_allowed(text) to service_role;
revoke execute on function public.check_discount(text, numeric, text) from public, anon, authenticated;
grant execute on function public.check_discount(text, numeric, text) to service_role;
