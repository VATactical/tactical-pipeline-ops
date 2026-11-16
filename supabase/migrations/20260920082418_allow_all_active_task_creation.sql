drop policy if exists "Permitted users create tasks for team" on public.tasks;
create policy "Active users create tasks for team"
on public.tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.current_app_role()) is not null
  and (assigned_to is null or exists (
    select 1 from public.profiles p
    where p.id = assigned_to and p.active
  ))
);
