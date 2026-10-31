-- Online payment functions for the 4Nguru storefront edge function (section 3
-- of the delivery / online payment work). Safe to re-run: every statement is
-- create or replace, plus grants.
--
-- No new columns or tables: payment_method, payment_reference, payment_url,
-- paid_at and payment_flag come from 20261030100000_order_lifecycle.sql. This
-- file only adds functions, and none of the existing ones is changed.
--
--   get_order(id)            the order JSON (as order_json), or SQL NULL.
--   order_payment_info(id)   what the pay route needs: {id, ref, status, total,
--                            email, paymentUrl}, or SQL NULL. This is the only
--                            place payment_url is read out; it never goes into
--                            order_json.
--   attach_payment(id, ref, url)
--                            stores the payment reference and the checkout URL,
--                            once, while the order is awaiting_payment.
--   record_payment(ref, cents, currency)
--                            a payment was VERIFIED by the provider: mark the
--                            order paid, or flag it when something is wrong.
--
-- LOCK ORDER is written at the top of 20261030000000_catalogue.sql: the order
-- row, then the variant rows by id. record_payment finds its order by
-- payment_reference, locks that row, and only then (late payments only) locks
-- the variants of the products on the order with ONE "order by id for update"
-- query, before it reads any stock.

-- ---------------------------------------------------------------------------
-- get_order: one order as JSON, or NULL when there is no such order.
-- ---------------------------------------------------------------------------
create or replace function public.get_order(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.order_json(o) from public.orders o where o.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- order_payment_info: {id, ref, status, total, email, paymentUrl}, or NULL.
-- email and paymentUrl are JSON null when there is none.
-- ---------------------------------------------------------------------------
create or replace function public.order_payment_info(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', o.id,
    'ref', o.ref,
    'status', o.status,
    'total', trim_scale(o.total),
    'email', nullif(o.customer ->> 'email', ''),
    'paymentUrl', o.payment_url
  )
  from public.orders o
  where o.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- attach_payment: remember the provider reference and checkout URL of an order.
-- Under the order row lock, and only while the order is awaiting_payment.
--   true   the values are stored now, or were stored already (same values).
--   false  no such order, not awaiting_payment, empty values, or a different
--          reference or URL is already stored (the first one wins).
-- ---------------------------------------------------------------------------
create or replace function public.attach_payment(p_id uuid, p_reference text, p_url text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if coalesce(p_reference, '') = '' or coalesce(p_url, '') = '' then
    return false;
  end if;

  select * into v_order from public.orders where id = p_id for update;
  if not found or v_order.status <> 'awaiting_payment' then
    return false;
  end if;

  if v_order.payment_url is not null then
    return v_order.payment_reference is not distinct from p_reference and v_order.payment_url = p_url;
  end if;

  update public.orders
  set payment_reference = p_reference,
      payment_url = p_url
  where id = p_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_payment: the provider has VERIFIED a payment for p_reference, for
-- p_amount_cents in p_currency. The caller passes what the provider's verify
-- call returned, never the figures from a webhook body. Returns one of:
--   {ok:false, reason:'not_found'}         no order has this reference.
--   {ok:false, reason:'amount_mismatch'}   the amount is not round(total * 100)
--                                          or the currency is not ZAR. The order
--                                          is flagged payment_flag =
--                                          'amount_mismatch' (a refund_due flag
--                                          is kept) and nothing else changes.
--   {ok:true, changed:false, outcome:'already'}
--                                          already paid (paid, packed, shipped,
--                                          delivered or refunded), or already
--                                          flagged refund_due: nothing changes,
--                                          so a repeated delivery is harmless.
--   {ok:true, changed:true, outcome:'paid'}
--                                          pending or awaiting_payment -> paid
--                                          through set_order_status (paid_at set,
--                                          expires_at cleared; an earlier
--                                          amount_mismatch flag is cleared).
--   {ok:true, changed:true, outcome:'paid_late'}
--                                          the order had expired or been
--                                          cancelled (its stock is back on the
--                                          shelf) and every line's exact variant
--                                          still has enough stock: the stock is
--                                          taken again and the order is paid.
--   {ok:true, changed:true, outcome:'refund_due'}
--                                          expired or cancelled, and the stock
--                                          is gone (or a variant was deleted, or
--                                          a line has no variantId): stock and
--                                          status stay as they are, paid_at is
--                                          set and payment_flag = 'refund_due' so
--                                          the owner refunds the money.
-- The late path BYPASSES the transition table on purpose: expired and cancelled
-- orders have no way to 'paid' in set_order_status, but the customer's money
-- has arrived, so the order is revived here when it can be honoured. A late
-- line uses only its exact variant (variantId): no size / colour fallback,
-- because that could sell something other than what the customer paid for.
-- Lines on the same variant are summed. All lines or none: stock is only
-- taken when every line can be served.
-- It all runs under the one order row lock, so repeated calls change nothing.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(p_reference text, p_amount_cents bigint, p_currency text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_ok boolean;
begin
  if coalesce(p_reference, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- 1. The order row (payment_reference is never changed once set).
  select * into v_order from public.orders where payment_reference = p_reference for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- 2. The money must match the order exactly.
  if p_amount_cents is distinct from round(v_order.total * 100)::bigint
     or p_currency is distinct from 'ZAR'
  then
    update public.orders
    set payment_flag = coalesce(payment_flag, 'amount_mismatch')
    where id = v_order.id;
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  -- 3. Seen before.
  if v_order.status in ('paid', 'packed', 'shipped', 'delivered', 'refunded')
     or v_order.payment_flag = 'refund_due'
  then
    return jsonb_build_object('ok', true, 'changed', false, 'outcome', 'already');
  end if;

  -- 4. The normal case.
  if v_order.status in ('awaiting_payment', 'pending') then
    perform public.set_order_status(v_order.id, 'paid');
    -- The verified payment is correct, so an earlier mismatch flag no longer applies.
    update public.orders set payment_flag = null where id = v_order.id and payment_flag = 'amount_mismatch';
    return jsonb_build_object('ok', true, 'changed', true, 'outcome', 'paid');
  end if;

  -- 5. Late: expired or cancelled. Lock the variants of the products on the
  --    order (one query, ordered by id), then read their stock.
  perform 1
  from public.product_variants
  where product_id in (
    select l ->> 'productId' from jsonb_array_elements(v_order.lines) as l
  )
  order by id
  for update;

  select coalesce(bool_and(v.id is not null and v.stock >= d.qty), false)
  into v_ok
  from (
    select nullif(l ->> 'variantId', '') as vid, sum((l ->> 'quantity')::int) as qty
    from jsonb_array_elements(v_order.lines) as l
    group by 1
  ) d
  left join public.product_variants v on v.id::text = d.vid;

  if v_ok then
    update public.product_variants v
    set stock = v.stock - d.qty
    from (
      select nullif(l ->> 'variantId', '') as vid, sum((l ->> 'quantity')::int) as qty
      from jsonb_array_elements(v_order.lines) as l
      group by 1
    ) d
    where v.id::text = d.vid;

    update public.orders
    set status = 'paid',
        paid_at = coalesce(paid_at, now()),
        expires_at = null,
        payment_flag = null
    where id = v_order.id;
    return jsonb_build_object('ok', true, 'changed', true, 'outcome', 'paid_late');
  end if;

  update public.orders
  set paid_at = coalesce(paid_at, now()),
      payment_flag = 'refund_due'
  where id = v_order.id;
  return jsonb_build_object('ok', true, 'changed', true, 'outcome', 'refund_due');
end;
$$;

-- ---------------------------------------------------------------------------
-- Only the edge function (service role) may call these.
-- ---------------------------------------------------------------------------
revoke execute on function public.get_order(uuid) from public, anon, authenticated;
grant execute on function public.get_order(uuid) to service_role;

revoke execute on function public.order_payment_info(uuid) from public, anon, authenticated;
grant execute on function public.order_payment_info(uuid) to service_role;

revoke execute on function public.attach_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.attach_payment(uuid, text, text) to service_role;

revoke execute on function public.record_payment(text, bigint, text) from public, anon, authenticated;
grant execute on function public.record_payment(text, bigint, text) to service_role;
