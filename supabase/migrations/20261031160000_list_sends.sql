-- Sending to the mailing list for the 4Nguru storefront edge function (Phase F).
-- Additive and safe to re-run: tables and indexes use "if not exists", functions
-- use "create or replace" and nothing existing is touched. It needs
-- 20261031130000_community.sql (subscribers).
--
-- The owner writes one email (a subject and a plain-text body) and sends it to
-- everyone on the list. The edge function sends it in batches of up to 100, one
-- request at a time, and records each step here, so a send that is interrupted
-- carries on where it stopped and nobody is emailed twice in the normal case.
--
-- Tables: list_sends, one row per email the owner has sent (the id is made by
-- the client, so creating it twice is one send), and list_send_recipients, one
-- row per subscriber the email is for. The recipient row stores the subscriber's
-- id and NOT the address: the address is read when the batch is claimed, so a
-- person who opts out, or changes their address, after the send began is
-- respected. RLS is on, there are no policies and nothing is granted to anon or
-- authenticated, as for subscribers. All changes go through the functions below,
-- which only service_role may call.
--
-- A recipient is 'pending' (not yet tried), 'sending' (claimed, the request is in
-- flight), 'sent', 'failed' (3 attempts used) or 'skipped' (opted out, or no
-- email, by the time it was their turn).
--
-- create_list_send snapshots the list: every subscriber with an email and no
-- opt-out at that moment. Someone who joins later is not in this send.
--
-- claim_list_send_batch takes up to p_limit 'pending' rows (oldest subscriber id
-- first) with "for update skip locked", so two callers never get the same row.
-- Rows whose subscriber has opted out or has no email are marked 'skipped' and
-- not returned; the rest become 'sending' and the attempt count goes up. A row
-- left in 'sending' by a crash is NEVER claimed again: a possibly missed email is
-- better than a double email on a consent-based list. The owner sees it as
-- "sending" in the summary.
--
-- finish_list_send_batch settles the rows of a batch that are still 'sending':
-- p_ok true makes them 'sent'; false puts them back to 'pending' for another try
-- while attempts < 3, else 'failed'. finished_at is set once no row is 'pending'
-- or 'sending'.
--
-- create_list_send returns {created, send}: created tells the caller whether the
-- id was new (HTTP 201) or a repeat (200). Every other function returns the
-- summary {id, subject, body, total, pending, sending, sent, failed, skipped,
-- createdAt, finishedAt} (or null for an unknown send).

