-- Sets an explicit search_path on the reference-number trigger function,
-- matching the convention every other trigger/security-definer function in
-- this codebase follows (tg_set_updated_at is a pre-existing exception this
-- migration does not touch). Clears the "Function Search Path Mutable"
-- advisory for the new function.

create or replace function public.tg_set_sell_submission_reference()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.reference_number is null then
    new.reference_number := 'GG-S-' || nextval('public.sell_submission_reference_seq')::text;
  end if;
  return new;
end;
$function$;
