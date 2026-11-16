update public.profiles p
set permissions = coalesce(p.permissions, '{}'::jsonb) || jsonb_build_object(
  'operations_admin', true,
  'clients_create', true,
  'clients_edit', true,
  'tasks_create', true,
  'calendar_manage', true,
  'eod_reports', true,
  'sensitive_credentials_view', true,
  'users_manage', false
)
from auth.users u
where u.id = p.id
  and lower(u.email) = lower('info.alejamundarain@gmail.com');

drop policy if exists "Creator or superadmin deletes calendar events" on public.calendar_events;
create policy "Creator or operations admin deletes calendar events"
on public.calendar_events for delete to authenticated
using (
  created_by = (select auth.uid())
  or (select private.has_permission('operations_admin'))
);

drop policy if exists "Creator or superadmin updates calendar events" on public.calendar_events;
create policy "Creator or operations admin updates calendar events"
on public.calendar_events for update to authenticated
using (
  created_by = (select auth.uid())
  or (select private.has_permission('operations_admin'))
)
with check (
  (
    created_by = (select auth.uid())
    or (select private.has_permission('operations_admin'))
  )
  and (select private.has_permission('calendar_manage'))
);

drop policy if exists "Role reads workflow or superadmin" on public.client_workflow_steps;
create policy "Role reads workflow or operations admin"
on public.client_workflow_steps for select to authenticated
using (
  (select private.has_permission('operations_admin'))
  or owner_role = (select private.current_app_role())
);

drop policy if exists "Role updates workflow or superadmin" on public.client_workflow_steps;
create policy "Role updates workflow or operations admin"
on public.client_workflow_steps for update to authenticated
using (
  (select private.has_permission('operations_admin'))
  or owner_role = (select private.current_app_role())
)
with check (
  (select private.has_permission('operations_admin'))
  or owner_role = (select private.current_app_role())
);

drop policy if exists "Superadmin inserts workflow" on public.client_workflow_steps;
create policy "Operations admin inserts workflow"
on public.client_workflow_steps for insert to authenticated
with check ((select private.has_permission('operations_admin')));

drop policy if exists "Superadmin deletes workflow" on public.client_workflow_steps;
create policy "Operations admin deletes workflow"
on public.client_workflow_steps for delete to authenticated
using ((select private.has_permission('operations_admin')));

drop policy if exists "Active role tasks or superadmin" on public.tasks;
create policy "Active role tasks or operations admin"
on public.tasks for select to authenticated
using (
  (select private.current_app_role()) is not null
  and (
    (select private.has_permission('operations_admin'))
    or owner_role is null
    or owner_role = (select private.current_app_role())
  )
);

drop policy if exists "Active role updates assigned or shared tasks" on public.tasks;
create policy "Active role updates assigned or operations admin"
on public.tasks for update to authenticated
using (
  (select private.current_app_role()) is not null
  and (
    (select private.has_permission('operations_admin'))
    or owner_role is null
    or owner_role = (select private.current_app_role())
  )
)
with check (
  (select private.current_app_role()) is not null
  and (
    (select private.has_permission('operations_admin'))
    or owner_role is null
    or owner_role = (select private.current_app_role())
  )
);

drop policy if exists "Permitted users create assigned tasks" on public.tasks;
create policy "Permitted users create assigned tasks"
on public.tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (select private.has_permission('operations_admin'))
    or (
      (select private.has_permission('tasks_create'))
      and owner_role = (select private.current_app_role())
    )
  )
);

drop policy if exists "Superadmin deletes tasks" on public.tasks;
create policy "Operations admin deletes tasks"
on public.tasks for delete to authenticated
using ((select private.has_permission('operations_admin')));

drop policy if exists "Superadmin creates notes" on public.notes;
create policy "Operations admin creates notes"
on public.notes for insert to authenticated
with check (
  (select private.has_permission('operations_admin'))
  and created_by = (select auth.uid())
);

drop policy if exists "Superadmin updates notes" on public.notes;
create policy "Operations admin updates notes"
on public.notes for update to authenticated
using ((select private.has_permission('operations_admin')))
with check (
  (select private.has_permission('operations_admin'))
  and created_by = (select auth.uid())
);

drop policy if exists "Superadmin deletes notes" on public.notes;
create policy "Operations admin deletes notes"
on public.notes for delete to authenticated
using ((select private.has_permission('operations_admin')));

drop policy if exists "Superadmin updates company branding" on public.company_settings;
create policy "Operations admin updates company branding"
on public.company_settings for update to authenticated
using ((select private.has_permission('operations_admin')))
with check ((select private.has_permission('operations_admin')));

drop policy if exists "Active users read own EOD; superadmin reads all" on public.eod_reports;
create policy "Active users read own EOD; operations admin reads all"
on public.eod_reports for select to authenticated
using (
  (select private.current_app_role()) is not null
  and (
    user_id = (select auth.uid())
    or (select private.has_permission('operations_admin'))
  )
);

drop policy if exists "Superadmin creates training modules" on public.training_modules;
create policy "Operations admin creates training modules"
on public.training_modules for insert to authenticated
with check ((select private.has_permission('operations_admin')));

drop policy if exists "Superadmin updates training modules" on public.training_modules;
create policy "Operations admin updates training modules"
on public.training_modules for update to authenticated
using ((select private.has_permission('operations_admin')))
with check ((select private.has_permission('operations_admin')));

drop policy if exists "Superadmin deletes training modules" on public.training_modules;
create policy "Operations admin deletes training modules"
on public.training_modules for delete to authenticated
using ((select private.has_permission('operations_admin')));

drop policy if exists "Superadmin creates training items" on public.training_items;
create policy "Operations admin creates training items"
on public.training_items for insert to authenticated
with check ((select private.has_permission('operations_admin')));

drop policy if exists "Superadmin updates training items" on public.training_items;
create policy "Operations admin updates training items"
on public.training_items for update to authenticated
using ((select private.has_permission('operations_admin')))
with check ((select private.has_permission('operations_admin')));

drop policy if exists "Superadmin deletes training items" on public.training_items;
create policy "Operations admin deletes training items"
on public.training_items for delete to authenticated
using ((select private.has_permission('operations_admin')));

drop policy if exists "Superadmin uploads branding" on storage.objects;
create policy "Operations admin uploads branding"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'branding'
  and (select private.has_permission('operations_admin'))
);

drop policy if exists "Superadmin updates branding" on storage.objects;
create policy "Operations admin updates branding"
on storage.objects for update to authenticated
using (
  bucket_id = 'branding'
  and (select private.has_permission('operations_admin'))
)
with check (
  bucket_id = 'branding'
  and (select private.has_permission('operations_admin'))
);

drop policy if exists "Superadmin deletes branding" on storage.objects;
create policy "Operations admin deletes branding"
on storage.objects for delete to authenticated
using (
  bucket_id = 'branding'
  and (select private.has_permission('operations_admin'))
);
