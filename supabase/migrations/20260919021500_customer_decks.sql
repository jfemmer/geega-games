-- Customer deck builder, inventory watches, restock notifications, and beginner recommendations.

create table if not exists public.customer_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  format text not null default 'commander',
  commander_oracle_id uuid,
  commander_name text,
  budget_mode text not null default 'balanced'
    check (budget_mode in ('budget','balanced','unlimited')),
  max_card_price_cents integer check (max_card_price_cents is null or max_card_price_cents >= 0),
  notify_in_app boolean not null default true,
  notify_email boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_decks_user_idx
  on public.customer_decks(user_id, updated_at desc);

create table if not exists public.customer_deck_cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.customer_decks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  oracle_id uuid,
  scryfall_id uuid,
  card_name text not null,
  quantity integer not null default 1 check (quantity between 1 and 99),
  section text not null default 'mainboard',
  owned boolean not null default false,
  exact_printing_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_deck_cards_deck_idx
  on public.customer_deck_cards(deck_id);
create index if not exists customer_deck_cards_watch_idx
  on public.customer_deck_cards(oracle_id, owned)
  where oracle_id is not null and owned = false;

create table if not exists public.deck_stock_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  oracle_id uuid not null,
  card_name text not null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  deck_names text[] not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  email_sent_at timestamptz,
  email_error text
);

create index if not exists deck_stock_notifications_user_idx
  on public.deck_stock_notifications(user_id, created_at desc);
create index if not exists deck_stock_notifications_email_queue_idx
  on public.deck_stock_notifications(created_at)
  where email_sent_at is null and email_error is null;

alter table public.customer_decks enable row level security;
alter table public.customer_deck_cards enable row level security;
alter table public.deck_stock_notifications enable row level security;

drop policy if exists "deck owners manage decks" on public.customer_decks;
create policy "deck owners manage decks"
on public.customer_decks for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "deck owners manage cards" on public.customer_deck_cards;
create policy "deck owners manage cards"
on public.customer_deck_cards for all to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.customer_decks d
    where d.id = deck_id and d.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.customer_decks d
    where d.id = deck_id and d.user_id = auth.uid()
  )
);

drop policy if exists "users read own deck notifications" on public.deck_stock_notifications;
create policy "users read own deck notifications"
on public.deck_stock_notifications for select to authenticated
using (user_id = auth.uid());

drop policy if exists "users update own deck notifications" on public.deck_stock_notifications;
create policy "users update own deck notifications"
on public.deck_stock_notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.resolve_deck_card_names(p_names text[])
returns table(
  input_name text, card_name text, oracle_id uuid, scryfall_id uuid,
  type_line text, image_url text, commander_legal boolean
)
language sql stable security invoker set search_path=public
as $$
  select
    n.input_name, c.card_name, c.oracle_id::uuid, c.scryfall_id::uuid,
    c.raw->>'type_line',
    coalesce(c.raw->'image_uris'->>'normal', c.raw->'card_faces'->0->'image_uris'->>'normal'),
    coalesce(c.raw->'legalities'->>'commander' = 'legal', false)
  from unnest(p_names) with ordinality as n(input_name, ord)
  left join lateral (
    select b.*
    from public.scryfall_bulk_cards b
    where b.lang='en' and lower(b.card_name)=lower(trim(n.input_name))
    order by (b.raw->'legalities'->>'commander'='legal') desc,
             b.released_at desc nulls last
    limit 1
  ) c on true
  order by n.ord;
$$;
grant execute on function public.resolve_deck_card_names(text[]) to authenticated;

create or replace function public.deck_inventory_matches(p_deck_id uuid)
returns table(
  deck_card_id uuid, oracle_id uuid, card_name text, requested_quantity integer,
  owned boolean, inventory_item_id uuid, set_code text, set_name text,
  condition public.card_condition, finish public.card_finish,
  available_quantity integer, price_cents integer, image_url text
)
language sql stable security invoker set search_path=public
as $$
  select dc.id, dc.oracle_id, dc.card_name, dc.quantity, dc.owned,
    i.id, i.set_code, i.set_name, i.condition, i.finish,
    greatest(i.quantity - coalesce((
      select sum(r.quantity)::int from public.inventory_reservations r
      where r.inventory_item_id=i.id and r.status='active'
    ),0),0),
    public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal),
    i.image_url
  from public.customer_deck_cards dc
  join public.customer_decks d on d.id=dc.deck_id and d.user_id=auth.uid()
  left join lateral (
    select ii.*
    from public.inventory_items ii
    where dc.oracle_id is not null
      and ii.oracle_id=dc.oracle_id and ii.status='active' and ii.quantity>0
      and (dc.exact_printing_only=false or ii.scryfall_id=dc.scryfall_id)
    order by public.storefront_effective_price(ii.price_cents, ii.original_price_cents, ii.is_deal) asc nulls last,
             ii.condition asc, ii.created_at desc
    limit 1
  ) i on true
  where dc.deck_id=p_deck_id
  order by dc.card_name;
