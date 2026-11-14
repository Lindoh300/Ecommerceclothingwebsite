-- Admin read and edit of delivery options (the API behind the owner's delivery screen). Additive and safe to
-- re-run: it only creates or replaces two new functions. Nothing existing changes behaviour, so an older site keeps
-- working while this runs. Options cannot be created or deleted: checkout is coded for door, locker and collect.

-- list_delivery_options_admin: every option, active or not, ordered by sort then id, as
-- [{id, name, price, sort, active}].
create or replace function public.list_delivery_options_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id, 'name', d.name, 'price', trim_scale(d.price), 'sort', d.sort, 'active', d.active
      )
      order by d.sort, d.id
    ),
    '[]'::jsonb
  )
  from public.delivery_options d;
$$;

-- update_delivery_option: sets name, price and active from the patch (a key missing from the patch keeps the stored
-- value). {ok:false, reason:'not_found'} for an unknown id; {ok:false, reason:'last_active'} when the change would
-- leave no active option. Every row is locked first, so two concurrent edits cannot both turn off "the other" option.
create or replace function public.update_delivery_option(p_id text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.delivery_options;
  v_active boolean;
begin
  perform 1 from public.delivery_options order by id for update;

  select * into v_row from public.delivery_options where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_active := coalesce((p_patch ->> 'active')::boolean, v_row.active);

  if v_row.active and not v_active
     and not exists (select 1 from public.delivery_options where active and id <> p_id) then
    return jsonb_build_object('ok', false, 'reason', 'last_active');
  end if;

  update public.delivery_options
     set name = coalesce(p_patch ->> 'name', name),
         price = coalesce((p_patch ->> 'price')::numeric, price),
         active = v_active
   where id = p_id
   returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'option', jsonb_build_object(
      'id', v_row.id, 'name', v_row.name, 'price', trim_scale(v_row.price), 'sort', v_row.sort, 'active', v_row.active
    )
  );
end;
$$;

-- Only the edge function (service role) may call these.
revoke execute on function public.list_delivery_options_admin() from public, anon, authenticated;
grant execute on function public.list_delivery_options_admin() to service_role;
revoke execute on function public.update_delivery_option(text, jsonb) from public, anon, authenticated;
grant execute on function public.update_delivery_option(text, jsonb) to service_role;
