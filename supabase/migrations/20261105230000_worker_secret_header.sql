-- Background workers: every pg_cron call now carries a shared secret.
--
-- Until now the eight pg_cron jobs below called their Vercel endpoints with a
-- bare extensions.http_post(url, '{}', 'application/json'), and the endpoints
-- accepted anyone. The work was safe to repeat, but anyone could make it run
-- (each run calls Stripe, the carrier and the email service), and a preview
-- deployment's copy would act on the production database.
--
-- public.call_worker() posts to a worker with the secret stored in Supabase
-- Vault under the name 'geega_worker_secret', in the x-geega-worker-secret
-- header. The endpoints check it against the WORKER_SECRET environment
-- variable (api/_lib/cronAuth.ts, allowWorkerRequest) and do nothing on
-- preview deployments.
--
-- Rollout (zero downtime, any step can be paused):
--   1. Set WORKER_SECRET in Vercel (Production) to a long random value.
--   2. Store the same value in Vault:
--        select vault.create_secret('<value>', 'geega_worker_secret',
--          'Shared secret pg_cron sends to the Vercel worker endpoints');
--   3. Apply this migration. The current endpoints ignore the extra header,
--      so the jobs keep working exactly as before.
--   4. Deploy the endpoint change. From then on only these jobs can run them.
--
-- The secret never appears in this file or in cron.job (the job command only
-- names the path; the value is read from Vault at call time).
--
-- Rollback: revert the endpoint change; the jobs keep working with or without
-- the header. To restore the old job commands, re-run the original
-- cron.schedule calls from the migrations named below.

create or replace function public.call_worker(p_path text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_headers extensions.http_header[] := array[]::extensions.http_header[];
  v_status integer;
begin
  if p_path is null or p_path !~ '^/api/[a-z0-9/_-]+$' then
    raise exception 'call_worker: % is not a worker path', p_path;
  end if;

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'geega_worker_secret'
  order by ds.created_at desc
  limit 1;

  if v_secret is null or v_secret = '' then
    -- Still call the worker: an endpoint that doesn't check yet keeps
    -- working, and one that does answers 401, which shows in the
    -- function's logs as the sign the Vault secret is missing.
    raise warning 'call_worker: Vault secret geega_worker_secret is not set; calling % without it', p_path;
  else
    v_headers := array[extensions.http_header('x-geega-worker-secret', v_secret)];
  end if;

  select r.status into v_status
  from extensions.http((
    'POST',
    'https://geega-games.vercel.app' || p_path,
    v_headers,
    'application/json',
    '{}'
  )::extensions.http_request) r;

  return v_status;
end;
$$;

comment on function public.call_worker(text) is
  'pg_cron only: POSTs to a Vercel worker endpoint with the Vault secret geega_worker_secret in the x-geega-worker-secret header.';

revoke all on function public.call_worker(text) from public;
revoke all on function public.call_worker(text) from anon, authenticated, service_role;

-- Same job names and schedules as before; only the command changes.
-- cron.schedule() with an existing job name updates that job in place.

-- 20260921054214_fix_deck_stock_cron_http_post_and_add_card_stock_worker.sql
select cron.schedule('geega-deck-stock-email-worker', '*/5 * * * *',
  $cmd$ select public.call_worker('/api/deck-alerts/process'); $cmd$);
select cron.schedule('geega-card-stock-email-worker', '*/5 * * * *',
  $cmd$ select public.call_worker('/api/stock-alerts/process'); $cmd$);

-- 20260921054850_schedule_checkout_recovery_worker.sql
select cron.schedule('geega-checkout-recovery-worker', '0 * * * *',
  $cmd$ select public.call_worker('/api/checkout-recovery/process'); $cmd$);

-- 20260921210849_schedule_staff_digest_worker.sql
select cron.schedule('geega-staff-digest-worker', '0 13 * * *',
  $cmd$ select public.call_worker('/api/staff-digest/process'); $cmd$);

-- 20260924050000_checkout_holds_expire_and_keep_cart.sql
select cron.schedule('geega-checkout-hold-expiry-worker', '*/5 * * * *',
  $cmd$ select public.call_worker('/api/checkout/expire-holds'); $cmd$);

-- 20260925040000_wishlist_alerts.sql
select cron.schedule('geega-wishlist-alert-worker', '*/15 * * * *',
  $cmd$ select public.call_worker('/api/wishlist-alerts/process'); $cmd$);

-- 20260930150000_shipping_updates.sql
select cron.schedule('geega-shipping-updates-worker', '25 * * * *',
  $cmd$ select public.call_worker('/api/shipping-updates/process'); $cmd$);

-- 20261011210000_partner_checkin_worker.sql
select cron.schedule('geega-partner-checkin-worker', '35 15 * * *',
  $cmd$ select public.call_worker('/api/partner-referrals/process'); $cmd$);
