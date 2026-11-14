-- Delivery options for the 4Nguru storefront edge function (section 2 of the
-- delivery / online payment work). Safe to re-run: every statement is
-- idempotent, and the seed never overwrites a price the owner has edited.
--
-- The delivery fee is ALWAYS read from this table by place_order_v3, never from
-- the request. Until the admin screens exist (Phase D) the rows are edited in
-- SQL. `active = false` hides an option from the shop and refuses it on orders.

create table if not exists public.delivery_options (
  id text primary key,
  name text not null,
  price numeric(12, 2) not null check (price >= 0),
  sort int not null default 0,
  active boolean not null default true
);

alter table public.delivery_options enable row level security;
revoke all on table public.delivery_options from public, anon, authenticated;

insert into public.delivery_options (id, name, price, sort) values
  ('door', 'Door delivery', 85, 1),
  ('locker', 'Locker', 55, 2),
  ('collect', 'Collect', 0, 3)
on conflict (id) do nothing;

-- list_delivery_options: the active options, in sort order, as [{id, name, price}].
create or replace function public.list_delivery_options()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', d.id, 'name', d.name, 'price', trim_scale(d.price))
      order by d.sort, d.id
    ),
    '[]'::jsonb
  )
  from public.delivery_options d
  where d.active;
$$;

-- Only the edge function (service role) may call this.
revoke execute on function public.list_delivery_options() from public, anon, authenticated;
grant execute on function public.list_delivery_options() to service_role;
