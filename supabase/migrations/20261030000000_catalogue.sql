-- Relational catalogue with stock per size and colour for the 4Nguru storefront
-- edge function. Safe to re-run: every statement is idempotent.
--
-- This migration only ADDS things. The kv table (public.kv_store_fbb8f0e1), the
-- orders table and the functions place_order, cancel_order and update_product
-- are left exactly as they are, because the deployed edge function keeps using
-- them until it is switched over to the functions below.
--
-- Data model:
--   categories        one row per category.
--   products          one row per product, copied from the kv rows 'product:<id>'.
--   product_variants  one row per size x colour of a product, holding its stock.
--                     An empty sizes or colors list means '' for that dimension,
--                     so every product has at least one variant.
--
-- LOCK ORDER (every function below follows it, so two callers can never wait on
-- each other in a circle):
--   1. the orders row                      (place_order_v2, cancel_order_v2)
--   2. the variant rows of the products involved, ordered by id
--   3. the products row                    (only update_product_v2 and delete_product)
-- Variant rows are always locked with a single "order by id for update" query,
-- and always BEFORE anything is read that a decision depends on.
-- Later migrations extend the order: the order row, then variants by id, then
-- the products row, then the per-IP advisory lock taken last by place_order_v3;
-- expire_one_order and record_payment follow the same order; expire_due_orders
-- commits after each order so it never holds variant locks of two orders at once.

-- ---------------------------------------------------------------------------
-- Tables. Only the edge function (service role) can touch them.
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id text primary key,
  name text not null,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  slug text not null unique,
  name text not null,
  category_id text not null references public.categories (id) on update cascade,
  price numeric(12, 2) not null check (price >= 0),
  description text not null default '',
  images jsonb not null default '[]',
  sizes jsonb not null default '[]',
  colors jsonb not null default '[]',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products (id) on delete cascade,
  sku text not null unique,
  size text not null default '',
  color text not null default '',
  stock int not null default 0 check (stock >= 0),
  unique (product_id, size, color)
);

create index if not exists product_variants_product_id_idx on public.product_variants (product_id);
create index if not exists products_category_id_idx on public.products (category_id);

-- As with orders: RLS on, NO policies, nothing granted to the client roles.
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
revoke all on public.categories from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.product_variants from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers (catalogue_*). They are used by the functions further down
-- and are locked down like the rest.
-- ---------------------------------------------------------------------------

-- catalogue_list: a jsonb array of strings as a text[], without nulls, empty
-- strings or repeats, in order of first appearance. Anything that is not an
-- array gives the empty list.
create or replace function public.catalogue_list(p jsonb)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(s.val order by s.first_ord), '{}'::text[])
  from (
    select e.val, min(e.ord) as first_ord
    from jsonb_array_elements_text(
      case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end
    ) with ordinality as e(val, ord)
    where e.val is not null and e.val <> ''
    group by e.val
  ) s;
$$;

-- catalogue_pos: 1-based position of p_val in the jsonb array p_arr. A value
-- that is not in the list (including '' for "no sizes") sorts last.
create or replace function public.catalogue_pos(p_arr jsonb, p_val text)
returns int
language sql
immutable
set search_path = public
as $$
  select coalesce(
    (
      select e.ord::int
      from jsonb_array_elements_text(
        case when jsonb_typeof(p_arr) = 'array' then p_arr else '[]'::jsonb end
      ) with ordinality as e(val, ord)
      where e.val = p_val
      order by e.ord
      limit 1
    ),
    1000000
  );
$$;