$$;
grant execute on function public.deck_inventory_matches(uuid) to authenticated;

create or replace function public.deck_recommendations(p_deck_id uuid, p_limit integer default 24)
returns table(
  oracle_id uuid, card_name text, category text, reason text, image_url text,
  in_stock boolean, inventory_item_id uuid, store_price_cents integer,
  scryfall_price_cents integer, score integer
)
language sql stable security invoker set search_path=public
as $$
with deck as (
  select d.* from public.customer_decks d
  where d.id=p_deck_id and d.user_id=auth.uid()
),
commander as (
  select b.* from deck d
  join public.scryfall_bulk_cards b on b.oracle_id::uuid=d.commander_oracle_id
  where b.lang='en'
  order by b.released_at desc nulls last limit 1
),
deck_cards as (
  select dc.oracle_id from public.customer_deck_cards dc
  join deck d on d.id=dc.deck_id where dc.oracle_id is not null
),
commander_meta as (
  select coalesce(c.raw->'color_identity','[]'::jsonb) ci,
         lower(coalesce(c.raw->>'oracle_text','')) commander_text,
         lower(coalesce(c.raw->>'type_line','')) commander_type
  from commander c
),
canonical as (
  select distinct on (b.oracle_id)
    b.oracle_id::uuid oracle_id, b.card_name, b.raw,
    coalesce(b.raw->'image_uris'->>'normal', b.raw->'card_faces'->0->'image_uris'->>'normal') image_url,
    case when nullif(b.raw->'prices'->>'usd','') is not null
      then round((b.raw->'prices'->>'usd')::numeric*100)::int else null end scryfall_price_cents
  from public.scryfall_bulk_cards b
  where b.lang='en' and b.oracle_id is not null
    and b.raw->'legalities'->>'commander'='legal'
  order by b.oracle_id, b.released_at desc nulls last
),
candidates as (
  select c.*, lower(coalesce(c.raw->>'oracle_text','')) ot,
    lower(coalesce(c.raw->>'type_line','')) tl,
    case
      when lower(coalesce(c.raw->>'oracle_text','')) ~ '(draw (a|two|three|x|that many|cards)|draw [0-9]+ cards)' then 'Card Draw'
      when lower(coalesce(c.raw->>'oracle_text','')) ~ '(destroy all|exile all|all creatures get -)' then 'Board Wipe'
      when lower(coalesce(c.raw->>'oracle_text','')) ~ '(destroy target|exile target|counter target spell|deals? [0-9x]+ damage to target)' then 'Interaction'
      when lower(coalesce(c.raw->>'oracle_text','')) ~ '(add \{|search your library for .*land card|untap target land)' then 'Ramp'
      when lower(coalesce(c.raw->>'oracle_text','')) ~ '(hexproof|indestructible|phase out|protection from)' then 'Protection'
      else 'Synergy'
    end category,
    (
      case when lower(coalesce(c.raw->>'oracle_text','')) ~ '(draw (a|two|three|x|that many|cards)|draw [0-9]+ cards)' then 15 else 0 end +
      case when lower(coalesce(c.raw->>'oracle_text','')) ~ '(destroy target|exile target|counter target spell)' then 12 else 0 end +
      case when lower(coalesce(c.raw->>'oracle_text','')) ~ '(add \{|search your library for .*land card)' then 12 else 0 end +
      case when lower(coalesce(c.raw->>'oracle_text','')) ~ '(hexproof|indestructible|phase out)' then 8 else 0 end +
      case when m.commander_text like '%artifact%' and lower(coalesce(c.raw->>'type_line','')) like '%artifact%' then 12 else 0 end +
      case when m.commander_text like '%enchantment%' and lower(coalesce(c.raw->>'type_line','')) like '%enchantment%' then 12 else 0 end +
      case when m.commander_text like '%graveyard%' and lower(coalesce(c.raw->>'oracle_text','')) like '%graveyard%' then 10 else 0 end +
      case when m.commander_text like '%token%' and lower(coalesce(c.raw->>'oracle_text','')) like '%token%' then 10 else 0 end +
      case when m.commander_text like '%sacrifice%' and lower(coalesce(c.raw->>'oracle_text','')) like '%sacrifice%' then 10 else 0 end +
      case when m.commander_text like '%counter%' and lower(coalesce(c.raw->>'oracle_text','')) like '%counter%' then 7 else 0 end
    )::int base_score
  from canonical c cross join commander_meta m
  where not exists (select 1 from deck_cards dc where dc.oracle_id=c.oracle_id)
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(c.raw->'color_identity','[]'::jsonb)) x(color)
      where not (m.ci ? x.color)
    )
),
with_stock as (
  select c.*, inv.id inventory_item_id, inv.store_price_cents,
         (inv.id is not null) in_stock
  from candidates c
  left join lateral (
    select i.id,
      public.storefront_effective_price(i.price_cents,i.original_price_cents,i.is_deal) store_price_cents
    from public.inventory_items i
    where i.oracle_id=c.oracle_id and i.status='active' and i.quantity>0
    order by public.storefront_effective_price(i.price_cents,i.original_price_cents,i.is_deal) asc nulls last
    limit 1
  ) inv on true
),
budgeted as (
  select ws.*, d.budget_mode, d.max_card_price_cents
  from with_stock ws cross join deck d
  where d.budget_mode='unlimited'
     or coalesce(ws.store_price_cents,ws.scryfall_price_cents,0)
        <= coalesce(d.max_card_price_cents,case when d.budget_mode='budget' then 500 else 2000 end)
)
select b.oracle_id,b.card_name,b.category,
  case
    when b.category='Ramp' then 'Helps your deck accelerate mana and develop earlier.'
    when b.category='Card Draw' then 'Adds card advantage so you are less likely to run out of options.'
    when b.category='Interaction' then 'Gives you another way to answer opposing threats.'
    when b.category='Board Wipe' then 'Provides a reset button when opponents get too far ahead.'
    when b.category='Protection' then 'Helps protect your important permanents from removal.'
    when lower(coalesce(b.ot,'')) like '%graveyard%' then 'Matches a graveyard theme found in your commander.'
    when lower(coalesce(b.ot,'')) like '%token%' then 'Supports a token theme found in your commander.'
    when lower(coalesce(b.ot,'')) like '%sacrifice%' then 'Supports a sacrifice theme found in your commander.'
    else 'Fits your commander color identity and shares useful deck themes.'
  end,
  b.image_url,b.in_stock,b.inventory_item_id,b.store_price_cents,b.scryfall_price_cents,
  (b.base_score+case when b.in_stock then 1 else 0 end)::int
