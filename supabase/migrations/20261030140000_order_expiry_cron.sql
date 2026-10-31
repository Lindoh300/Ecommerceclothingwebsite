-- Schedules order expiry (section 4 of the delivery / online payment work).
-- Needs the pg_cron extension (Supabase: Database > Extensions, or the line
-- below) and 20261030130000_place_order_v3.sql, which defines
-- public.expire_due_orders(). This file is separate on purpose: the SQL tests
-- run on PGlite, which has no pg_cron, so they never load it.
--
-- Every five minutes the job cancels due pending orders and expires due
-- awaiting_payment orders, returning their stock. cron.schedule with an
-- existing job name replaces that job, so this file is safe to re-run.
-- Nothing is granted to anyone: the job runs as the role that applies this file.

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule('expire-orders', '*/5 * * * *', $$call public.expire_due_orders()$$);
