-- The deck-restock-alert cron job (geega-deck-stock-email-worker) has failed
-- on EVERY run since it was created (2026-09-19) with "http_request.content
-- is NULL" — the 2-arg extensions.http_post(url, jsonb) convenience overload
-- appears broken on this database, while the explicit 3-arg
-- http_post(url, body, content_type) form works (verified directly: it
-- returned 200 and drained a real pending notification). This means no
-- deck-restock email has ever actually sent. Fix by rewriting the job's
-- command to use the working 3-arg form, and build the new card-level
-- stock-alert worker's job the same way from the start.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'geega-deck-stock-email-worker'),
  command => $cmd$
    select extensions.http_post(
      'https://geega-games.vercel.app/api/deck-alerts/process',
      '{}',
      'application/json'
    );
  $cmd$
);

select cron.schedule(
  'geega-card-stock-email-worker',
  '*/5 * * * *',
  $cmd$
    select extensions.http_post(
      'https://geega-games.vercel.app/api/stock-alerts/process',
      '{}',
      'application/json'
    );
  $cmd$
);
