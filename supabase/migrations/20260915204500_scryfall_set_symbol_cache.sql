-- Lazily-populated cache of set-symbol perceptual hashes (Part 6.5 / 18).
-- Set icons rarely change once printed, so this is effectively permanent —
-- refreshed only if a lookup ever needs a set not yet cached.
create table if not exists public.scryfall_set_symbol_cache (
  set_code      text primary key,
  icon_svg_uri  text not null,
  hash          text not null, -- 64-bit dHash, decimal text
  created_at    timestamptz not null default now()
);

comment on table public.scryfall_set_symbol_cache is
  'Lazily-populated perceptual-hash cache of Scryfall set icons, for shape-based (color-independent) set-symbol matching.';

alter table public.scryfall_set_symbol_cache enable row level security;

drop policy if exists scryfall_set_symbol_cache_staff_select on public.scryfall_set_symbol_cache;
create policy scryfall_set_symbol_cache_staff_select
  on public.scryfall_set_symbol_cache for select to authenticated
  using (public.is_staff());

grant select on public.scryfall_set_symbol_cache to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.scryfall_set_symbol_cache
  from anon, authenticated;
