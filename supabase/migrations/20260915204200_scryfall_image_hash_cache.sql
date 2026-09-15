-- Lazily-populated cache of perceptual hashes for Scryfall reference images,
-- keyed by (scryfall_id, region). Recognition computes a candidate
-- printing's reference hash at most once ever (Vercel Functions are
-- stateless/short-lived, so an in-memory cache alone wouldn't survive
-- between invocations) — Part 18's "avoid repeatedly downloading the same
-- Scryfall images" requirement.
--
-- No FK on scryfall_id: candidates come from scryfall_bulk_cards (every
-- Scryfall printing), most of which are never in card_printings (that only
-- caches printings actually in inventory). Scryfall itself is the source of
-- truth for id validity, so this is an opportunistic cache keyed on an id
-- that's valid by definition — no FK needed or wanted.
create table if not exists public.scryfall_image_hash_cache (
  scryfall_id uuid not null,
  region      text not null, -- 'full' | 'art'
  hash        text not null, -- 64-bit dHash, stored as decimal text (fits bigint)
  created_at  timestamptz not null default now(),
  primary key (scryfall_id, region)
);

comment on table public.scryfall_image_hash_cache is
  'Lazily-populated perceptual-hash cache for Scryfall reference images, so recognition never re-downloads/re-hashes the same printing image twice.';

alter table public.scryfall_image_hash_cache enable row level security;

drop policy if exists scryfall_image_hash_cache_staff_select on public.scryfall_image_hash_cache;
create policy scryfall_image_hash_cache_staff_select
  on public.scryfall_image_hash_cache for select to authenticated
  using (public.is_staff());

grant select on public.scryfall_image_hash_cache to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.scryfall_image_hash_cache
  from anon, authenticated;
