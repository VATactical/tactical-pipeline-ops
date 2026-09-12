create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and active;
$$;

revoke all on function private.current_app_role() from public, anon;
grant execute on function private.current_app_role() to authenticated;

drop policy if exists "Authenticated team reads clients" on public.clients;
create policy "Active team reads clients" on public.clients
  for select to authenticated using ((select private.current_app_role()) is not null);

drop policy if exists "Role tasks or superadmin" on public.tasks;
create policy "Active role tasks or superadmin" on public.tasks
  for select to authenticated
  using (
    (select private.current_app_role()) is not null
    and ((select private.is_superadmin()) or owner_role is null or owner_role = (select private.current_app_role()))
  );

drop policy if exists "Role updates assigned or shared tasks" on public.tasks;
create policy "Active role updates assigned or shared tasks" on public.tasks
  for update to authenticated
  using (
    (select private.current_app_role()) is not null
    and ((select private.is_superadmin()) or owner_role is null or owner_role = (select private.current_app_role()))
  )
  with check (
    (select private.current_app_role()) is not null
    and ((select private.is_superadmin()) or owner_role is null or owner_role = (select private.current_app_role()))
  );

drop policy if exists "Authenticated team reads blockers" on public.blockers;
create policy "Active team reads blockers" on public.blockers
  for select to authenticated using ((select private.current_app_role()) is not null);

drop policy if exists "Team reads notes" on public.notes;
create policy "Active team reads notes" on public.notes
  for select to authenticated using ((select private.current_app_role()) is not null);

drop policy if exists "Users read own EOD; superadmin reads all" on public.eod_reports;
create policy "Active users read own EOD; superadmin reads all" on public.eod_reports
  for select to authenticated
  using ((select private.current_app_role()) is not null and (user_id = (select auth.uid()) or (select private.is_superadmin())));

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Active users read own notifications" on public.notifications
  for select to authenticated
  using ((select private.current_app_role()) is not null and recipient_id = (select auth.uid()));

drop policy if exists "Users mark own notifications read" on public.notifications;
create policy "Active users mark own notifications read" on public.notifications
  for update to authenticated
  using ((select private.current_app_role()) is not null and recipient_id = (select auth.uid()))
  with check ((select private.current_app_role()) is not null and recipient_id = (select auth.uid()));
