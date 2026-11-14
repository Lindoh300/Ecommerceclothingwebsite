-- Events and tickets for the 4Nguru storefront edge function (Phase E, first
-- slice: events, ticket types, free RSVP tickets, tickets the owner issues, QR
-- tickets and door check-in). Additive and safe to re-run: tables use
-- "if not exists", functions use "create or replace" and nothing existing is
-- touched. Orders, order functions and checkout are not changed.
--
-- Tables: events, ticket_types, tickets, rsvp_ip_log. RLS is on, there are no
-- policies and nothing is granted to anon or authenticated, as for orders. All
-- changes go through the functions below, which only service_role may call.
--
-- LOCK RULE (read this before changing any function here):
--   * Capacity is taken under a row lock on the ticket_types row
--     (select ... for update). Issuing tickets (RSVP and admin) locks that ONE
--     row, checks sold + quantity <= capacity, adds the quantity to sold and
--     inserts the tickets, all in one transaction. Two buyers of the last seat
--     queue on the row, so a type cannot be oversold. check (sold <= capacity)
--     is the backstop.
--   * void_ticket locks the ticket_types row FIRST, then the ticket row, so the
--     order is always: ticket_types row, then ticket row. check_in_ticket locks
--     only the ticket row (one atomic UPDATE), upsert_ticket_type and
--     delete_ticket_type lock only the ticket_types row. No function takes a
--     ticket row and then a ticket_types row, so there is no cycle.
--   * A group (one request id) is serialised by a transaction advisory lock
--     taken before the row lock, so a retried or doubled request cannot take
--     capacity twice. The per-address RSVP limit is the LAST lock taken, like
--     place_order_v3. The events row is read without a lock: a cancel racing an
--     RSVP may let that one RSVP through, and the owner can void it.
--
-- Idempotency: tickets.group_id is the request id. The first ticket of a group
-- also takes the request id as its own id. A retried id returns the group's
-- tickets and takes no capacity. A replay is answered before any other check
-- and before the address limit, so it never counts.
--
-- Ticket code: 16 bytes (128 bits) from gen_random_bytes, as 32 lowercase hex
-- characters, unique. The code is the capability: anyone holding it can view
-- the ticket, so it is never derived from anything guessable.
--
-- An event "has ended" when ends_at has passed, or, with no ends_at, 6 hours
-- after starts_at.
--
-- RSVP limit: 5 RSVP requests per client address in a rolling hour. The
-- address is stored only as a salted SHA-256 hash (the salt is
-- order_rate_salt's), in rsvp_ip_log. No address, no limit.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables.
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null check (btrim(title) <> ''),
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue text not null default '',
  city text not null default '',
  image text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create table if not exists public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  price numeric(12, 2) not null default 0 check (price >= 0),
  capacity int not null default 0 check (capacity >= 0),
  sold int not null default 0 check (sold >= 0),
  sale_starts_at timestamptz,
  sale_ends_at timestamptz,
  active boolean not null default true,
  sort int not null default 0,
  check (sold <= capacity)
);

create table if not exists public.tickets (
  id uuid primary key,
  code text not null unique check (char_length(code) >= 32),
  event_id uuid not null references public.events (id) on delete restrict,
  ticket_type_id uuid not null references public.ticket_types (id) on delete restrict,
  holder_name text not null,
  holder_phone text not null,
  holder_email text,
  source text not null check (source in ('rsvp', 'issued')),
  checked_in_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  group_id uuid not null
);

create index if not exists ticket_types_event_idx on public.ticket_types (event_id, sort);
create index if not exists tickets_group_idx on public.tickets (group_id);
create index if not exists tickets_event_idx on public.tickets (event_id, created_at);
create index if not exists tickets_type_idx on public.tickets (ticket_type_id);
create index if not exists events_status_starts_idx on public.events (status, starts_at);

