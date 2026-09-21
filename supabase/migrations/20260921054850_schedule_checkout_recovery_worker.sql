-- Hourly sweep for abandoned/failed-payment online checkouts — see
-- api/checkout-recovery/process.ts. Hourly is plenty (unlike the 5-minute
-- restock workers, timing precision doesn't matter for this).
select cron.schedule(
  'geega-checkout-recovery-worker',
  '0 * * * *',
  $cmd$
    select extensions.http_post(
      'https://geega-games.vercel.app/api/checkout-recovery/process',
      '{}',
      'application/json'
    );
  $cmd$
);
