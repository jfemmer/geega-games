-- Seller form progress: where people stop.
--
-- One row per form start (site_form_sessions): the first time someone taps or
-- types in one of the seller forms, the storefront creates a random session
-- id and reports how far that person gets — the furthest step they reached,
-- the last field they touched, how many photos they added, how many times
-- they pressed send, the last error message they saw, and whether it was
-- sent. The admin Overview's "Seller forms" section reads it through
-- admin_form_funnel().
--
-- Forms tracked (src/store/lib/formTracking.ts):
--   quick_quote  the two-step quick photo quote (/sell-my-collection, St. Louis)
--   sell         the full four-step /sell form
--   referral     the one-page partner-store forms (Pokémon, video games…)
--
-- Same privacy rules as page views and searches (20261027050000): written
-- only by /api/track with the service role; no IP, no cookie, no user id,
-- the same daily-rotating anonymous visitor id; never anything the person
-- typed — only field and step names and our own error messages. Staff
-- devices, automated browsers, Do Not Track and Global Privacy Control send
-- nothing (src/store/lib/pageViews.ts). It is deliberately NOT linked to the
-- submission it may have produced, so a form start stays anonymous.
-- Kept 13 months, like page views.

begin;

create table if not exists public.site_form_sessions (
  id uuid primary key,
  form text not null check (form in ('quick_quote', 'sell', 'referral')),
  path text not null check (char_length(path) between 1 and 300),
  visitor_hash text not null check (char_length(visitor_hash) = 32),
  device text not null check (device in ('mobile', 'tablet', 'desktop')),
  country text check (char_length(country) <= 2),
  region text check (char_length(region) <= 3),
  city text check (char_length(city) <= 100),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  furthest_step smallint not null default 1 check (furthest_step between 1 and 10),
  furthest_step_label text check (char_length(furthest_step_label) <= 80),
  last_field text check (char_length(last_field) <= 80),
  photos smallint not null default 0 check (photos between 0 and 1000),
  submit_attempts smallint not null default 0 check (submit_attempts between 0 and 1000),
  last_error text check (char_length(last_error) <= 300),
  submitted_at timestamptz
);

comment on table public.site_form_sessions is
  'One row per anonymous seller-form start: furthest step, last field touched, photos, send attempts, last error shown, and whether it was sent. Written by /api/track with the service role; no IP, cookie, user id or typed content.';
comment on column public.site_form_sessions.last_field is
  'Name of the last field the person tapped or typed in (e.g. "Email"), never its value.';
comment on column public.site_form_sessions.last_error is
  'The last error message the form showed (our own wording, never the person''s input).';

create index if not exists site_form_sessions_started_at_idx on public.site_form_sessions (started_at);

alter table public.site_form_sessions enable row level security;
revoke all on table public.site_form_sessions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writes: create or update one session. Progress only moves forward, so a
-- late or repeated report can never undo it. A session stops accepting
-- updates after a day, and can't change which form it belongs to.
-- ---------------------------------------------------------------------------

create or replace function public.record_form_session(
  p_id uuid,
  p_form text,
  p_path text,
  p_visitor_hash text,
  p_device text,
  p_country text,
  p_region text,
  p_city text,
  p_step smallint,
  p_step_label text,
  p_field text,
  p_photos smallint,
  p_attempts smallint,
  p_error text,
  p_submitted boolean
)
returns void
language sql
set search_path to 'public'
as $function$
  insert into public.site_form_sessions as s (
    id, form, path, visitor_hash, device, country, region, city,
    furthest_step, furthest_step_label, last_field, photos, submit_attempts, last_error, submitted_at
  )
  values (
    p_id, p_form, p_path, p_visitor_hash, p_device, p_country, p_region, p_city,
    p_step, p_step_label, p_field, p_photos, p_attempts, p_error,
    case when p_submitted then now() end
  )
  on conflict (id) do update set
    updated_at = now(),
    furthest_step_label = case
      when excluded.furthest_step >= s.furthest_step then coalesce(excluded.furthest_step_label, s.furthest_step_label)
      else s.furthest_step_label
    end,
    furthest_step = greatest(s.furthest_step, excluded.furthest_step),
    last_field = coalesce(excluded.last_field, s.last_field),
    photos = greatest(s.photos, excluded.photos),
    submit_attempts = greatest(s.submit_attempts, excluded.submit_attempts),
    last_error = coalesce(excluded.last_error, s.last_error),
    submitted_at = coalesce(s.submitted_at, excluded.submitted_at)
  where s.form = excluded.form
    and s.started_at > now() - interval '1 day';
