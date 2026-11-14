-- Order data and lifecycle for the 4Nguru storefront edge function (section 1
-- of the delivery / online payment work). Safe to re-run: every statement is
-- idempotent.
--
-- This migration only ADDS columns and widens the status check, so the orders
-- already stored keep working: their new columns are NULL (delivery_fee is 0).
-- place_order, cancel_order and place_order_v2 are left exactly as they are.
-- cancel_order_v2 keeps its signature and its return shape (the order JSON, or
-- SQL NULL for an unknown order); it now delegates to set_order_status, so it
-- also cancels an order that is awaiting_payment. order_json keeps every old
-- key and adds the new ones, so the deployed edge function keeps working
-- between this migration and the next deploy.
--
-- Status meanings:
--   pending           the customer pays on WhatsApp.
--   awaiting_payment  an online payment has been started and is not confirmed.
--   paid, packed, shipped, delivered   the usual path after payment.
--   cancelled, expired                 the order will not go ahead; stock is back.
--   refunded                           the money went back; stock is NOT restored.
-- `total` includes delivery_fee.
--
-- LOCK ORDER is written at the top of 20261030000000_catalogue.sql: the order
-- row, then the variant rows by id. set_order_status takes the order row and
-- then order_return_stock takes the variants, in that order.

-- ---------------------------------------------------------------------------
-- New columns.
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists expires_at timestamptz;
alter table public.orders add column if not exists delivery_method text;
alter table public.orders add column if not exists delivery_address jsonb;
alter table public.orders add column if not exists delivery_locker text;
alter table public.orders add column if not exists delivery_fee numeric(12, 2) not null default 0;
alter table public.orders add column if not exists payment_method text
  check (payment_method in ('whatsapp', 'online'));
alter table public.orders add column if not exists payment_reference text;
alter table public.orders add column if not exists payment_url text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists payment_flag text
  check (payment_flag in ('amount_mismatch', 'refund_due'));
alter table public.orders add column if not exists tracking_courier text;
alter table public.orders add column if not exists tracking_number text;
alter table public.orders add column if not exists tracking_url text;

create unique index if not exists orders_payment_reference_key
  on public.orders (payment_reference) where payment_reference is not null;

-- The expiry job looks for due orders that are still waiting.
create index if not exists orders_expires_at_idx
  on public.orders (expires_at)
  where status in ('pending', 'awaiting_payment') and expires_at is not null;

-- Widen the status check (dropping it first is what makes this re-runnable).
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (
  status in (
    'pending', 'cancelled', 'awaiting_payment', 'paid', 'packed', 'shipped', 'delivered', 'expired', 'refunded'
  )
);

-- ---------------------------------------------------------------------------
-- order_json: one order row as the JSON shape of the TypeScript `Order` type.
-- The old keys are unchanged. New keys are JSON null when empty. payment_url
-- and payment_reference are never exposed.
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
    end
  );
$$;

-- ---------------------------------------------------------------------------
-- order_return_stock: put the stock of an order's lines back. Internal helper;
-- the caller already holds the order row (lock order: the order row, then the
-- variants of the products on the order, ordered by id).
-- Where each line's stock goes:
--   * a line with variantId whose variant still exists: that variant;
--   * any other line (an older line without variantId, or one whose variant has
--     since been deleted, for example when an admin dropped that size): the
--     variant with the line's exact size and colour, otherwise the product's
--     first variant (size then colour order);
--   * a line whose product has been deleted is skipped.
-- This is the logic that used to sit inside cancel_order_v2.
-- ---------------------------------------------------------------------------
create or replace function public.order_return_stock(p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.product_variants
  where product_id in (
    select l ->> 'productId' from jsonb_array_elements(p_lines) as l
  )
  order by id
  for update;

  update public.product_variants v
  set stock = v.stock + d.qty
  from (
    select t.vid, sum(t.qty) as qty
    from (
      select
        coalesce(
          (
            select pv.id from public.product_variants pv
            where pv.id::text = nullif(l ->> 'variantId', '')
          ),
          (
            select pv.id
            from public.product_variants pv
            where pv.product_id = l ->> 'productId'
              and pv.size = coalesce(l ->> 'size', '')
              and pv.color = coalesce(l ->> 'color', '')
          ),
          (
            select pv.id
            from public.product_variants pv
            join public.products p on p.id = pv.product_id
            where pv.product_id = l ->> 'productId'
            order by public.catalogue_pos(p.sizes, pv.size), public.catalogue_pos(p.colors, pv.color), pv.id
            limit 1
          )
        ) as vid,
        (l ->> 'quantity')::int as qty
      from jsonb_array_elements(p_lines) as l
    ) t
    where t.vid is not null
    group by t.vid
  ) d
  where v.id = d.vid;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_order_status: move an order to a new status. Returns one of:
--   {ok:true,  changed:bool, order:{...}}
--   {ok:false, reason:'not_found'}
--   {ok:false, reason:'bad_transition', from, to, order:{...}}
-- Allowed moves (from -> to):
--   pending           -> paid, cancelled
--   awaiting_payment  -> paid, cancelled, expired
--   paid              -> packed, refunded
--   packed            -> shipped, refunded
--   shipped           -> delivered, refunded
--   delivered         -> refunded
--   expired           -> refunded
--   cancelled, refunded -> nothing
-- `pending -> expired` is not allowed: the expiry job cancels due pending orders.
-- The order already has the requested status (and p_from is null or equal to
-- it): nothing changes, changed is false. p_from, when given, has to equal the
-- current status or the call is a bad_transition (a compare-and-set guard).
-- Side effects of a change:
--   * to cancelled or expired: the stock goes back (order_return_stock), once,
--     because neither status can be left except expired -> refunded;
--   * to paid: paid_at = coalesce(paid_at, now());
--   * to paid, packed, shipped, delivered or refunded: expires_at is cleared.
-- Refunding NEVER returns stock: the goods may already have shipped, so the
-- owner adjusts stock by hand when they come back.
-- Lock order: the order row, then the variants (inside order_return_stock).
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
     or not exists (
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
      end
  where id = p_id
  returning * into v_order;

  return jsonb_build_object('ok', true, 'changed', true, 'order', public.order_json(v_order));
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_order_v2: cancel an order and put its stock back. Same signature and
-- return shape as before: the order JSON, or SQL NULL when the order does not
-- exist. An order that cannot be cancelled (already cancelled, paid, ...) is
-- returned unchanged. Now also cancels an order that is awaiting_payment.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order_v2(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  v_res := public.set_order_status(p_id, 'cancelled');
  if v_res ->> 'reason' = 'not_found' then
    return null;
  end if;
  return v_res -> 'order';
end;
$$;

-- ---------------------------------------------------------------------------
-- Only the edge function (service role) may call these.
-- ---------------------------------------------------------------------------
revoke execute on function public.order_json(public.orders) from public, anon, authenticated;
grant execute on function public.order_json(public.orders) to service_role;

revoke execute on function public.order_return_stock(jsonb) from public, anon, authenticated;
grant execute on function public.order_return_stock(jsonb) to service_role;

revoke execute on function public.set_order_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_order_status(uuid, text, text) to service_role;

revoke execute on function public.cancel_order_v2(uuid) from public, anon, authenticated;
grant execute on function public.cancel_order_v2(uuid) to service_role;
