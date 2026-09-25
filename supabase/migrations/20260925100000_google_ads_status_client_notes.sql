alter table public.clients
  add column if not exists google_ads_status text not null default 'Pendiente';

drop policy if exists "Operations admin creates notes" on public.notes;
create policy "Permitted team creates notes"
  on public.notes
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select private.has_permission('operations_admin'))
      or (
        client_id is not null
        and (select private.has_permission('clients_edit'))
      )
    )
  );
