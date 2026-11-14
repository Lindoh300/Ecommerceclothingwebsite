-- Stock-safe admin product updates for the 4Nguru storefront edge function.
-- Safe to re-run: every statement is idempotent.
--
-- update_product merges a patch into the product's jsonb value under a row
-- lock (the same lock place_order and cancel_order take), so an admin edit can
-- never overwrite a stock change made by an order that committed in between.

-- ---------------------------------------------------------------------------
-- update_product: merge p_patch into 'product:<p_id>' in one transaction.
-- id, createdAt and image in the patch are ignored; image is recomputed as the
-- first non-empty entry of the merged images array (or '').
-- If p_patch sets stock and p_expected_stock is given but differs from the
-- stored stock, nothing is written. Returns one of:
--   {ok:true,  product:{...}}
--   {ok:false, reason:'not_found'}
--   {ok:false, reason:'stock_changed', stock:<stored stock>}
-- ---------------------------------------------------------------------------
create or replace function public.update_product(
  p_id text,
  p_patch jsonb,
  p_expected_stock int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value jsonb;
  v_merged jsonb;
  v_image text;
begin
  select value into v_value
  from public.kv_store_fbb8f0e1
  where key = 'product:' || p_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_patch ? 'stock'
     and p_expected_stock is not null
     and (v_value ->> 'stock')::numeric is distinct from p_expected_stock::numeric then
    return jsonb_build_object('ok', false, 'reason', 'stock_changed', 'stock', v_value -> 'stock');
  end if;

  v_merged := v_value || (p_patch - 'id' - 'createdAt' - 'image');

  select coalesce(
    (
      select e.val
      from jsonb_array_elements_text(
        case when jsonb_typeof(v_merged -> 'images') = 'array' then v_merged -> 'images' else '[]'::jsonb end
      ) with ordinality as e(val, ord)
      where e.val <> ''
      order by e.ord
      limit 1
    ),
    ''
  ) into v_image;

  v_merged := v_merged || jsonb_build_object('image', v_image);

  update public.kv_store_fbb8f0e1
  set value = v_merged
  where key = 'product:' || p_id;

  return jsonb_build_object('ok', true, 'product', v_merged);
end;
$$;

-- ---------------------------------------------------------------------------
-- Only the edge function (service role) may call this.
-- ---------------------------------------------------------------------------
revoke execute on function public.update_product(text, jsonb, int) from public, anon, authenticated;
grant execute on function public.update_product(text, jsonb, int) to service_role;
