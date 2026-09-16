-- Denormalized photo count, set explicitly by /api/sell/submit at insert
-- time (it already knows the confirmed photo count before either insert
-- happens), the same way total_cards is set — avoids a join/count query on
-- every admin list render just to show a "has photos" filter/column.
alter table public.sell_submissions add column if not exists photo_count integer not null default 0;
