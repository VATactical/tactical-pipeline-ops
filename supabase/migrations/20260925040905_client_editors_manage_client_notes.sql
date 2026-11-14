drop policy if exists "Operations admins update notes" on public.notes;
drop policy if exists "Operations admin deletes notes" on public.notes;

create policy "Permitted team updates client notes"
  on public.notes
  for update
  to authenticated
  using (
    (select private.has_permission('operations_admin'))
    or (
      client_id is not null
      and (select private.has_permission('clients_edit'))
    )
  )
  with check (
    (select private.has_permission('operations_admin'))
    or (
      client_id is not null
      and (select private.has_permission('clients_edit'))
    )
  );

create policy "Permitted team deletes client notes"
  on public.notes
  for delete
  to authenticated
  using (
    (select private.has_permission('operations_admin'))
    or (
      client_id is not null
      and (select private.has_permission('clients_edit'))
    )
  );