-- catalogue_slug: lowercase name, runs of non-alphanumerics become one hyphen,
-- trimmed. A slug that another product already uses (as slug or as id) gets
-- -2, -3, ... p_exclude_id is the product the slug is for.
create or replace function public.catalogue_slug(p_name text, p_exclude_id text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_slug text;
  v_n int := 1;
begin
  v_base := btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then
    v_base := 'product';
  end if;
  v_slug := v_base;
  while exists (
    select 1 from public.products p
    where (p.slug = v_slug or p.id = v_slug) and p.id is distinct from p_exclude_id
  ) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;

-- catalogue_sku: upper('N' || first 8 characters of the id without hyphens ||
-- '-' || size || '-' || color), with non-alphanumerics removed from size and
-- colour. If the SKU is taken (for example sizes 'X-L' and 'XL' collapse to the
-- same text) a -2, -3, ... suffix is added.
create or replace function public.catalogue_sku(p_product_id text, p_size text, p_color text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_sku text;
  v_n int := 1;
begin
  v_base := upper(
    'N' || left(replace(p_product_id, '-', ''), 8)
    || '-' || regexp_replace(coalesce(p_size, ''), '[^A-Za-z0-9]', '', 'g')
    || '-' || regexp_replace(coalesce(p_color, ''), '[^A-Za-z0-9]', '', 'g')
  );
  v_sku := v_base;
  while exists (select 1 from public.product_variants v where v.sku = v_sku) loop
    v_n := v_n + 1;
    v_sku := v_base || '-' || v_n;
  end loop;
  return v_sku;
end;
$$;

-- catalogue_add_stock: add p_amount units to a product's variants, spread
-- evenly. The remainder goes one unit each to the first variants in size then
-- colour order. The caller holds the variant locks.
create or replace function public.catalogue_add_stock(p_product_id text, p_amount int)
returns void
language sql
security definer
set search_path = public
as $$
  with ranked as (
    select v.id,
           row_number() over (
             order by public.catalogue_pos(p.sizes, v.size), public.catalogue_pos(p.colors, v.color), v.id
           ) as rn,
           count(*) over () as n
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where v.product_id = p_product_id
  )
  update public.product_variants v
  set stock = v.stock + (p_amount / r.n)::int + case when r.rn <= p_amount % r.n then 1 else 0 end
  from ranked r
  where v.id = r.id;
$$;

-- catalogue_remove_stock: take p_amount units from a product's variants, always
-- from the ones with the most stock, so stock is levelled down rather than one
-- size being emptied. Never goes below zero. The caller holds the variant locks
-- and makes sure p_amount is not more than the product's total stock.
--   1. Binary search the lowest level M such that cutting every variant down
--      to M removes no more than p_amount units.
--   2. Cut every variant to M.
--   3. Take the units still owed, one each, from the first variants (size then
--      colour order) that sit at M. There are always more of those than owed.
create or replace function public.catalogue_remove_stock(p_product_id text, p_amount int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lo int := 0;
  v_hi int;
  v_mid int;
  v_cut bigint;
  v_owed bigint;
begin
  if p_amount <= 0 then
    return;
  end if;

  select coalesce(max(stock), 0) into v_hi from public.product_variants where product_id = p_product_id;

  while v_lo < v_hi loop
    v_mid := (v_lo + v_hi) / 2;
    select coalesce(sum(greatest(stock - v_mid, 0)), 0) into v_cut
    from public.product_variants where product_id = p_product_id;
    if v_cut <= p_amount then
      v_hi := v_mid;
    else
      v_lo := v_mid + 1;
    end if;
  end loop;

  select coalesce(sum(greatest(stock - v_lo, 0)), 0) into v_cut
  from public.product_variants where product_id = p_product_id;

  update public.product_variants set stock = least(stock, v_lo) where product_id = p_product_id;

  v_owed := p_amount - v_cut;
  if v_owed > 0 then
    update public.product_variants
    set stock = stock - 1
    where id in (
      select v.id
      from public.product_variants v
      join public.products p on p.id = v.product_id
      where v.product_id = p_product_id and v.stock = v_lo and v.stock > 0
      order by public.catalogue_pos(p.sizes, v.size), public.catalogue_pos(p.colors, v.color), v.id
      limit v_owed
    );
  end if;
end;
$$;

-- catalogue_seed_variants: create the missing size x colour variants of an
-- existing product (existing ones are left alone). Without p_given, p_stock is
-- split evenly over all the product's variants (see catalogue_add_stock). With
-- p_given, an array of {size, color, stock}, each listed combination gets that
-- stock, the others get 0, and p_stock is ignored. In p_given, '' and a missing
-- size or colour are the same thing.
create or replace function public.catalogue_seed_variants(p_product_id text, p_stock int, p_given jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products;
  v_sizes text[];
  v_colors text[];
  v_size text;
  v_color text;
  v_use_given boolean := coalesce(jsonb_typeof(p_given) = 'array' and jsonb_array_length(p_given) > 0, false);
  v_stock int;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then
    return;
  end if;

  v_sizes := public.catalogue_list(v_product.sizes);
  v_colors := public.catalogue_list(v_product.colors);
  if cardinality(v_sizes) = 0 then v_sizes := array['']; end if;
  if cardinality(v_colors) = 0 then v_colors := array['']; end if;

  foreach v_size in array v_sizes loop
    foreach v_color in array v_colors loop
      v_stock := 0;
      if v_use_given then
        select coalesce(max(greatest((g ->> 'stock')::int, 0)), 0) into v_stock
        from jsonb_array_elements(p_given) as g
        where coalesce(g ->> 'size', '') = v_size and coalesce(g ->> 'color', '') = v_color;
      end if;

      insert into public.product_variants (product_id, sku, size, color, stock)
      values (p_product_id, public.catalogue_sku(p_product_id, v_size, v_color), v_size, v_color, v_stock)
      on conflict (product_id, size, color) do nothing;
    end loop;
  end loop;

  if not v_use_given and coalesce(p_stock, 0) > 0 then
    perform public.catalogue_add_stock(p_product_id, p_stock);
  end if;
end;
$$;

-- catalogue_snapshot: [{id, stock}] for every variant of a product, in the
-- same order as product_json. Used in stock_changed answers.
create or replace function public.catalogue_snapshot(p_product_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', v.id, 'stock', v.stock)
      order by public.catalogue_pos(p.sizes, v.size), public.catalogue_pos(p.colors, v.color), v.id
    ),
    '[]'::jsonb
  )
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.product_id = p_product_id;
$$;

-- ---------------------------------------------------------------------------
-- Data copy: one products row per kv product, then its variants.
-- Idempotent: a product that already has a products row is skipped entirely,
-- so a re-run neither duplicates nor overwrites anything. Oldest products go
-- first, so the oldest one of two same-named products keeps the plain slug.
-- A bad price (missing, negative, not a number) fails the migration on purpose
-- rather than guessing a price.
-- ---------------------------------------------------------------------------
insert into public.categories (id, name, sort)
values
  ('tshirts', 'T-Shirts', 1),
  ('jerseys', 'Jerseys', 2),
  ('shorts', 'Shorts', 3),
  ('pants', 'Pants', 4),
  ('accessories', 'Accessories', 5)
on conflict (id) do nothing;

do $copy$
declare
  r record;
  v_category text;
  v_created timestamptz;
  v_images jsonb;
  v_stock int;
begin
  for r in
    select substr(k.key, 9) as id, k.value as v
    from public.kv_store_fbb8f0e1 k
    where k.key like 'product:%'
      and length(k.key) > 8
      and jsonb_typeof(k.value) = 'object'
      and not exists (select 1 from public.products p where p.id = substr(k.key, 9))
    order by k.value ->> 'createdAt', k.key
  loop
    -- A category that is not in the seed list is added with a tidy name.
    v_category := coalesce(nullif(btrim(r.v ->> 'category'), ''), 'uncategorised');
    insert into public.categories (id, name, sort)
    values (v_category, initcap(btrim(regexp_replace(v_category, '[-_[:space:]]+', ' ', 'g'))), 100)
    on conflict (id) do nothing;

    begin
      v_created := (r.v ->> 'createdAt')::timestamptz;
    exception when others then
      v_created := null;
    end;

    v_images := case when jsonb_typeof(r.v -> 'images') = 'array' then r.v -> 'images' else '[]'::jsonb end;
    -- Older rows may have only the derived `image`. Keep it as the first image.
    if jsonb_array_length(v_images) = 0 and coalesce(r.v ->> 'image', '') <> '' then
      v_images := jsonb_build_array(r.v ->> 'image');
    end if;

    v_stock := greatest(floor(coalesce((r.v ->> 'stock')::numeric, 0)), 0)::int;

    insert into public.products (id, slug, name, category_id, price, description, images, sizes, colors, created_at)
    values (
      r.id,
      public.catalogue_slug(r.v ->> 'name', r.id),
      coalesce(r.v ->> 'name', ''),
      v_category,
      (r.v ->> 'price')::numeric,
      coalesce(r.v ->> 'description', ''),
      v_images,
      to_jsonb(public.catalogue_list(r.v -> 'sizes')),
      to_jsonb(public.catalogue_list(r.v -> 'colors')),
      coalesce(v_created, now())
    );

    perform public.catalogue_seed_variants(r.id, v_stock);
  end loop;
end;
$copy$;

-- ---------------------------------------------------------------------------
-- product_json: one product as the camelCase JSON the API returns.
-- stock is the sum over variants. image is the first non-empty image or ''.
-- variants are ordered by position in sizes, then position in colors.
-- ---------------------------------------------------------------------------
create or replace function public.product_json(p public.products)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'slug', p.slug,
    'name', p.name,
    'category', p.category_id,
    'price', trim_scale(p.price),
    'description', p.description,
    'images', p.images,
    'image', coalesce(
      (
        select e.val
        from jsonb_array_elements_text(p.images) with ordinality as e(val, ord)
        where e.val <> ''
        order by e.ord
        limit 1
      ),
      ''
    ),
    'sizes', p.sizes,
    'colors', p.colors,
    'stock', coalesce((select sum(v.stock) from public.product_variants v where v.product_id = p.id), 0),
    'active', p.active,
    'createdAt', p.created_at,
    'variants', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', v.id, 'sku', v.sku, 'size', v.size, 'color', v.color, 'stock', v.stock)
          order by public.catalogue_pos(p.sizes, v.size), public.catalogue_pos(p.colors, v.color), v.id
        )
        from public.product_variants v
        where v.product_id = p.id
      ),
      '[]'::jsonb
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- list_products: JSON array, oldest first, id as the tie-break. Inactive
-- products are left out unless p_include_inactive is true.
-- get_product: one product by id or slug, or SQL NULL. An id match wins over a
-- slug match. Inactive products are returned too (the caller checks `active`).
-- ---------------------------------------------------------------------------
create or replace function public.list_products(p_include_inactive boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.product_json(p) order by p.created_at, p.id), '[]'::jsonb)
  from public.products p
  where p.active or p_include_inactive;
