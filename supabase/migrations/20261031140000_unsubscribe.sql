-- Self-service unsubscribe for the 4Nguru mailing list (Phase F, second slice).
-- Additive and safe to re-run: one function, created with "create or replace",
-- and no existing function or table is changed. It needs
-- 20261031130000_community.sql (subscribers, subscribe_ip_log, normalise_phone).
--
-- unsubscribe_contact: a person gives their phone, their email or both, and
-- every subscribers row whose normalised phone or lower-cased email matches is
-- opted out: unsubscribed_at is set to now() the first time and kept after
-- that. Nothing is deleted: the row stays as the record of the consent. It
-- returns {ok:true} whether or not anything matched, so the answer does not say
-- who is on the list.
--
-- Address limit: the same one as subscribe, sharing subscribe_ip_log, so
-- sign-ups and unsubscribes together are 5 per client address in a rolling
-- hour. Same salted SHA-256 of the address (the salt is order_rate_salt's),
-- same cleanup, and no address means no limit. Over the limit it returns
-- {ok:false, reason:'rate_limited'} and writes nothing. Lock order is as in
-- subscribe: the address lock first, then the one 'subscribe' lock.
--
-- Only service_role may call it, as for the other community functions.

create or replace function public.unsubscribe_contact(
  p_phone text,
  p_email text,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip text := nullif(btrim(coalesce(p_ip, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_pn text;
  v_salt text;
  v_hash text;
  v_count int;
begin
  -- The address limit first, shared with subscribe. No address, no check.
  if v_ip is not null then
    select salt into v_salt from public.order_rate_salt where id;
    if v_salt is null then
      insert into public.order_rate_salt (id) values (true) on conflict do nothing;
      select salt into v_salt from public.order_rate_salt where id;
    end if;
    v_hash := encode(sha256(convert_to(v_salt || v_ip, 'UTF8')), 'hex');
    perform pg_advisory_xact_lock(hashtextextended('subscribe_ip:' || v_hash, 0));
    delete from public.subscribe_ip_log
    where ip_hash = v_hash and created_at <= now() - interval '1 hour';
    select count(*) into v_count
    from public.subscribe_ip_log
    where ip_hash = v_hash and created_at > now() - interval '1 hour';
    if v_count >= 5 then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
    insert into public.subscribe_ip_log (ip_hash) values (v_hash);

    delete from public.subscribe_ip_log
    where ctid in (
      select l.ctid from public.subscribe_ip_log l
      where l.created_at <= now() - interval '1 hour'
      limit 200
      for update skip locked
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('subscribe', 0));

  v_pn := public.normalise_phone(v_phone);
  if v_pn is not null or v_email is not null then
    update public.subscribers set unsubscribed_at = coalesce(unsubscribed_at, now())
    where (v_pn is not null and phone is not null and public.normalise_phone(phone) = v_pn)
       or (v_email is not null and email is not null and lower(email) = lower(v_email));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only.
-- ---------------------------------------------------------------------------
revoke execute on function public.unsubscribe_contact(text, text, text) from public, anon, authenticated;
grant execute on function public.unsubscribe_contact(text, text, text) to service_role;
