-- Change default for shipping_notifications to opt-out (disabled) so newly
-- created profiles start with notifications off unless the signup form
-- explicitly opts in (handled by handle_new_user() below).
alter table public.profiles
  alter column shipping_notifications set default '{"byText": false, "byEmail": true, "enabled": false}'::jsonb;

-- New column, mirroring shipping_notifications' shape, for Sell Your Cards /
-- Buying Lead status-update emails. Same opt-out-by-default posture.
alter table public.profiles
  add column if not exists sell_submission_notifications jsonb not null
    default '{"byText": false, "byEmail": true, "enabled": false}'::jsonb;

comment on column public.profiles.shipping_notifications is
  'Email/text opt-in for order & shipping status updates. {enabled, byEmail, byText} -- byText is reserved (no SMS provider is wired up); only byEmail is currently read. Defaults to disabled; the signup form may opt a new user in.';
comment on column public.profiles.sell_submission_notifications is
  'Email/text opt-in for Sell Your Cards / Buying Lead status updates. Same shape and defaults as shipping_notifications.';

-- Replace handle_new_user() so a signup can opt into both notification
-- categories via raw_user_meta_data.notifications_opt_in (set by the signup
-- form's checkbox). Defaults remain disabled when omitted/false.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  opted_in boolean := coalesce((new.raw_user_meta_data->>'notifications_opt_in')::boolean, false);
begin
  insert into public.profiles (id, first_name, last_name, shipping_notifications, sell_submission_notifications)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data->>'first_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'last_name'), ''),
    jsonb_build_object('enabled', opted_in, 'byEmail', true, 'byText', false),
    jsonb_build_object('enabled', opted_in, 'byEmail', true, 'byText', false)
  )
  on conflict (id) do nothing;

  if new.email is not null and length(trim(new.email)) > 0 then
    insert into public.customers (email, first_name, last_name, source, auth_user_id)
    values (new.email,
      nullif(trim(new.raw_user_meta_data->>'first_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'last_name'), ''),
      'account_signup', new.id)
    on conflict (email) do update
      set auth_user_id = coalesce(public.customers.auth_user_id, excluded.auth_user_id),
          first_name   = coalesce(public.customers.first_name, excluded.first_name),
          last_name    = coalesce(public.customers.last_name, excluded.last_name),
          updated_at   = now();
  end if;
  return new;
end;
$function$;
