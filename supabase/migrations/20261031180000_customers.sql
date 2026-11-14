-- Customer list for the owner (admin, read-only), built from existing orders. Additive and safe to re-run: one
-- function, created with "create or replace", no table, and no existing function is changed.
--
-- list_customers: every order is grouped by the customer's phone number. Phones are compared exactly as lookup_order
-- compares them (20261031100000_order_fulfilment.sql): the digits only, the LAST 9 digits, so 0821234567,
-- 082 123 4567 and +27 82 123 4567 are one customer. The expression is copied inline from lookup_order.
-- Each customer is {phone, name, email, orders, spent, lastOrderAt, subscribed}:
--   phone        as written on the most recent order (ties on created_at: the lower id, as lookup_order picks)
--   name         from the most recent order
--   email        from the most recent order that has one (blank counts as none), else null
--   orders       orders whose status is not cancelled and not expired
--   spent        sum of total for paid, packed, shipped and delivered (refunded does not count), trim_scale
--   lastOrderAt  newest created_at of any of their orders
--   subscribed   true when a subscribers row with the same phone (same last 9 digits, at least 7 digits) has
--                unsubscribed_at null. Phone only: an email match does not count.
-- A person with only cancelled or expired orders still appears, with orders 0. Ordered by lastOrderAt descending, then
-- phone (byte order). Only service_role may call it.

create or replace function public.list_customers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with o as (
    select
      ord.id,
      ord.created_at,
      ord.status,
      ord.total,
      ord.customer ->> 'phone' as phone,
      ord.customer ->> 'name' as name,
      nullif(btrim(coalesce(ord.customer ->> 'email', '')), '') as email,
      right(regexp_replace(coalesce(ord.customer ->> 'phone', ''), '\D', '', 'g'), 9) as k
    from public.orders ord
  ),
  g as (
    select
      o.k,
      (array_agg(o.phone order by o.created_at desc, o.id))[1] as phone,
      (array_agg(o.name order by o.created_at desc, o.id))[1] as name,
      (array_agg(o.email order by o.created_at desc, o.id) filter (where o.email is not null))[1] as email,
      count(*) filter (where o.status not in ('cancelled', 'expired')) as orders,
      coalesce(sum(o.total) filter (where o.status in ('paid', 'packed', 'shipped', 'delivered')), 0) as spent,
      max(o.created_at) as last_at
    from o
    group by o.k
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'phone', g.phone,
        'name', g.name,
        'email', g.email,
        'orders', g.orders,
        'spent', trim_scale(g.spent),
        'lastOrderAt', g.last_at,
        'subscribed', char_length(g.k) >= 7 and exists (
          select 1
          from public.subscribers s
          where s.unsubscribed_at is null
            and right(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), 9) = g.k
        )
      )
      order by g.last_at desc, g.phone collate "C"
    ),
    '[]'::jsonb
  )
  from g
$$;

revoke execute on function public.list_customers() from public, anon, authenticated;
grant execute on function public.list_customers() to service_role;