$function$;

revoke all on function public.record_form_session(
  uuid, text, text, text, text, text, text, text, smallint, text, text, smallint, smallint, text, boolean
) from public, anon, authenticated;
grant execute on function public.record_form_session(
  uuid, text, text, text, text, text, text, text, smallint, text, text, smallint, smallint, text, boolean
) to service_role;

-- ---------------------------------------------------------------------------
-- The admin Overview's "Seller forms": how far each form start got.
--   forms:  per form — started, how many stopped at each step, tried to
--           send, sent.
--   pages:  per form and page — started and sent (the quick quote appears on
--           more than one page).
--   recent: the 50 latest form starts, with where each one stopped.
-- ---------------------------------------------------------------------------

create or replace function public.admin_form_funnel(p_range text default '30d')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_end timestamptz := now();
  v_start timestamptz;
  v_forms jsonb;
  v_pages jsonb;
  v_recent jsonb;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  case p_range
    when '7d' then v_start := v_end - interval '7 days';
    when '90d' then v_start := v_end - interval '90 days';
    when 'ytd' then v_start := date_trunc('year', v_end);
    else v_start := v_end - interval '30 days';
  end case;

  select coalesce(jsonb_agg(f order by f->>'form'), '[]'::jsonb) into v_forms
  from (
    select jsonb_build_object(
      'form', s.form,
      'started', count(*),
      'attempted', count(*) filter (where s.submit_attempts > 0 or s.submitted_at is not null),
      'sent', count(*) filter (where s.submitted_at is not null),
      'stoppedAt', (
        select coalesce(jsonb_agg(jsonb_build_object('step', x.furthest_step, 'sessions', x.n) order by x.furthest_step), '[]'::jsonb)
        from (
          select t.furthest_step, count(*) n
          from public.site_form_sessions t
          where t.form = s.form and t.started_at >= v_start and t.started_at <= v_end
          group by t.furthest_step
        ) x
      )
    ) f
    from public.site_form_sessions s
    where s.started_at >= v_start and s.started_at <= v_end
    group by s.form
  ) q;

  select coalesce(jsonb_agg(p order by (p->>'started')::int desc, p->>'path'), '[]'::jsonb) into v_pages
  from (
    select jsonb_build_object(
      'form', s.form,
      'path', s.path,
      'started', count(*),
      'sent', count(*) filter (where s.submitted_at is not null)
    ) p
    from public.site_form_sessions s
    where s.started_at >= v_start and s.started_at <= v_end
    group by s.form, s.path
  ) q;

  select coalesce(jsonb_agg(r order by r->>'startedAt' desc), '[]'::jsonb) into v_recent
  from (
    select jsonb_build_object(
      'id', s.id,
      'form', s.form,
      'path', s.path,
      'startedAt', s.started_at,
      'updatedAt', s.updated_at,
      'device', s.device,
      'country', s.country,
      'region', s.region,
      'city', s.city,
      'furthestStep', s.furthest_step,
      'furthestStepLabel', s.furthest_step_label,
      'lastField', s.last_field,
      'photos', s.photos,
      'submitAttempts', s.submit_attempts,
      'lastError', s.last_error,
      'sent', s.submitted_at is not null
    ) r
    from public.site_form_sessions s
    where s.started_at >= v_start and s.started_at <= v_end
    order by s.started_at desc
    limit 50
  ) q;

  return jsonb_build_object('forms', v_forms, 'pages', v_pages, 'recent', v_recent);
end;
$function$;

revoke all on function public.admin_form_funnel(text) from public, anon;
grant execute on function public.admin_form_funnel(text) to authenticated, service_role;

-- Keep 13 months, like page views and searches.
select cron.schedule(
  'geega-site-form-sessions-retention',
  '35 4 * * *',
  $cmd$ delete from public.site_form_sessions where started_at < now() - interval '13 months'; $cmd$
);

commit;