$$;

create or replace function public.get_product(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.product_json(p)
  from public.products p
  where p.id = p_key or p.slug = p_key
  order by (p.id = p_key) desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Categories.
-- list_categories: [{id,name,sort,active}] ordered by sort, then name.
-- upsert_category: insert or update by id; a null p_sort or p_active keeps the
--   stored value (0 and true for a new row). Returns the category JSON.
-- delete_category: {ok:true}, or {ok:false, reason:'in_use', count:n} while
--   products use it. The category row is locked first, so a product cannot be
--   created under it between the count and the delete.
-- ---------------------------------------------------------------------------
create or replace function public.list_categories(p_include_inactive boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', c.id, 'name', c.name, 'sort', c.sort, 'active', c.active)
      order by c.sort, c.name, c.id
    ),
    '[]'::jsonb
  )
  from public.categories c
  where c.active or p_include_inactive;
$$;

create or replace function public.upsert_category(p_id text, p_name text, p_sort int, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.categories;
begin
  insert into public.categories as c (id, name, sort, active)
  values (p_id, p_name, coalesce(p_sort, 0), coalesce(p_active, true))
  on conflict (id) do update set
    name = excluded.name,
    sort = coalesce(p_sort, c.sort),
    active = coalesce(p_active, c.active)
  returning * into v_cat;

  return jsonb_build_object('id', v_cat.id, 'name', v_cat.name, 'sort', v_cat.sort, 'active', v_cat.active);
end;
$$;

create or replace function public.delete_category(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform 1 from public.categories where id = p_id for update;

  select count(*) into v_count from public.products where category_id = p_id;
  if v_count > 0 then
    return jsonb_build_object('ok', false, 'reason', 'in_use', 'count', v_count);
  end if;

  delete from public.categories where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_product: p_input is {name, category, price, description, images,
-- sizes, colors, stock?, variants?:[{size,color,stock}]}. Creates a variant for
-- every size x colour. With variants, each listed combination gets its stock
-- and the others 0. Without, stock (default 0) is split evenly, the remainder
-- going one unit each to the first variants in size then colour order.
-- Returns {ok:true, product:{...}} or {ok:false, reason:'unknown_category'}.
-- An existing p_id raises a unique violation. Slugs are handed out under an
-- advisory lock, so two products created at once cannot take the same slug.
-- ---------------------------------------------------------------------------
create or replace function public.create_product(p_id text, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products;
  v_category text := p_input ->> 'category';
  v_stock int := 0;
begin
  if v_category is null or not exists (select 1 from public.categories where id = v_category) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_category');
  end if;

  if jsonb_typeof(p_input -> 'stock') = 'number' then
    v_stock := (p_input ->> 'stock')::int;
  end if;

  perform pg_advisory_xact_lock(hashtext('catalogue_slug'));

  insert into public.products (id, slug, name, category_id, price, description, images, sizes, colors)
  values (
    p_id,
    public.catalogue_slug(p_input ->> 'name', p_id),
    coalesce(p_input ->> 'name', ''),
    v_category,
    (p_input ->> 'price')::numeric,
    coalesce(p_input ->> 'description', ''),
    case when jsonb_typeof(p_input -> 'images') = 'array' then p_input -> 'images' else '[]'::jsonb end,
    to_jsonb(public.catalogue_list(p_input -> 'sizes')),
    to_jsonb(public.catalogue_list(p_input -> 'colors'))
  )
  returning * into v_product;

  perform public.catalogue_seed_variants(p_id, v_stock, p_input -> 'variants');

  return jsonb_build_object('ok', true, 'product', public.product_json(v_product));
end;
$$;

-- ---------------------------------------------------------------------------
-- update_product_v2: admin edit of one product, in one transaction.
--
-- The product's variant rows are locked, ordered by id, before anything else
-- is read. Then the product row. Nothing is written until every check passed.
--
-- p_patch fields name, category, price, description, images, sizes, colors and
-- active are merged when present; id, createdAt and image are ignored. The slug
-- does not change when the name does, so links keep working.
--
-- Stock can be changed in two ways:
--   * p_variants (new admin): [{id, stock, expectedStock?}] sets each variant's
--     stock. If any expectedStock differs from the stored stock (or its variant
--     no longer exists), NOTHING is written, not even the other patch fields.
--   * 'stock' in p_patch with p_variants null (old admin): a new TOTAL. If
--     p_expected_stock is given and differs from the current total, nothing is
--     written. Otherwise the difference is applied: an increase is spread
--     evenly from the first variant, a decrease is taken from the variants
--     with the most stock. The total ends up exactly as requested.
--
-- When sizes or colors are in the patch, variants are reconciled: missing
-- combinations are added with stock 0, combinations no longer present are
-- deleted, and their stock is moved evenly onto the remaining variants, so the
-- total is preserved. At least one variant always remains.
--
-- Returns one of:
--   {ok:true,  product:{...}}
--   {ok:false, reason:'not_found'}
--   {ok:false, reason:'unknown_category'}
--   {ok:false, reason:'stock_changed', stock:<total>, variants:[{id,stock}]}
-- ---------------------------------------------------------------------------
create or replace function public.update_product_v2(
  p_id text,
  p_patch jsonb,
  p_expected_stock int default null,
  p_variants jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_vars jsonb := case when jsonb_typeof(p_variants) = 'array' then p_variants else null end;
  v_product public.products;
  v_total int;
  v_requested int;
  v_sizes text[];
  v_colors text[];
  v_moved bigint;
begin
  -- 1. Lock the variant rows, ordered by id. Nothing is read before this.
  perform 1 from public.product_variants where product_id = p_id order by id for update;

  -- 2. Then the product row.
  select * into v_product from public.products where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- 3. Checks. No writes yet.
  if v_patch ? 'category'
     and not exists (select 1 from public.categories where id = v_patch ->> 'category') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_category');
  end if;

  select coalesce(sum(stock), 0) into v_total from public.product_variants where product_id = p_id;

  if (
    v_vars is not null
    and exists (
      select 1
      from jsonb_array_elements(v_vars) as e
      left join public.product_variants v on v.product_id = p_id and v.id::text = e ->> 'id'
      where e ->> 'expectedStock' is not null
        and v.stock is distinct from (e ->> 'expectedStock')::int
    )
  ) or (
    v_vars is null
    and v_patch ? 'stock'
    and p_expected_stock is not null
    and p_expected_stock <> v_total
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'stock_changed',
      'stock', v_total,
      'variants', public.catalogue_snapshot(p_id)
    );
  end if;

  if v_vars is null and v_patch ? 'stock' and jsonb_typeof(v_patch -> 'stock') = 'number' then
    v_requested := (v_patch ->> 'stock')::int;
    if v_requested < 0 then
      raise exception 'stock must be 0 or more' using errcode = 'check_violation';
    end if;
  end if;

  -- 4. Merge the patch fields.
  update public.products
  set name = coalesce(v_patch ->> 'name', name),
      category_id = coalesce(v_patch ->> 'category', category_id),
      price = case when jsonb_typeof(v_patch -> 'price') = 'number' then (v_patch ->> 'price')::numeric else price end,
      description = coalesce(v_patch ->> 'description', description),
      images = case when jsonb_typeof(v_patch -> 'images') = 'array' then v_patch -> 'images' else images end,
      sizes = case when jsonb_typeof(v_patch -> 'sizes') = 'array'
                   then to_jsonb(public.catalogue_list(v_patch -> 'sizes')) else sizes end,
      colors = case when jsonb_typeof(v_patch -> 'colors') = 'array'
                    then to_jsonb(public.catalogue_list(v_patch -> 'colors')) else colors end,
      active = case when jsonb_typeof(v_patch -> 'active') = 'boolean' then (v_patch ->> 'active')::boolean else active end
  where id = p_id
  returning * into v_product;

  -- 5. Per-variant stock (new admin). Done before the reconcile below, so stock
  --    set on a variant that is about to be removed is moved, not lost.
  if v_vars is not null then
    update public.product_variants v
    set stock = (e ->> 'stock')::int
    from jsonb_array_elements(v_vars) as e
    where v.product_id = p_id
      and v.id::text = e ->> 'id'
      and jsonb_typeof(e -> 'stock') = 'number';
  end if;

  -- 6. Reconcile variants with the (new) sizes and colors.
  if v_patch ? 'sizes' or v_patch ? 'colors' then
    v_sizes := public.catalogue_list(v_product.sizes);
    v_colors := public.catalogue_list(v_product.colors);
    if cardinality(v_sizes) = 0 then v_sizes := array['']; end if;
    if cardinality(v_colors) = 0 then v_colors := array['']; end if;

    perform public.catalogue_seed_variants(p_id, 0);

    -- Keep at least one variant: only remove when some variant would remain.
    if exists (
      select 1 from public.product_variants
      where product_id = p_id and size = any (v_sizes) and color = any (v_colors)
    ) then
      select coalesce(sum(stock), 0) into v_moved
      from public.product_variants
      where product_id = p_id and not (size = any (v_sizes) and color = any (v_colors));

      delete from public.product_variants
      where product_id = p_id and not (size = any (v_sizes) and color = any (v_colors));

      if v_moved > 0 then
        perform public.catalogue_add_stock(p_id, v_moved::int);
      end if;
    end if;
  end if;

  -- 7. New total (old admin). The reconcile above keeps the total, so v_total
  --    is still the current total.
  if v_requested is not null then
    if v_requested > v_total then
      perform public.catalogue_add_stock(p_id, v_requested - v_total);
    elsif v_requested < v_total then
      perform public.catalogue_remove_stock(p_id, v_total - v_requested);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'product', public.product_json(v_product));
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_product: remove a product and, by cascade, its variants. Returns false
-- when there was no such product. Orders keep their own copy of each line, so
-- they are not touched. Variant rows are locked first, as everywhere.
-- ---------------------------------------------------------------------------
create or replace function public.delete_product(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.product_variants where product_id = p_id order by id for update;

  delete from public.products where id = p_id;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order_v2: like place_order, but stock is per variant.
-- p_items is an array of {productId, size?, color?, quantity}. Returns one of:
--   {ok:true,  created:bool, order:{...}}
--   {ok:false, reason:'missing', missing:[productId,...]}
--   {ok:false, reason:'stock',   short:[{productId,name,size,color,requested,available},...]}
-- An item resolves to ONE variant: the exact size and colour. A size or colour
-- that is missing, null or '' matches any value of that dimension, and the
-- matching variant with the most stock is picked. No match, an unknown product
-- or an inactive product counts as missing. Two lines that resolve to the same
-- variant are added together before the stock check.
-- ---------------------------------------------------------------------------
create or replace function public.place_order_v2(p_id uuid, p_items jsonb, p_customer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_res jsonb;
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

  -- 2. Lock EVERY variant of every referenced product, ordered by id, so that
  --    two orders touching the same products always lock in the same order.
  --    The variant an item resolves to is only chosen after this.
  perform 1
  from public.product_variants
  where product_id in (
    select e ->> 'productId' from jsonb_array_elements(p_items) as e
  )
  order by id
  for update;

  -- 3. A concurrent call with the same id may have committed while we waited.
  select * into v_order from public.orders where id = p_id;
  if found then
    return jsonb_build_object('ok', true, 'created', false, 'order', public.order_json(v_order));
  end if;

  -- 4. Resolve each item to one variant (vid is null when nothing matches).
  --    Ties on stock go to the first variant in size then colour order.
  select coalesce(
    jsonb_agg(jsonb_build_object('ord', i.ord, 'pid', i.pid, 'qty', i.qty, 'vid', m.id) order by i.ord),
    '[]'::jsonb
  )
  into v_res
  from (
    select t.ord::int as ord,
           t.e ->> 'productId' as pid,
           nullif(t.e ->> 'size', '') as sz,
           nullif(t.e ->> 'color', '') as col,
           (t.e ->> 'quantity')::int as qty
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
  ) i
  left join lateral (
    select v.id
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where v.product_id = i.pid
      and p.active
      and (i.sz is null or v.size = i.sz)
      and (i.col is null or v.color = i.col)
    order by v.stock desc,
             public.catalogue_pos(p.sizes, v.size),
             public.catalogue_pos(p.colors, v.color),
             v.id
    limit 1
  ) m on true;

  -- 5. Unknown, inactive or unmatched: report the product ids.
  select coalesce(jsonb_agg(g.pid order by g.first_ord), '[]'::jsonb)
  into v_missing
  from (
    select x.pid, min(x.ord) as first_ord
    from jsonb_to_recordset(v_res) as x(ord int, pid text, qty int, vid uuid)
    where x.vid is null
    group by x.pid
  ) g;

  if jsonb_array_length(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing', 'missing', v_missing);
  end if;

  -- 6. Not enough stock on a variant: change nothing. Lines on the same
  --    variant are counted together.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'productId', p.id,
      'name', p.name,
      'size', v.size,
      'color', v.color,
      'requested', g.qty,
      'available', v.stock
    ) order by g.first_ord
  ), '[]'::jsonb)
  into v_short
  from (
    select x.vid, sum(x.qty) as qty, min(x.ord) as first_ord
    from jsonb_to_recordset(v_res) as x(ord int, pid text, qty int, vid uuid)
    group by x.vid
  ) g
  join public.product_variants v on v.id = g.vid
  join public.products p on p.id = v.product_id
  where g.qty > v.stock;

  if jsonb_array_length(v_short) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'stock', 'short', v_short);
  end if;

  -- 7. Build the order lines from the stored data (never from the request,
  --    except the quantity). size and color show the variant that was picked;
  --    '' is left out, like any other null.
  select coalesce(jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'productId', p.id,
             'name', p.name,
             'price', trim_scale(p.price),
             'size', nullif(v.size, ''),
             'color', nullif(v.color, ''),
             'quantity', x.qty,
             'subtotal', trim_scale(p.price * x.qty),
             'variantId', v.id,
             'sku', v.sku
           )) order by x.ord
         ), '[]'::jsonb),
         coalesce(sum(p.price * x.qty), 0)
  into v_lines, v_total
  from jsonb_to_recordset(v_res) as x(ord int, pid text, qty int, vid uuid)
  join public.product_variants v on v.id = x.vid
  join public.products p on p.id = v.product_id;

  -- Decrement stock and insert the order. If another transaction inserts the
  -- same order id in the meantime (different product set, so no shared lock),
  -- the unique violation rolls back this block, stock decrement included, and
  -- we return the existing order.
  begin
    update public.product_variants v
    set stock = v.stock - d.qty
    from (
      select x.vid, sum(x.qty) as qty
      from jsonb_to_recordset(v_res) as x(ord int, pid text, qty int, vid uuid)
      group by x.vid
    ) d
    where v.id = d.vid;

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
-- cancel_order_v2: mark a pending order cancelled and put its stock back.
-- Returns the order JSON, or SQL NULL when the order does not exist.
-- An already-cancelled order is returned unchanged (stock is not restored again).
-- Where each line's stock goes:
--   * a line with variantId whose variant still exists: that variant;
--   * any other line (an older line without variantId, or one whose variant has
--     since been deleted, for example when an admin dropped that size): the
--     variant with the line's exact size and colour, otherwise the product's
--     first variant (size then colour order);
--   * a line whose product has been deleted is skipped.
-- Lock order: the order row, then the variants of the products on the order,
-- ordered by id.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order_v2(p_id uuid)
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
    from public.product_variants
    where product_id in (
      select l ->> 'productId' from jsonb_array_elements(v_order.lines) as l
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
        from jsonb_array_elements(v_order.lines) as l
      ) t
      where t.vid is not null
      group by t.vid
    ) d
    where v.id = d.vid;

    update public.orders set status = 'cancelled' where id = p_id returning * into v_order;
  end if;

  return public.order_json(v_order);
