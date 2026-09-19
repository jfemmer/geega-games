-- Keep card_recommendation_catalog from silently drifting out of date.
-- It was a one-time snapshot with no refresh mechanism: every time
-- `npm run scryfall:refresh` updates scryfall_bulk_cards with new sets,
-- this catalog (and therefore deck card search/resolve/recommendations)
-- would keep serving stale data until someone remembered to manually
-- re-run rebuild_card_recommendation_catalog(). Same pattern as the
-- existing geega-deck-stock-email-worker cron job below.
do $$
declare existing bigint;
begin
  select jobid into existing from cron.job where jobname='geega-card-recommendation-catalog-refresh';
  if existing is not null then
    perform cron.unschedule(existing);
  end if;
end $$;

select cron.schedule(
  'geega-card-recommendation-catalog-refresh',
  '30 3 * * *',
  $$select public.rebuild_card_recommendation_catalog();$$
);
