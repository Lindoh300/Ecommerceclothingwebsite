-- Orders and atomic stock handling for the 4Nguru storefront edge function.
-- Safe to re-run: every statement is idempotent.
--
-- Products live in public.kv_store_fbb8f0e1 as rows with key 'product:<id>' and
-- a jsonb value that includes name, price and stock. place_order and
-- cancel_order lock those rows, so stock can never be oversold.

-- ---------------------------------------------------------------------------
-- Orders table. Only the edge function (service role) can touch it.
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key,
  ref text not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'cancelled')),
  lines jsonb not null,
  total numeric(12, 2) not null,
  customer jsonb not null
);

alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;

-- ---------------------------------------------------------------------------
-- order_json: one order row as the JSON shape of the TypeScript `Order` type.
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
    'customer', o.customer
  );
$$;

-- ---------------------------------------------------------------------------
-- place_order: validate stock, decrement it and insert the order in one
-- transaction. p_items is an array of {productId, size?, color?, quantity}.
-- Returns one of:
--   {ok:true,  created:bool, order:{...}}
--   {ok:false, reason:'missing', missing:[productId,...]}
--   {ok:false, reason:'stock',   short:[{productId,name,requested,available},...]}
-- ---------------------------------------------------------------------------
create or replace function public.place_order(p_id uuid, p_items jsonb, p_customer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_req jsonb;
  v_missing jsonb;
  v_short jsonb;
  v_lines jsonb;
  v_total numeric(12, 2);
begin
  -- 1. Idempotent replay: the client-generated id already has an order.
  select * into v_order from public.orders where id = p_id;
  if found then
    return jsonb_build_object('ok', true, 'created', false, 'order', public.order_json(v_order));
  end if;

  -- 2. Lock every referenced product row, ordered by key so that two orders
  --    touching the same products always lock them in the same order.
  perform 1
  from public.kv_store_fbb8f0e1
  where key in (
    select 'product:' || (e ->> 'productId') from jsonb_array_elements(p_items) as e
  )
  order by key
  for update;

  -- 3. A concurrent call with the same id may have committed while we waited.
  select * into v_order from public.orders where id = p_id;
  if found then
    return jsonb_build_object('ok', true, 'created', false, 'order', public.order_json(v_order));
  end if;

  -- Requested quantity per product, summed across sizes and colours, in order
  -- of first appearance.
  select coalesce(jsonb_agg(jsonb_build_object('productId', g.pid, 'quantity', g.qty) order by g.first_ord), '[]'::jsonb)
  into v_req
  from (
    select t.e ->> 'productId' as pid,
           sum((t.e ->> 'quantity')::int) as qty,
           min(t.ord) as first_ord
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
    group by t.e ->> 'productId'
  ) g;

  -- 4. Unknown products.
  select coalesce(jsonb_agg(r.pid order by r.ord), '[]'::jsonb)
  into v_missing
  from (
    select q.e ->> 'productId' as pid, q.ord
    from jsonb_array_elements(v_req) with ordinality as q(e, ord)
  ) r
  left join public.kv_store_fbb8f0e1 k on k.key = 'product:' || r.pid
  where k.key is null;

  if jsonb_array_length(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing', 'missing', v_missing);
  end if;

  -- 5. Not enough stock: change nothing.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'productId', r.pid,
      'name', k.value ->> 'name',
      'requested', r.qty,
      'available', coalesce((k.value ->> 'stock')::int, 0)
    ) order by r.ord
  ), '[]'::jsonb)
  into v_short
  from (
    select q.e ->> 'productId' as pid, (q.e ->> 'quantity')::int as qty, q.ord
    from jsonb_array_elements(v_req) with ordinality as q(e, ord)
  ) r
  join public.kv_store_fbb8f0e1 k on k.key = 'product:' || r.pid
  where r.qty > coalesce((k.value ->> 'stock')::int, 0);

  if jsonb_array_length(v_short) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'stock', 'short', v_short);
  end if;

  -- 6. Build the order lines from the stored products (never from the request).
  select jsonb_agg(l.line order by l.ord), coalesce(sum(l.subtotal), 0)
  into v_lines, v_total
  from (
    select t.ord,
           (k.value ->> 'price')::numeric * (t.e ->> 'quantity')::int as subtotal,
           jsonb_strip_nulls(jsonb_build_object(
             'productId', t.e ->> 'productId',
             'name', k.value ->> 'name',
             'price', (k.value ->> 'price')::numeric,
             'size', t.e -> 'size',
             'color', t.e -> 'color',
             'quantity', (t.e ->> 'quantity')::int,
             'subtotal', (k.value ->> 'price')::numeric * (t.e ->> 'quantity')::int
           )) as line
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
    join public.kv_store_fbb8f0e1 k on k.key = 'product:' || (t.e ->> 'productId')
  ) l;

  -- Decrement stock and insert the order. If another transaction inserts the
  -- same order id in the meantime (different product set, so no shared lock),
  -- the unique violation rolls back this block, stock decrement included, and
  -- we return the existing order.
  begin
    update public.kv_store_fbb8f0e1 k
    set value = jsonb_set(
      k.value,
      '{stock}',
      to_jsonb(coalesce((k.value ->> 'stock')::int, 0) - d.qty)
    )
    from (
      select q ->> 'productId' as pid, (q ->> 'quantity')::int as qty
      from jsonb_array_elements(v_req) as q
    ) d
    where k.key = 'product:' || d.pid;

    insert into public.orders (id, ref, status, lines, total, customer)
    values (p_id, upper(left(p_id::text, 8)), 'pending', v_lines, v_total, p_customer)
    returning * into v_order;
  exception when unique_violation then
    select * into v_order from public.orders where id = p_id;
    return jsonb_build_object('ok', true, 'created', false, 'order', public.order_json(v_order));
  end;

  return jsonb_build_object('ok', true, 'created', true, 'order', public.order_json(v_order));
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_order: mark a pending order cancelled and put its stock back.
-- Returns the order JSON, or SQL NULL when the order does not exist.
-- An already-cancelled order is returned unchanged (stock is not restored again).
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(p_id uuid)
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
    return null;
  end if;

  if v_order.status = 'pending' then
    perform 1
    from public.kv_store_fbb8f0e1
    where key in (
      select 'product:' || (l ->> 'productId') from jsonb_array_elements(v_order.lines) as l
    )
    order by key
    for update;

    -- Products deleted since the order was placed simply do not match here.
    update public.kv_store_fbb8f0e1 k
    set value = jsonb_set(
      k.value,
      '{stock}',
      to_jsonb(coalesce((k.value ->> 'stock')::int, 0) + d.qty)
    )
    from (
      select l ->> 'productId' as pid, sum((l ->> 'quantity')::int) as qty
      from jsonb_array_elements(v_order.lines) as l
      group by l ->> 'productId'
    ) d
    where k.key = 'product:' || d.pid;

    update public.orders set status = 'cancelled' where id = p_id returning * into v_order;
  end if;

  return public.order_json(v_order);
end;
$$;

-- ---------------------------------------------------------------------------
-- Only the edge function (service role) may call these.
-- ---------------------------------------------------------------------------
revoke execute on function public.order_json(public.orders) from public, anon, authenticated;
grant execute on function public.order_json(public.orders) to service_role;

revoke execute on function public.place_order(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.place_order(uuid, jsonb, jsonb) to service_role;

revoke execute on function public.cancel_order(uuid) from public, anon, authenticated;
grant execute on function public.cancel_order(uuid) to service_role;