end;
$$;

-- ---------------------------------------------------------------------------
-- Only the edge function (service role) may call these.
-- ---------------------------------------------------------------------------
revoke execute on function public.catalogue_list(jsonb) from public, anon, authenticated;
grant execute on function public.catalogue_list(jsonb) to service_role;

revoke execute on function public.catalogue_pos(jsonb, text) from public, anon, authenticated;
grant execute on function public.catalogue_pos(jsonb, text) to service_role;

revoke execute on function public.catalogue_slug(text, text) from public, anon, authenticated;
grant execute on function public.catalogue_slug(text, text) to service_role;

revoke execute on function public.catalogue_sku(text, text, text) from public, anon, authenticated;
grant execute on function public.catalogue_sku(text, text, text) to service_role;

revoke execute on function public.catalogue_add_stock(text, int) from public, anon, authenticated;
grant execute on function public.catalogue_add_stock(text, int) to service_role;

revoke execute on function public.catalogue_remove_stock(text, int) from public, anon, authenticated;
grant execute on function public.catalogue_remove_stock(text, int) to service_role;

revoke execute on function public.catalogue_seed_variants(text, int, jsonb) from public, anon, authenticated;
grant execute on function public.catalogue_seed_variants(text, int, jsonb) to service_role;

revoke execute on function public.catalogue_snapshot(text) from public, anon, authenticated;
grant execute on function public.catalogue_snapshot(text) to service_role;

