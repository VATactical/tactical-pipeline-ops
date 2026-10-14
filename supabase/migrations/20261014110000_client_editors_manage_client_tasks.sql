-- Let team members with client dossier edit permission manage tasks linked to clients.
-- Existing operations-admin, assignee, and shared-task access remains unchanged.
-- Scope this additional access to client-linked tasks; global tasks keep their existing policy.
drop policy if exists "Active users update assigned shared or managed tasks" on public.tasks;

create policy "Active users update assigned shared or client-managed tasks"
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
    or (
      client_id is not null
      and (select private.has_permission('clients_edit'))
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
    or (
      client_id is not null
      and (select private.has_permission('clients_edit'))
    )
  )
);

-- Rollback: drop the policy above and recreate
-- "Active users update assigned shared or managed tasks" with the operations-admin,
-- assigned_to, and shared owner_role conditions from migration
-- 20260919135459_user_assigned_editable_tasks.sql.
