-- Trade Center: local pickup's meeting spot.
--
-- One saved place where local pickup trades meet: its name ("Ballwin Public
-- Library") and address. Customers see it (with a map link) when they choose
-- local pickup, when they confirm, and while we arrange the meetup; the
-- trade's own meetup details (trade_requests.meetup_details) still say when,
-- or anything different for that trade. Both are optional: with no spot
-- saved, staff arrange a place in each trade's messages, as before.
--
-- Settings only: no functions change. Run after 20261028010000. Safe to run
-- more than once.

alter table public.trade_settings
  add column if not exists local_meet_spot_name text,
  add column if not exists local_meet_spot_address text;

alter table public.trade_settings drop constraint if exists trade_settings_local_meet_spot_name_check;
alter table public.trade_settings add constraint trade_settings_local_meet_spot_name_check
  check (local_meet_spot_name is null or char_length(btrim(local_meet_spot_name)) between 1 and 120);
alter table public.trade_settings drop constraint if exists trade_settings_local_meet_spot_address_check;
alter table public.trade_settings add constraint trade_settings_local_meet_spot_address_check
  check (local_meet_spot_address is null or char_length(btrim(local_meet_spot_address)) between 1 and 200);

comment on column public.trade_settings.local_meet_spot_name is
  'Local pickup: the meeting spot''s name, as customers read it ("Ballwin Public Library"). Null: none saved.';
comment on column public.trade_settings.local_meet_spot_address is
  'Local pickup: the meeting spot''s street address, for directions. Null: none saved.';