revoke execute on function public.product_json(public.products) from public, anon, authenticated;
grant execute on function public.product_json(public.products) to service_role;

revoke execute on function public.list_products(boolean) from public, anon, authenticated;
grant execute on function public.list_products(boolean) to service_role;

revoke execute on function public.get_product(text) from public, anon, authenticated;
grant execute on function public.get_product(text) to service_role;

revoke execute on function public.list_categories(boolean) from public, anon, authenticated;
grant execute on function public.list_categories(boolean) to service_role;

revoke execute on function public.upsert_category(text, text, int, boolean) from public, anon, authenticated;
grant execute on function public.upsert_category(text, text, int, boolean) to service_role;

revoke execute on function public.delete_category(text) from public, anon, authenticated;
grant execute on function public.delete_category(text) to service_role;

revoke execute on function public.create_product(text, jsonb) from public, anon, authenticated;
grant execute on function public.create_product(text, jsonb) to service_role;

revoke execute on function public.update_product_v2(text, jsonb, int, jsonb) from public, anon, authenticated;
grant execute on function public.update_product_v2(text, jsonb, int, jsonb) to service_role;

revoke execute on function public.delete_product(text) from public, anon, authenticated;
grant execute on function public.delete_product(text) to service_role;

revoke execute on function public.place_order_v2(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.place_order_v2(uuid, jsonb, jsonb) to service_role;

revoke execute on function public.cancel_order_v2(uuid) from public, anon, authenticated;
grant execute on function public.cancel_order_v2(uuid) to service_role;