create table if not exists public.rsvp_ip_log (
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists rsvp_ip_log_hash_created_idx on public.rsvp_ip_log (ip_hash, created_at);
create index if not exists rsvp_ip_log_created_idx on public.rsvp_ip_log (created_at);

alter table public.events enable row level security;
alter table public.ticket_types enable row level security;
alter table public.tickets enable row level security;
alter table public.rsvp_ip_log enable row level security;
revoke all on table public.events from public, anon, authenticated;
revoke all on table public.ticket_types from public, anon, authenticated;
revoke all on table public.tickets from public, anon, authenticated;
revoke all on table public.rsvp_ip_log from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- JSON helpers.
-- ---------------------------------------------------------------------------

-- True once the event is over (see the header).
create or replace function public.event_ended(p_event public.events)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_event.ends_at, p_event.starts_at + interval '6 hours') < now()
$$;

-- A ticket type as JSON. Public: id, name, price, available, onSale. Admin adds
-- the counts, the sale window, active, sort and the event id.
create or replace function public.ticket_type_json(p_type public.ticket_types, p_admin boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
      'id', p_type.id,
      'name', p_type.name,
      'price', trim_scale(p_type.price),
      'available', greatest(p_type.capacity - p_type.sold, 0),
      'onSale', p_type.active
        and (p_type.sale_starts_at is null or p_type.sale_starts_at <= now())
        and (p_type.sale_ends_at is null or p_type.sale_ends_at > now())
        and not public.event_ended(e)
    )
    || case when p_admin then jsonb_build_object(
      'eventId', p_type.event_id,
      'capacity', p_type.capacity,
      'sold', p_type.sold,
      'saleStartsAt', p_type.sale_starts_at,
      'saleEndsAt', p_type.sale_ends_at,
      'active', p_type.active,
      'sort', p_type.sort
    ) else '{}'::jsonb end
  from public.events e
  where e.id = p_type.event_id
$$;

-- An event with its ticket types. Public: only active types, no status.
create or replace function public.event_json(p_event public.events, p_admin boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
      'id', p_event.id,
      'slug', p_event.slug,
      'title', p_event.title,
      'description', p_event.description,
      'startsAt', p_event.starts_at,
      'endsAt', p_event.ends_at,
      'venue', p_event.venue,
      'city', p_event.city,
      'image', p_event.image,
      'ticketTypes', coalesce((
        select jsonb_agg(public.ticket_type_json(t, p_admin) order by t.sort, t.name, t.id)
        from public.ticket_types t
        where t.event_id = p_event.id and (p_admin or t.active)
      ), '[]'::jsonb)
    )
    || case when p_admin then jsonb_build_object('status', p_event.status, 'createdAt', p_event.created_at)
       else '{}'::jsonb end
$$;

-- A ticket with its event and type, holder details included. The edge function
-- decides what the public may see (toPublicTicket); this is the full record.
create or replace function public.ticket_json(p_ticket public.tickets)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_ticket.id,
    'code', p_ticket.code,
    'groupId', p_ticket.group_id,
    'eventId', p_ticket.event_id,
    'eventTitle', e.title,
    'eventSlug', e.slug,
    'startsAt', e.starts_at,
    'venue', e.venue,
    'city', e.city,
    'ticketTypeId', p_ticket.ticket_type_id,
    'ticketTypeName', tt.name,
    'holderName', p_ticket.holder_name,
    'holderPhone', p_ticket.holder_phone,
    'holderEmail', p_ticket.holder_email,
    'source', p_ticket.source,
    'checkedInAt', p_ticket.checked_in_at,
    'voidedAt', p_ticket.voided_at,
    'createdAt', p_ticket.created_at
  )
  from public.events e, public.ticket_types tt
  where e.id = p_ticket.event_id and tt.id = p_ticket.ticket_type_id
$$;

-- The tickets of one group, the first-issued one first, in a stable order.
create or replace function public.group_tickets_json(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(public.ticket_json(t) order by (t.id <> t.group_id), t.created_at, t.code),
    '[]'::jsonb
  )
  from public.tickets t
  where t.group_id = p_group
$$;

-- ---------------------------------------------------------------------------
-- Public reads.
-- ---------------------------------------------------------------------------

-- Published events that have not ended, soonest first; with p_past, the ones
-- that have ended, newest first.
create or replace function public.list_events_public(p_past boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_past, false) then
    return coalesce((
      select jsonb_agg(public.event_json(e, false) order by e.starts_at desc, e.id)
      from public.events e
      where e.status = 'published' and public.event_ended(e)
    ), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(public.event_json(e, false) order by e.starts_at, e.id)
    from public.events e
    where e.status = 'published' and not public.event_ended(e)
  ), '[]'::jsonb);
