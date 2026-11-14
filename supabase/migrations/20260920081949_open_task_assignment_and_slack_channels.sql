-- Allow every user with task creation permission to assign a task to any
-- active teammate or leave it shared. Keep recipients limited by existing
-- task visibility policies and preserve creator visibility.
drop policy if exists "Permitted users create individual or self tasks" on public.tasks;
create policy "Permitted users create tasks for team"
on public.tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_permission('tasks_create'))
  and (assigned_to is null or exists (
    select 1 from public.profiles p
    where p.id = assigned_to and p.active
  ))
);

drop policy if exists "Active users read assigned shared or managed tasks" on public.tasks;
create policy "Active users read assigned shared created or managed tasks"
on public.tasks for select to authenticated
using (
  (select private.current_app_role()) is not null
  and (
    (select private.has_permission('operations_admin'))
    or created_by = (select auth.uid())
    or assigned_to = (select auth.uid())
    or (
      assigned_to is null
      and (owner_role is null or owner_role = (select private.current_app_role()))
    )
  )
);

alter table public.notes
  add column if not exists slack_channel text not null default ''
  check (char_length(slack_channel) <= 80);

grant update (slack_channel) on public.notes to authenticated;
