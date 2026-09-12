drop policy if exists "Role creates own tasks" on public.tasks;
create policy "Permitted users create assigned tasks" on public.tasks
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select private.is_superadmin())
      or (
        (select private.has_permission('tasks_create'))
        and owner_role = (select private.current_app_role())
      )
    )
  );
