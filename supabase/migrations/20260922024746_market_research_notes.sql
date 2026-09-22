-- Manually-curated competitor/market research per region, for comparing
-- against admin_order_geography's real demand numbers when evaluating a
-- physical location. Deliberately NOT a live competitor-count API
-- integration (e.g. Google Places): that needs its own paid API key/billing
-- and is unjustified before there's a short list of real candidate
-- markets to research. This is a simple, zero-cost place to record what
-- you *do* research for a specific city/region, one row at a time.
create table public.market_research_notes (
  id uuid primary key default gen_random_uuid(),
  region_label text not null,
  state text,
  competitor_count integer check (competitor_count is null or competitor_count >= 0),
  population integer check (population is null or population >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index market_research_notes_state_idx on public.market_research_notes(state);

alter table public.market_research_notes enable row level security;

create policy "market research owners manage notes"
on public.market_research_notes for all to authenticated
using (public.is_staff() and public.current_staff_role() = any(array['owner','administrator']))
with check (public.is_staff() and public.current_staff_role() = any(array['owner','administrator']));
