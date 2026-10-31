-- Payment links for the 4Nguru storefront edge function (Phase D, POST /admin/orders).
-- Safe to re-run: create or replace and grants only. Additive: nothing applied
-- earlier is edited.
--
-- An order the owner creates for a customer who pays online is a payment link
-- the customer opens later. place_order_v3 gives an awaiting_payment order 30
-- minutes, which is right at checkout and too short for a link sent on
-- WhatsApp. The edge function calls set_payment_window right after it creates
-- such an order, to hold its stock for longer (48 hours).
--
-- set_payment_window(p_id, p_hours): for an awaiting_payment order only,
--   expires_at = now() + p_hours hours
-- Any other status is refused and nothing changes. It is NOT idempotent by
-- itself (each call moves the expiry to now + p_hours), so the caller must call
-- it once, for a newly created order only. Returns one of:
--   {ok:true,  order:{...}}
--   {ok:false, reason:'not_found'}
--   {ok:false, reason:'bad_status', order:{...}}
-- p_hours must be 1 to 720 (30 days), else the function raises an exception.
-- The expiry job (expire_due_orders) is untouched: it expires the order when
-- the new time is up, and the stock goes back.
-- Lock order: the order row only (LOCK ORDER is written at the top of
-- 20261030000000_catalogue.sql), the same row expire_one_order locks, so the
-- two cannot both win.

create or replace function public.set_payment_window(p_id uuid, p_hours int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if p_hours is null or p_hours < 1 or p_hours > 720 then
    raise exception 'p_hours must be between 1 and 720';
  end if;

  select * into v_order from public.orders where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_order.status <> 'awaiting_payment' then
    return jsonb_build_object('ok', false, 'reason', 'bad_status', 'order', public.order_json(v_order));
  end if;

  update public.orders
  set expires_at = now() + make_interval(hours => p_hours)
  where id = p_id
  returning * into v_order;

  return jsonb_build_object('ok', true, 'order', public.order_json(v_order));
end;
$$;

-- Only the edge function (service role) may call it.
revoke execute on function public.set_payment_window(uuid, int) from public, anon, authenticated;
grant execute on function public.set_payment_window(uuid, int) to service_role;