-- ---------------------------------------------------------------------------
-- Tables.
-- ---------------------------------------------------------------------------
create table if not exists public.list_sends (
  id uuid primary key,
  subject text not null check (char_length(btrim(subject, E' \t\r\n')) between 1 and 150),
  body text not null check (char_length(btrim(body, E' \t\r\n')) between 1 and 10000),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.list_send_recipients (
  send_id uuid not null references public.list_sends (id) on delete cascade,
  subscriber_id uuid not null references public.subscribers (id),
  state text not null default 'pending' check (state in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (send_id, subscriber_id)
);

create index if not exists list_send_recipients_state_idx on public.list_send_recipients (send_id, state);

alter table public.list_sends enable row level security;
alter table public.list_send_recipients enable row level security;
revoke all on table public.list_sends from public, anon, authenticated;
revoke all on table public.list_send_recipients from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The summary of one send: its text and the count of recipients in each state.
-- null when there is no such send.
-- ---------------------------------------------------------------------------
create or replace function public.list_send_summary(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id,
    'subject', s.subject,
    'body', s.body,
    'total', count(r.subscriber_id),
    'pending', count(r.subscriber_id) filter (where r.state = 'pending'),
    'sending', count(r.subscriber_id) filter (where r.state = 'sending'),
    'sent', count(r.subscriber_id) filter (where r.state = 'sent'),
    'failed', count(r.subscriber_id) filter (where r.state = 'failed'),
    'skipped', count(r.subscriber_id) filter (where r.state = 'skipped'),
    'createdAt', s.created_at,
    'finishedAt', s.finished_at
  )
  from public.list_sends s
  left join public.list_send_recipients r on r.send_id = s.id
  where s.id = p_id
  group by s.id
$$;

-- Sets finished_at (once) when no recipient is 'pending' or 'sending'.
create or replace function public.list_send_close_if_done(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.list_sends
  set finished_at = now()
  where id = p_id
    and finished_at is null
    and not exists (
      select 1 from public.list_send_recipients r
      where r.send_id = p_id and r.state in ('pending', 'sending')
    )
$$;

-- ---------------------------------------------------------------------------
-- Owner: create a send, take a batch, settle a batch, list the sends.
-- ---------------------------------------------------------------------------

-- The caller has already checked the text. Under a lock on the id: a repeat id
-- changes nothing and returns {created:false, send:<summary>}. A new id inserts
-- the send and snapshots the list as 'pending'; with nobody to send to it is
-- finished at once. Returns {created:true, send:<summary>}.
create or replace function public.create_list_send(p_id uuid, p_subject text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('list_send:' || p_id::text, 0));

  if exists (select 1 from public.list_sends where id = p_id) then
    return jsonb_build_object('created', false, 'send', public.list_send_summary(p_id));
  end if;

  insert into public.list_sends (id, subject, body) values (p_id, p_subject, p_body);
  insert into public.list_send_recipients (send_id, subscriber_id)
  select p_id, s.id
  from public.subscribers s
  where s.unsubscribed_at is null and s.email is not null;
  perform public.list_send_close_if_done(p_id);

  return jsonb_build_object('created', true, 'send', public.list_send_summary(p_id));
end;
$$;

-- Returns null when there is no such send, else {recipients:[{subscriberId,
-- email}], summary}. The address and the opt-out are read here, at claim time.
create or replace function public.claim_list_send_batch(p_id uuid, p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(coalesce(p_limit, 100), 0);
  v_got int := 0;
  v_n int;
  v_ok int;
  v_new jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.list_sends where id = p_id) then
    return null;
  end if;

  -- Keep going until v_limit deliverable rows or no 'pending' row is left: a skipped row does not use up the limit.
  while v_got < v_limit loop
    with picked as (
      select r.subscriber_id
      from public.list_send_recipients r
      where r.send_id = p_id and r.state = 'pending'
      order by r.subscriber_id
      limit v_limit - v_got
      for update skip locked
    ),
    changed as (
      update public.list_send_recipients r
      set state = case when s.unsubscribed_at is null and s.email is not null then 'sending' else 'skipped' end,
          attempts = r.attempts + case when s.unsubscribed_at is null and s.email is not null then 1 else 0 end,
          updated_at = now()
      from picked p
      join public.subscribers s on s.id = p.subscriber_id
      where r.send_id = p_id and r.subscriber_id = p.subscriber_id
      returning r.subscriber_id, r.state, s.email
    )
    select
      count(*),
      count(*) filter (where state = 'sending'),
      coalesce(
        jsonb_agg(jsonb_build_object('subscriberId', subscriber_id, 'email', email) order by subscriber_id)
          filter (where state = 'sending'),
        '[]'::jsonb
      )
    into v_n, v_ok, v_new
    from changed;

    exit when v_n = 0;
    v_got := v_got + v_ok;
    v_out := v_out || v_new;
  end loop;

  perform public.list_send_close_if_done(p_id);
  return jsonb_build_object('recipients', v_out, 'summary', public.list_send_summary(p_id));
end;
$$;

-- Only rows still in 'sending' are touched. Returns the summary, or null for an unknown send.
create or replace function public.finish_list_send_batch(p_id uuid, p_subscriber_ids uuid[], p_ok boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.list_send_recipients
  set state = case when p_ok then 'sent' when attempts < 3 then 'pending' else 'failed' end,
      updated_at = now()
  where send_id = p_id
    and subscriber_id = any(coalesce(p_subscriber_ids, '{}'::uuid[]))
    and state = 'sending';
  perform public.list_send_close_if_done(p_id);
  return public.list_send_summary(p_id);
end;
$$;

-- Newest first, up to 50.
create or replace function public.list_list_sends_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(public.list_send_summary(x.id) order by x.created_at desc, x.id desc),
    '[]'::jsonb
  )
  from (
    select s.id, s.created_at from public.list_sends s order by s.created_at desc, s.id desc limit 50
  ) x
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only.
-- ---------------------------------------------------------------------------
revoke execute on function public.list_send_summary(uuid) from public, anon, authenticated;
grant execute on function public.list_send_summary(uuid) to service_role;
revoke execute on function public.list_send_close_if_done(uuid) from public, anon, authenticated;
grant execute on function public.list_send_close_if_done(uuid) to service_role;
revoke execute on function public.create_list_send(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_list_send(uuid, text, text) to service_role;
revoke execute on function public.claim_list_send_batch(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_list_send_batch(uuid, int) to service_role;
revoke execute on function public.finish_list_send_batch(uuid, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.finish_list_send_batch(uuid, uuid[], boolean) to service_role;
revoke execute on function public.list_list_sends_admin() from public, anon, authenticated;
grant execute on function public.list_list_sends_admin() to service_role;
