-- Allow task creators to assign active teammates without exposing all profiles.
-- The helper runs with controlled definer privileges because profiles RLS only
-- exposes each user's own row to the client.
create or replace function private.is_active_profile(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.active
  );
$function$;

revoke all on function private.is_active_profile(uuid) from public;
grant execute on function private.is_active_profile(uuid) to authenticated;

drop policy if exists "Active users create tasks for team" on public.tasks;
create policy "Active users create tasks for team"
on public.tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.current_app_role()) is not null
  and (assigned_to is null or (select private.is_active_profile(assigned_to)))
);
