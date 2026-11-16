alter table public.tasks
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

comment on column public.tasks.assigned_to is
  'Specific active team member assigned to the task. Null preserves shared and legacy role-based tasks.';

create index if not exists tasks_assigned_to_status_due_idx
  on public.tasks (assigned_to, status, due_at);

-- Preserve existing work by linking tasks whose stored owner name matches an active profile.
update public.tasks t
set assigned_to = p.id,
    owner_role = p.role,
    owner_name = p.full_name
from public.profiles p
where t.assigned_to is null
  and p.active
  and lower(btrim(t.owner_name)) = lower(btrim(p.full_name));

create or replace function private.set_task_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  if new.status = 'Completada' then
    if old.status is distinct from 'Completada' then
      new.completed_at = now();
    end if;
    if old.status is distinct from 'Completada'
       or new.assigned_to is distinct from old.assigned_to
       or new.completed_by is null then
      new.completed_by = coalesce(new.assigned_to, (select auth.uid()));
    end if;
  else
    new.completed_at = null;
    new.completed_by = null;
  end if;
  return new;
end;
$$;

revoke all on function private.set_task_timestamps() from public, anon, authenticated;

update public.tasks
set completed_by = assigned_to
where status = 'Completada'
  and completed_by is null
  and assigned_to is not null;

drop policy if exists "Active role tasks or operations admin" on public.tasks;
create policy "Active users read assigned shared or managed tasks"
on public.tasks for select to authenticated
using (
  (select private.current_app_role()) is not null
  and (
    (select private.has_permission('operations_admin'))
    or assigned_to = (select auth.uid())
    or (
      assigned_to is null
      and (owner_role is null or owner_role = (select private.current_app_role()))
    )
  )
);

drop policy if exists "Active role updates assigned or operations admin" on public.tasks;
create policy "Active users update assigned shared or managed tasks"
on public.tasks for update to authenticated
using (
  (select private.current_app_role()) is not null
  and (
    (select private.has_permission('operations_admin'))
    or assigned_to = (select auth.uid())
    or (
      assigned_to is null
      and (owner_role is null or owner_role = (select private.current_app_role()))
    )
  )
)
with check (
  (select private.current_app_role()) is not null
  and (
    (select private.has_permission('operations_admin'))
    or assigned_to = (select auth.uid())
    or (
      assigned_to is null
      and (owner_role is null or owner_role = (select private.current_app_role()))
    )
  )
);

drop policy if exists "Permitted users create assigned tasks" on public.tasks;
create policy "Permitted users create individual or self tasks"
on public.tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (select private.has_permission('operations_admin'))
    or (
      (select private.has_permission('tasks_create'))
      and assigned_to = (select auth.uid())
    )
  )
);
