create policy "Onboarding deletes archived clients"
on public.clients
for delete
to authenticated
using (
  archived is true
  and (select private.current_app_role()) = 'onboarding_media'
);
