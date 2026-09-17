-- General admin action audit log, generalizing the append-only ledger
-- pattern already proven by inventory_movements: one row per notable
-- privileged action, never updated or deleted, so "who did this and when"
-- is always answerable later.
--
-- Writes only ever come from the service_role Vercel functions (never
-- directly from the browser) via logAdminAction() in api/_lib/auditLog.ts.
-- Reads are staff-only, further restricted to owner/administrator — the
-- same pair of roles the permission matrix (src/admin/permissions.ts)
-- grants "audit.view" to.

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  actor_role text,
  action text not null,
  resource_type text not null,
  resource_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Append-only log of privileged admin actions. Never updated or deleted from the app; written only by service-role Vercel functions via logAdminAction().';

create index admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_resource_idx on public.admin_audit_log (resource_type, resource_id);
create index admin_audit_log_actor_id_idx on public.admin_audit_log (actor_id);

alter table public.admin_audit_log enable row level security;

-- Mirrors current_app_role()'s own JWT-claims-parsing pattern (same
-- app_metadata nesting, same fail-CLOSED shape: anything missing or
-- unrecognized returns null rather than defaulting to an allowed role).
create or replace function public.current_staff_role()
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_raw text;
  v_claims jsonb;
  v_role text;
begin
  v_raw := current_setting('request.jwt.claims', true);
  if v_raw is null or v_raw = '' then
    return null;
  end if;
  begin
    v_claims := v_raw::jsonb;
  exception when others then
    return null;
  end;
  v_role := nullif(v_claims -> 'app_metadata' ->> 'staff_role', '');
  if v_role is null or v_role not in ('owner', 'administrator', 'fulfillment', 'inventory') then
    return null;
  end if;
  return v_role;
end;
$function$;

-- Owner/administrator can read the log. There is deliberately no INSERT/
-- UPDATE/DELETE policy for authenticated/anon — every write goes through
-- the service_role key from a Vercel function, which bypasses RLS entirely,
-- so staff (including an owner) can never edit or delete an entry from the
-- browser.
create policy admin_audit_log_select_privileged on public.admin_audit_log
  for select
  to authenticated
  using (
    public.is_staff()
    and public.current_staff_role() in ('owner', 'administrator')
  );

grant select on public.admin_audit_log to authenticated;
