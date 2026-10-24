-- Trades confirmed in Admin → Trade Evaluator.
--
-- A customer trades cards in for cards from the shop. Their cards are priced
-- at TCG low (typed by staff, one line per card) and count at the trade
-- credit percentage chosen for the trade; the shop's cards at their regular
-- website price, never a deal or storewide-sale price. api/admin/trades.ts
-- works the numbers out when staff confirm (the shop's prices are read from
-- inventory there, never taken from the browser) and keeps them here as they
-- were, so the link the customer is sent (/trade?t=…) always shows the trade
-- they agreed to, even after prices change.
--
-- Confirming records the trade and nothing else: inventory and store credit
-- don't change. Read and written only by the service role (the staff API and
-- the customer's link page): RLS on, no policies.

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  -- "Trade #1001": what staff and the customer call it.
  trade_number bigint generated always as identity (start with 1001) not null unique,
  -- The secret in the customer's link.
  share_token text not null unique check (char_length(share_token) >= 32),

  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 80),
  customer_phone text check (customer_phone is null or char_length(customer_phone) <= 32),
  customer_email text check (customer_email is null or char_length(customer_email) <= 254),

  credit_percent integer not null check (credit_percent between 1 and 150),
  -- [{ "name": "Sol Ring" | null, "quantity": 2, "tcgLowCents": 350 }]
  their_cards jsonb not null default '[]'::jsonb check (jsonb_typeof(their_cards) = 'array'),
  -- [{ "inventoryItemId", "cardName", "setName", "setCode", "collectorNumber",
  --    "condition", "finish", "variantType", "quantity", "priceCents" }]
  your_cards jsonb not null default '[]'::jsonb check (jsonb_typeof(your_cards) = 'array'),

  -- Their cards at TCG low, and that at credit_percent (rounded to the cent).
  their_tcg_low_cents integer not null check (their_tcg_low_cents >= 0),
  credit_cents integer not null check (credit_cents >= 0),
  -- The shop's cards at their regular website price.
  your_cards_cents integer not null check (your_cards_cents >= 0),
  -- Below zero the customer pays the rest; above zero the shop owes them trade credit.
  balance_cents integer not null,
  check (balance_cents = credit_cents - your_cards_cents),

  confirmed_by uuid,
  confirmed_by_email text,
  created_at timestamptz not null default now(),

  -- The last time the link was sent, and where.
  emailed_to text,
  emailed_at timestamptz,
  texted_to text,
  texted_at timestamptz
);

comment on table public.trades is
  'Trades confirmed in the admin Trade Evaluator: the customer''s cards at TCG low and the trade credit %, the shop''s cards at their regular website price, and the balance, as agreed. The customer sees them at /trade?t=<share_token>. Records only: nothing here changes inventory or store credit.';

create index if not exists trades_created_at_idx on public.trades (created_at desc);

alter table public.trades enable row level security;
revoke all on public.trades from anon, authenticated;
