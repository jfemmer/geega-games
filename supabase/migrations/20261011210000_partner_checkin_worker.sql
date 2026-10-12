-- Partner referral check-ins: a week after a lead goes to a partner store,
-- the seller gets one "did the store get in touch?" email (sold / didn't sell
-- / never heard from them). The worker is api/partner-referrals/process.ts;
-- the answers land on partner_referrals (see 20261011200000_partner_program.sql)
-- and an unanswered seller alerts staff.
--
-- Applied after the code that serves /api/partner-referrals/process is live.
-- Daily at 15:35 UTC (10:35 in St. Louis in summer, 9:35 in winter), off the
-- top of the hour like the other workers.
select cron.schedule(
  'geega-partner-checkin-worker',
  '35 15 * * *',
  $cmd$
    select extensions.http_post(
      'https://geega-games.vercel.app/api/partner-referrals/process',
      '{}',
      'application/json'
    );
  $cmd$
);
