-- Daily staff digest email (yesterday's orders/leads/signups + what needs
-- attention right now) — see api/staff-digest/process.ts. 13:00 UTC is
-- morning in the US Central time zone (the store's own region).
select cron.schedule(
  'geega-staff-digest-worker',
  '0 13 * * *',
  $cmd$
    select extensions.http_post(
      'https://geega-games.vercel.app/api/staff-digest/process',
      '{}',
      'application/json'
    );
  $cmd$
);
