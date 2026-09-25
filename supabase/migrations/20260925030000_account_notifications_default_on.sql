-- Order/shipping and sell-submission status emails now default ON for new
-- accounts. They are transactional (tracking for something the customer
-- bought or submitted), not marketing, and guest orders always received
-- them -- so an account holder was getting worse order tracking than a guest.
-- Customers can still turn them off under Account > Notifications.
--
-- Existing profiles are deliberately left untouched: whatever they chose (or
-- didn't) at signup stays as is.

alter table public.profiles
  alter column shipping_notifications
  set default '{"byText": false, "byEmail": true, "enabled": true}'::jsonb;

alter table public.profiles
  alter column sell_submission_notifications
  set default '{"byText": false, "byEmail": true, "enabled": true}'::jsonb;

-- Same function as before; only the fallback for a missing
-- notifications_opt_in flips from false to true (the signup form no longer
-- sends the flag, and future sign-up paths -- post-purchase password setup,
-- social sign-in -- won't either). An explicit false is still honoured.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  opted_in boolean := coalesce((new.raw_user_meta_data->>'notifications_opt_in')::boolean, true);
  shipping jsonb := coalesce(new.raw_user_meta_data->'shipping_address', '{}'::jsonb);
  first_name_value text := nullif(trim(new.raw_user_meta_data->>'first_name'), '');
  last_name_value text := nullif(trim(new.raw_user_meta_data->>'last_name'), '');
  recipient_value text;
begin
  recipient_value := nullif(trim(concat_ws(' ', first_name_value, last_name_value)), '');

  insert into public.profiles (
    id,
    first_name,
    last_name,
    shipping_notifications,
    sell_submission_notifications
  )
  values (
    new.id,
    first_name_value,
    last_name_value,
    jsonb_build_object('enabled', opted_in, 'byEmail', true, 'byText', false),
    jsonb_build_object('enabled', opted_in, 'byEmail', true, 'byText', false)
  )
  on conflict (id) do nothing;

  if new.email is not null and length(trim(new.email)) > 0 then
    insert into public.customers (email, first_name, last_name, source, auth_user_id)
    values (
      new.email,
      first_name_value,
      last_name_value,
      'account_signup',
      new.id
    )
    on conflict (email) do update
      set auth_user_id = coalesce(public.customers.auth_user_id, excluded.auth_user_id),
          first_name   = coalesce(public.customers.first_name, excluded.first_name),
          last_name    = coalesce(public.customers.last_name, excluded.last_name),
          updated_at   = now();
  end if;

  if
    length(trim(coalesce(shipping->>'line1', ''))) > 0
    and length(trim(coalesce(shipping->>'city', ''))) > 0
    and length(trim(coalesce(shipping->>'state', ''))) > 0
    and length(trim(coalesce(shipping->>'postal_code', ''))) > 0
  then
    insert into public.addresses (
      user_id,
      label,
      recipient,
      line1,
      line2,
      city,
      state,
      postal_code,
      country,
      is_default
    )
    values (
      new.id,
      'Home',
      recipient_value,
      trim(shipping->>'line1'),
      nullif(trim(coalesce(shipping->>'line2', '')), ''),
      trim(shipping->>'city'),
      trim(shipping->>'state'),
      trim(shipping->>'postal_code'),
      coalesce(nullif(trim(coalesce(shipping->>'country', '')), ''), 'US'),
      true
    );
  end if;

  return new;
end;
$function$;
