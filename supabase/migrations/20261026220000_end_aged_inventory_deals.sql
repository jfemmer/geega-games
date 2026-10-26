-- End the automatic 30-day markdown (added in 20260918232600_deals_specials).
--
-- 1. Stop the nightly pg_cron job and drop the function it ran, so no card is
--    marked down for sitting too long any more.
-- 2. Put every card the job already marked down back to its regular price
--    (original_price_cents), in stock or not, and clear its deal fields.
--
-- Deals placed by staff ('manual') and flawed-card deals ('flawed') are not
-- touched. 'aged_inventory' stays an accepted deal_source value, and
-- inventory_storefront_lifecycle still restores such a row on relist, so
-- nothing breaks if an old row is ever restored from a backup.

do $$
declare
  j bigint;
begin
  for j in select jobid from cron.job where jobname = 'geega-aged-inventory-deals' loop
    perform cron.unschedule(j);
  end loop;
end;
$$;

drop function if exists public.apply_aged_inventory_deals();

update public.inventory_items
set price_cents = original_price_cents,
    is_deal = false,
    deal_source = null,
    original_price_cents = null,
    deal_discount_percent = null,
    deal_started_at = null
where deal_source = 'aged_inventory'
  and original_price_cents is not null;
