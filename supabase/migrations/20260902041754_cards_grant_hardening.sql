-- 20260901000002_cards_grant_hardening
--
-- Defense-in-depth for the public catalog table `public.cards`.
--
-- Findings this migration addresses (verified on the live project):
--   1. `cards` had leftover table-level INSERT/UPDATE/DELETE/TRUNCATE grants
--      for the `anon` and `authenticated` roles. RLS currently blocks those
--      writes (there are no write policies), but the grants should not exist —
--      they leave the table one accidental policy away from failing open.
--   2. The public-read policy only covered the `anon` role. Once account login
--      ships, `authenticated` users would be unable to read the catalog.
--
-- This migration does NOT modify any row data. It only tightens privileges and
-- broadens read access to logged-in users.

begin;

-- 1. Remove all write privileges from the browser roles. Keep SELECT only.
revoke insert, update, delete, truncate, references, trigger
  on public.cards from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.cards from authenticated;

-- Ensure the browser roles retain read access at the privilege layer.
grant select on public.cards to anon, authenticated;

-- 2. Make sure RLS is on (idempotent; it already is).
alter table public.cards enable row level security;

-- 3. Allow BOTH anon and authenticated to read the public catalog.
--    Replace the anon-only policy with one covering both browser roles.
drop policy if exists "Public can read cards" on public.cards;
drop policy if exists cards_public_read on public.cards;
create policy cards_public_read
  on public.cards
  for select
  to anon, authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policies are created: writes remain the exclusive
-- domain of the service_role key (server-side) and the postgres owner.

commit;
