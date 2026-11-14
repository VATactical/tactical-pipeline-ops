create or replace function private.prepare_client_archive_change()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  actor_role text;
  actor_active boolean;
begin
  if new.archived is distinct from old.archived then
    select p.role, p.active
      into actor_role, actor_active
    from public.profiles p
    where p.id = (select auth.uid());

    if not coalesce(actor_active, false)
       or (
         coalesce(actor_role, '') not in ('superadmin', 'user_admin')
         and not (select private.has_permission('operations_admin'))
       ) then
      raise exception 'Only Superadmin, User Admin, or an active Operations Admin can archive or restore clients';
    end if;

    if new.archived then
      if nullif(btrim(new.archive_reason), '') is null then
        raise exception 'An archive reason is required';
      end if;
      new.archive_reason = btrim(new.archive_reason);
      new.archive_note = btrim(coalesce(new.archive_note, ''));
      new.archived_at = now();
      new.archived_by = (select auth.uid());
    else
      new.archived_at = null;
      new.archived_by = null;
      new.archive_reason = '';
      new.archive_note = '';
    end if;
  elsif old.archived then
    new.archived = true;
  end if;

  return new;
end;
$function$;