end;
$$;

-- One published event by slug, or null (draft, cancelled and unknown are the same).
create or replace function public.get_event_public(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.event_json(e, false)
  from public.events e
  where e.slug = p_slug and e.status = 'published'
$$;

-- One ticket by code, or null. Full record; see ticket_json.
create or replace function public.get_ticket(p_code text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.ticket_json(t)
  from public.tickets t
  where t.code = lower(btrim(coalesce(p_code, '')))
$$;

-- ---------------------------------------------------------------------------
-- Issuing tickets. issue_tickets is internal: nothing may call it directly.
-- ---------------------------------------------------------------------------

-- Takes capacity under the ticket_types row lock and inserts p_qty tickets in
-- group p_group. p_event, when given, must be the type's event (RSVP passes the
-- published event it resolved from the slug). p_source 'rsvp' also requires a
-- free type, on sale, of an event that has not ended; 'issued' (owner) only
-- refuses a cancelled event. Returns {ok:true, created:true, tickets:[...]} or
-- {ok:false, reason: id_taken | not_found | paid_type | event_ended |
-- not_on_sale | event_cancelled | sold_out (with available)}.
create or replace function public.issue_tickets(
  p_group uuid,
  p_event uuid,
  p_type_id uuid,
  p_qty int,
  p_holder jsonb,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_type public.ticket_types;
  v_event public.events;
  v_name text := btrim(coalesce(p_holder ->> 'name', ''));
  v_phone text := btrim(coalesce(p_holder ->> 'phone', ''));
  v_email text := nullif(btrim(coalesce(p_holder ->> 'email', '')), '');
  i int;
begin
  if exists (select 1 from public.tickets where group_id = p_group) then
    return jsonb_build_object('ok', false, 'reason', 'id_taken');
  end if;

  -- The capacity lock: this row, and nothing else, until the transaction ends.
  select * into v_type
  from public.ticket_types
  where id = p_type_id and (p_event is null or event_id = p_event)
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_event from public.events where id = v_type.event_id;

  if p_source = 'rsvp' then
    if v_type.price <> 0 then
      return jsonb_build_object('ok', false, 'reason', 'paid_type');
    end if;
    if public.event_ended(v_event) then
      return jsonb_build_object('ok', false, 'reason', 'event_ended');
    end if;
    if not v_type.active
       or (v_type.sale_starts_at is not null and v_type.sale_starts_at > now())
       or (v_type.sale_ends_at is not null and v_type.sale_ends_at <= now()) then
      return jsonb_build_object('ok', false, 'reason', 'not_on_sale');
    end if;
  elsif v_event.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  end if;

  if v_type.sold + p_qty > v_type.capacity then
    return jsonb_build_object(
      'ok', false, 'reason', 'sold_out',
      'available', greatest(v_type.capacity - v_type.sold, 0)
    );
  end if;

  update public.ticket_types set sold = sold + p_qty where id = v_type.id;

  for i in 1..p_qty loop
    insert into public.tickets (
      id, code, event_id, ticket_type_id, holder_name, holder_phone, holder_email, source, group_id
    ) values (
      case when i = 1 then p_group else gen_random_uuid() end,
      encode(gen_random_bytes(16), 'hex'),
      v_type.event_id, v_type.id, v_name, v_phone, v_email, p_source, p_group
    );
  end loop;

  return jsonb_build_object('ok', true, 'created', true, 'tickets', public.group_tickets_json(p_group));
end;
$$;

-- Public RSVP: free tickets for a published event, found by slug. 1 to 4
-- tickets. A retried p_id returns the same tickets. The address limit is the
-- last step; going over it rolls back the capacity and the tickets
-- ({ok:false, reason:'rate_limited'}). A draft, cancelled or unknown event is
-- reason 'not_found'.
create or replace function public.rsvp_tickets(
  p_id uuid,
  p_slug text,
  p_type_id uuid,
  p_qty int,
  p_holder jsonb,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip text := nullif(btrim(coalesce(p_ip, '')), '');
  v_event public.events;
  v_res jsonb;
  v_salt text;
  v_hash text;
  v_count int;
begin
  if p_qty is null or p_qty < 1 or p_qty > 4 then
    return jsonb_build_object('ok', false, 'reason', 'bad_quantity');
  end if;

  begin
    perform pg_advisory_xact_lock(hashtextextended('ticket_group:' || p_id::text, 0));

    -- A retry: the same tickets, no capacity, no limit.
    if exists (
      select 1
      from public.tickets t join public.events e on e.id = t.event_id
      where t.group_id = p_id and t.source = 'rsvp' and e.slug = p_slug
    ) then
      return jsonb_build_object('ok', true, 'created', false, 'tickets', public.group_tickets_json(p_id));
    end if;

    select * into v_event from public.events where slug = p_slug and status = 'published';
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    v_res := public.issue_tickets(p_id, v_event.id, p_type_id, p_qty, p_holder, 'rsvp');
    if not coalesce((v_res ->> 'ok')::boolean, false) then
      return v_res;
    end if;

    -- The address limit, last (see the header). No address, no check.
    if v_ip is not null then
      select salt into v_salt from public.order_rate_salt where id;
      if v_salt is null then
        insert into public.order_rate_salt (id) values (true) on conflict do nothing;
        select salt into v_salt from public.order_rate_salt where id;
      end if;
      v_hash := encode(sha256(convert_to(v_salt || v_ip, 'UTF8')), 'hex');
      perform pg_advisory_xact_lock(hashtextextended('rsvp_ip:' || v_hash, 0));
      delete from public.rsvp_ip_log
      where ip_hash = v_hash and created_at <= now() - interval '1 hour';
      select count(*) into v_count
      from public.rsvp_ip_log
      where ip_hash = v_hash and created_at > now() - interval '1 hour';
      if v_count >= 5 then
        raise exception 'too many RSVPs from this address' using errcode = 'NG429';
      end if;
      insert into public.rsvp_ip_log (ip_hash) values (v_hash);

      delete from public.rsvp_ip_log
      where ctid in (
        select l.ctid from public.rsvp_ip_log l
        where l.created_at <= now() - interval '1 hour'
        limit 200
        for update skip locked
      );
    end if;

    return v_res;
  exception
    when sqlstate 'NG429' then
      -- Leaving this block undoes the capacity, the tickets and any log row.
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end;
end;
$$;

-- Owner-issued tickets (someone paid on WhatsApp or at the door): 1 to 20, for
-- a paid or free type, source 'issued'. No price, sale window or address checks;
-- a cancelled event refuses. Same capacity lock and idempotency as the RSVP.
create or replace function public.admin_issue_tickets(
  p_id uuid,
  p_type_id uuid,
  p_qty int,
  p_holder jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_qty is null or p_qty < 1 or p_qty > 20 then
    return jsonb_build_object('ok', false, 'reason', 'bad_quantity');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ticket_group:' || p_id::text, 0));
  if exists (select 1 from public.tickets where group_id = p_id and source = 'issued') then
    return jsonb_build_object('ok', true, 'created', false, 'tickets', public.group_tickets_json(p_id));
  end if;
  return public.issue_tickets(p_id, null, p_type_id, p_qty, p_holder, 'issued');
end;
$$;

-- ---------------------------------------------------------------------------
-- Door: check-in and void.
-- ---------------------------------------------------------------------------

-- First call wins: one UPDATE that only matches a ticket that is neither used
-- nor void, so two scans at once cannot both succeed. Returns
-- {result: 'ok' | 'already' | 'void' | 'not_found' | 'wrong_event', ticket?, checkedInAt?}.
-- p_at is a scan time from an offline queue: used when it is in the past 24
-- hours and not in the future, else now(). p_event, when given, refuses a ticket
-- of another event ('wrong_event') before anything is written.
create or replace function public.check_in_ticket(
  p_code text,
  p_at timestamptz default null,
  p_event uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_t public.tickets;
  v_at timestamptz := case
    when p_at is not null and p_at <= now() and p_at >= now() - interval '24 hours' then p_at
    else now()
  end;
begin
  select * into v_t from public.tickets where code = v_code;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if p_event is not null and v_t.event_id <> p_event then
    return jsonb_build_object('result', 'wrong_event', 'ticket', public.ticket_json(v_t));
  end if;

  update public.tickets
  set checked_in_at = v_at
  where id = v_t.id and checked_in_at is null and voided_at is null
  returning * into v_t;
  if found then
    return jsonb_build_object('result', 'ok', 'ticket', public.ticket_json(v_t), 'checkedInAt', v_t.checked_in_at);
  end if;

  select * into v_t from public.tickets where code = v_code;
  if v_t.voided_at is not null then
    return jsonb_build_object('result', 'void', 'ticket', public.ticket_json(v_t), 'checkedInAt', v_t.checked_in_at);
  end if;
  return jsonb_build_object('result', 'already', 'ticket', public.ticket_json(v_t), 'checkedInAt', v_t.checked_in_at);
end;
$$;

-- Void a ticket and give its seat back, once. Locks the ticket_types row, then
-- the ticket row. A used ticket cannot be voided ({ok:false, reason:'used'}).
-- Voiding a void ticket changes nothing ({ok:true, changed:false}).
create or replace function public.void_ticket(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_id uuid;
  v_type_id uuid;
  v_t public.tickets;
begin
  select id, ticket_type_id into v_id, v_type_id from public.tickets where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform 1 from public.ticket_types where id = v_type_id for update;
  select * into v_t from public.tickets where id = v_id for update;

  if v_t.checked_in_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'used', 'ticket', public.ticket_json(v_t));
  end if;
  if v_t.voided_at is not null then
    return jsonb_build_object('ok', true, 'changed', false, 'ticket', public.ticket_json(v_t));
  end if;

  update public.tickets set voided_at = now() where id = v_t.id returning * into v_t;
  update public.ticket_types set sold = sold - 1 where id = v_type_id;
  return jsonb_build_object('ok', true, 'changed', true, 'ticket', public.ticket_json(v_t));
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: events, ticket types, ticket list.
-- ---------------------------------------------------------------------------

-- Every event, any status, newest start first, with all its ticket types and
-- their sold and capacity.
create or replace function public.list_events_admin()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.event_json(e, true) order by e.starts_at desc, e.id), '[]'::jsonb)
  from public.events e
$$;

-- The tickets of one event for the door and the owner, holder details included.
-- null when the event does not exist.
create or replace function public.list_event_tickets(p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.events where id = p_event) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(public.ticket_json(t) order by t.created_at, t.holder_name, t.id)
    from public.tickets t
    where t.event_id = p_event
  ), '[]'::jsonb);
end;
$$;

-- Create or update an event under a client id. On update a missing key keeps
-- the stored value; "endsAt": null clears the end. A new event needs title and
-- startsAt and gets a slug from the title unless "slug" is given. Returns
-- {ok:true, created, event} or {ok:false, reason: slug_taken | bad_dates | missing_fields}.
create or replace function public.upsert_event(p_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ex public.events;
  v_new public.events;
  v_slug text;
  v_base text;
  v_n int := 1;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  -- One writer at a time, so two events cannot claim the same slug.
  perform pg_advisory_xact_lock(hashtextextended('event_slug', 0));
  select * into v_ex from public.events where id = p_id for update;

  v_starts := case when p_input ? 'startsAt' then (p_input ->> 'startsAt')::timestamptz else v_ex.starts_at end;
  v_ends := case when p_input ? 'endsAt' then (p_input ->> 'endsAt')::timestamptz else v_ex.ends_at end;
  if v_ends is not null and v_ends < v_starts then
    return jsonb_build_object('ok', false, 'reason', 'bad_dates');
  end if;
  if v_ex.id is null and (nullif(btrim(coalesce(p_input ->> 'title', '')), '') is null or v_starts is null) then
    return jsonb_build_object('ok', false, 'reason', 'missing_fields');
  end if;

  if p_input ? 'slug' and nullif(btrim(p_input ->> 'slug'), '') is not null then
    v_slug := btrim(p_input ->> 'slug');
    if exists (select 1 from public.events where slug = v_slug and id <> p_id) then
      return jsonb_build_object('ok', false, 'reason', 'slug_taken');
    end if;
  elsif v_ex.id is not null then
    v_slug := v_ex.slug;
  else
    v_base := trim(both '-' from regexp_replace(lower(coalesce(p_input ->> 'title', '')), '[^a-z0-9]+', '-', 'g'));
    if v_base = '' then v_base := 'event'; end if;
    v_slug := left(v_base, 60);
    while exists (select 1 from public.events where slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := left(v_base, 60) || '-' || v_n;
    end loop;
  end if;

  if v_ex.id is null then
    insert into public.events (id, slug, title, description, starts_at, ends_at, venue, city, image, status)
    values (
      p_id,
      v_slug,
      btrim(p_input ->> 'title'),
      coalesce(p_input ->> 'description', ''),
      v_starts,
      v_ends,
      coalesce(p_input ->> 'venue', ''),
      coalesce(p_input ->> 'city', ''),
      coalesce(p_input ->> 'image', ''),
      coalesce(p_input ->> 'status', 'draft')
    )
    returning * into v_new;
    return jsonb_build_object('ok', true, 'created', true, 'event', public.event_json(v_new, true));
  end if;

  update public.events set
    slug = v_slug,
    title = coalesce(nullif(btrim(p_input ->> 'title'), ''), v_ex.title),
    description = case when p_input ? 'description' then coalesce(p_input ->> 'description', '') else v_ex.description end,
    starts_at = v_starts,
    ends_at = v_ends,
    venue = case when p_input ? 'venue' then coalesce(p_input ->> 'venue', '') else v_ex.venue end,
    city = case when p_input ? 'city' then coalesce(p_input ->> 'city', '') else v_ex.city end,
    image = case when p_input ? 'image' then coalesce(p_input ->> 'image', '') else v_ex.image end,
    status = coalesce(p_input ->> 'status', v_ex.status)
  where id = p_id
  returning * into v_new;
  return jsonb_build_object('ok', true, 'created', false, 'event', public.event_json(v_new, true));
end;
$$;

-- Delete an event and its ticket types. Refused ({ok:false, reason:'has_tickets'})
-- when any ticket exists, void or not. {ok:false, reason:'not_found'} if unknown.
create or replace function public.delete_event(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.events where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform 1 from public.ticket_types where event_id = p_id for update;
  if exists (select 1 from public.tickets where event_id = p_id) then
    return jsonb_build_object('ok', false, 'reason', 'has_tickets');
  end if;
  delete from public.ticket_types where event_id = p_id;
  delete from public.events where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Create or update a ticket type under a client id. A new one needs "eventId"
-- (ignored on update). Capacity cannot go below sold. Returns
-- {ok:true, created, ticketType} or {ok:false, reason: event_not_found |
-- missing_fields | capacity_below_sold (with sold) | bad_dates}.
create or replace function public.upsert_ticket_type(p_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ex public.ticket_types;
  v_new public.ticket_types;
  v_event uuid;
  v_capacity int;
  v_from timestamptz;
  v_to timestamptz;
begin
  select * into v_ex from public.ticket_types where id = p_id for update;
  v_capacity := case when p_input ? 'capacity' then (p_input ->> 'capacity')::int else v_ex.capacity end;
  v_from := case when p_input ? 'saleStartsAt' then (p_input ->> 'saleStartsAt')::timestamptz else v_ex.sale_starts_at end;
  v_to := case when p_input ? 'saleEndsAt' then (p_input ->> 'saleEndsAt')::timestamptz else v_ex.sale_ends_at end;
  if v_from is not null and v_to is not null and v_to < v_from then
    return jsonb_build_object('ok', false, 'reason', 'bad_dates');
  end if;

  if v_ex.id is null then
    v_event := (p_input ->> 'eventId')::uuid;
    if v_event is null or not exists (select 1 from public.events where id = v_event) then
      return jsonb_build_object('ok', false, 'reason', 'event_not_found');
    end if;
    if nullif(btrim(coalesce(p_input ->> 'name', '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'missing_fields');
    end if;
    insert into public.ticket_types (id, event_id, name, price, capacity, sale_starts_at, sale_ends_at, active, sort)
    values (
      p_id,
      v_event,
      btrim(p_input ->> 'name'),
      coalesce((p_input ->> 'price')::numeric, 0),
      coalesce(v_capacity, 0),
      v_from,
      v_to,
      coalesce((p_input ->> 'active')::boolean, true),
      coalesce((p_input ->> 'sort')::int, 0)
    )
    returning * into v_new;
    return jsonb_build_object('ok', true, 'created', true, 'ticketType', public.ticket_type_json(v_new, true));
  end if;

  if v_capacity < v_ex.sold then
    return jsonb_build_object('ok', false, 'reason', 'capacity_below_sold', 'sold', v_ex.sold);
  end if;
  update public.ticket_types set
    name = coalesce(nullif(btrim(p_input ->> 'name'), ''), v_ex.name),
    price = case when p_input ? 'price' then (p_input ->> 'price')::numeric else v_ex.price end,
    capacity = v_capacity,
    sale_starts_at = v_from,
    sale_ends_at = v_to,
    active = case when p_input ? 'active' then (p_input ->> 'active')::boolean else v_ex.active end,
    sort = case when p_input ? 'sort' then (p_input ->> 'sort')::int else v_ex.sort end
  where id = p_id
  returning * into v_new;
  return jsonb_build_object('ok', true, 'created', false, 'ticketType', public.ticket_type_json(v_new, true));
end;
$$;

-- Delete a ticket type. Refused ({ok:false, reason:'has_tickets'}) when sold > 0
-- or any ticket (even a void one) still points at it.
create or replace function public.delete_ticket_type(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.ticket_types;
begin
  select * into v_t from public.ticket_types where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_t.sold > 0 or exists (select 1 from public.tickets where ticket_type_id = p_id) then
    return jsonb_build_object('ok', false, 'reason', 'has_tickets', 'sold', v_t.sold);
  end if;
  delete from public.ticket_types where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Only the edge function (service role) may call these. issue_tickets is
-- internal: not even service_role may call it, only the functions above.
-- ---------------------------------------------------------------------------
revoke execute on function public.event_ended(public.events) from public, anon, authenticated;
grant execute on function public.event_ended(public.events) to service_role;
revoke execute on function public.ticket_type_json(public.ticket_types, boolean) from public, anon, authenticated;
grant execute on function public.ticket_type_json(public.ticket_types, boolean) to service_role;
revoke execute on function public.event_json(public.events, boolean) from public, anon, authenticated;
grant execute on function public.event_json(public.events, boolean) to service_role;
revoke execute on function public.ticket_json(public.tickets) from public, anon, authenticated;
grant execute on function public.ticket_json(public.tickets) to service_role;
revoke execute on function public.group_tickets_json(uuid) from public, anon, authenticated;
grant execute on function public.group_tickets_json(uuid) to service_role;

revoke execute on function public.list_events_public(boolean) from public, anon, authenticated;
grant execute on function public.list_events_public(boolean) to service_role;
revoke execute on function public.get_event_public(text) from public, anon, authenticated;
grant execute on function public.get_event_public(text) to service_role;
revoke execute on function public.get_ticket(text) from public, anon, authenticated;
grant execute on function public.get_ticket(text) to service_role;

revoke execute on function public.issue_tickets(uuid, uuid, uuid, int, jsonb, text) from public, anon, authenticated, service_role;
revoke execute on function public.rsvp_tickets(uuid, text, uuid, int, jsonb, text) from public, anon, authenticated;
grant execute on function public.rsvp_tickets(uuid, text, uuid, int, jsonb, text) to service_role;
revoke execute on function public.admin_issue_tickets(uuid, uuid, int, jsonb) from public, anon, authenticated;
grant execute on function public.admin_issue_tickets(uuid, uuid, int, jsonb) to service_role;

revoke execute on function public.check_in_ticket(text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.check_in_ticket(text, timestamptz, uuid) to service_role;
revoke execute on function public.void_ticket(text) from public, anon, authenticated;
grant execute on function public.void_ticket(text) to service_role;

revoke execute on function public.list_events_admin() from public, anon, authenticated;
grant execute on function public.list_events_admin() to service_role;
revoke execute on function public.list_event_tickets(uuid) from public, anon, authenticated;
grant execute on function public.list_event_tickets(uuid) to service_role;
revoke execute on function public.upsert_event(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_event(uuid, jsonb) to service_role;
revoke execute on function public.delete_event(uuid) from public, anon, authenticated;
grant execute on function public.delete_event(uuid) to service_role;
revoke execute on function public.upsert_ticket_type(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_ticket_type(uuid, jsonb) to service_role;
revoke execute on function public.delete_ticket_type(uuid) from public, anon, authenticated;
grant execute on function public.delete_ticket_type(uuid) to service_role;
