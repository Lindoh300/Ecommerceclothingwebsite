-- Undoes seed.sql completely. Run:  supabase db query --linked -f docs/demo-data/remove.sql
-- Refuses (and changes nothing) if any order has a line for a demo product.
-- Orders keep their lines as jsonb [{productId, ...}] (no foreign key), so the guard reads that.
begin;

do $guard$
declare
  n int;
begin
  select count(*) into n
  from public.orders o
  cross join lateral jsonb_array_elements(case when jsonb_typeof(o.lines) = 'array' then o.lines else '[]'::jsonb end) l
  where l ->> 'productId' like 'demo-%';
  if n > 0 then
    raise exception 'remove aborted: % order line(s) reference demo products; nothing was changed', n;
  end if;
end
$guard$;

delete from public.gallery_items where id::text like 'd2000000-0000-4000-8000-%';
delete from public.tickets where event_id::text like 'd0000000-0000-4000-8000-%';
delete from public.ticket_types where event_id::text like 'd0000000-0000-4000-8000-%';
delete from public.events where id::text like 'd0000000-0000-4000-8000-%';
delete from public.products where id like 'demo-%';  -- variants cascade

-- Products 1-5: images exactly as in docs/backups/demo-20261031-155940-products.json

update public.products set images = '["", "", ""]'::jsonb where id = '1';
update public.products set images = '[]'::jsonb where id = '2';
update public.products set images = '[]'::jsonb where id = '3';
update public.products set images = '[]'::jsonb where id = '4';
update public.products set images = '[]'::jsonb where id = '5';

commit;
