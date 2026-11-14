drop policy if exists "Role updates own tasks" on public.tasks;
create policy "Role updates assigned or shared tasks" on public.tasks
  for update to authenticated
  using (
    (select private.is_superadmin())
    or owner_role is null
    or owner_role = (select private.current_app_role())
  )
  with check (
    (select private.is_superadmin())
    or owner_role is null
    or owner_role = (select private.current_app_role())
  );
