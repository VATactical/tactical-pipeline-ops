-- Team user removal: a superadmin can remove a team member and every access they had.
--
-- Hard-deleting the auth user would CASCADE-delete the member's EOD reports, time entries,
-- daily EOD status, notes, comments and calendar events (payroll history), and would fail
-- outright for members with ad reports or client interactions (ON DELETE RESTRICT). So a
-- removal keeps the profile row for history and removes access instead:
--   profile inactive + deleted_at, department roles removed, auth user banned with a random
--   password, and every session / refresh token revoked.

alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

comment on column public.profiles.deleted_at is 'Set when a superadmin removes the member. The row is kept so EOD, payroll and activity history stay intact; the member has no access.';

alter table public.profiles drop constraint if exists profiles_deleted_inactive_check;
alter table public.profiles
  add constraint profiles_deleted_inactive_check check (deleted_at is null or not active);

create index if not exists profiles_deleted_by_idx on public.profiles (deleted_by);

-- Signs a user out everywhere. Only the service role (Edge Functions) may call it.
create or replace function public.revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sessions integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and current_user not in ('service_role', 'postgres') then
    raise exception 'Not allowed';
  end if;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_sessions = row_count;
  return v_sessions;
end;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

-- One-time cleanup: members already marked inactive but still able to sign in.
update auth.users u
set banned_until = now() + interval '100 years'
from public.profiles p
where p.id = u.id
  and not p.active
  and p.role <> 'superadmin'
  and (u.banned_until is null or u.banned_until < now());

delete from auth.refresh_tokens t
using public.profiles p
where t.user_id = p.id::text and not p.active and p.role <> 'superadmin';

delete from auth.sessions s
using public.profiles p
where s.user_id = p.id and not p.active and p.role <> 'superadmin';