from budgeted b
where b.base_score>0
order by b.base_score desc,b.card_name
limit greatest(1,least(coalesce(p_limit,24),60));
$$;
grant execute on function public.deck_recommendations(uuid,integer) to authenticated;

create or replace function public.notify_deck_watchers_on_inventory()
returns trigger language plpgsql security definer set search_path=public
as $$
declare
  became_available boolean := false;
  was_available boolean := false;
  watcher record;
  names text[];
begin
  if new.oracle_id is null then return new; end if;
  became_available := new.status='active' and new.quantity>0;
  if not became_available then return new; end if;

  if tg_op='UPDATE' then
    was_available := old.status='active' and old.quantity>0 and old.oracle_id=new.oracle_id;
  end if;
  if was_available then return new; end if;

  if exists (
    select 1 from public.inventory_items i
    where i.oracle_id=new.oracle_id and i.id<>new.id
      and i.status='active' and i.quantity>0
  ) then return new; end if;

  for watcher in
    select dc.user_id,dc.oracle_id,max(dc.card_name) card_name,
      bool_or(d.notify_in_app) notify_in_app,bool_or(d.notify_email) notify_email
    from public.customer_deck_cards dc
    join public.customer_decks d on d.id=dc.deck_id and d.user_id=dc.user_id
    where dc.oracle_id=new.oracle_id and dc.owned=false
      and (d.notify_in_app or d.notify_email)
    group by dc.user_id,dc.oracle_id
  loop
    select array_agg(distinct d.name order by d.name) into names
    from public.customer_deck_cards dc
    join public.customer_decks d on d.id=dc.deck_id
    where dc.user_id=watcher.user_id and dc.oracle_id=watcher.oracle_id and dc.owned=false;

    if not exists (
      select 1 from public.deck_stock_notifications n
      where n.user_id=watcher.user_id and n.oracle_id=watcher.oracle_id
        and n.created_at>now()-interval '1 hour'
    ) then
      insert into public.deck_stock_notifications(
        user_id,oracle_id,card_name,inventory_item_id,deck_names,read_at,email_sent_at
      ) values (
        watcher.user_id,watcher.oracle_id,watcher.card_name,new.id,coalesce(names,'{}'),
        case when watcher.notify_in_app then null else now() end,
        case when watcher.notify_email then null else now() end
      );
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists inventory_deck_watch_alert_trg on public.inventory_items;
create trigger inventory_deck_watch_alert_trg
after insert or update of quantity,status,oracle_id on public.inventory_items
for each row execute function public.notify_deck_watchers_on_inventory();

revoke all on function public.notify_deck_watchers_on_inventory() from public,anon,authenticated;
grant execute on function public.notify_deck_watchers_on_inventory() to service_role;

create or replace function public.deck_notification_summary()
returns table(
  id uuid,card_name text,inventory_item_id uuid,deck_names text[],
  created_at timestamptz,read_at timestamptz
)
language sql stable security invoker set search_path=public
as $$
  select id,card_name,inventory_item_id,deck_names,created_at,read_at
  from public.deck_stock_notifications
  where user_id=auth.uid() and read_at is null
  order by created_at desc limit 50;
$$;
grant execute on function public.deck_notification_summary() to authenticated;
