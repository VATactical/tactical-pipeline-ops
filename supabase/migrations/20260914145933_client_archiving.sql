alter table public.clients
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text not null default '',
  add column if not exists archive_note text not null default '';

alter table public.clients
  drop constraint if exists clients_archive_reason_check;

alter table public.clients
  add constraint clients_archive_reason_check check (
    char_length(archive_reason) <= 160
    and char_length(archive_note) <= 2000
    and (not archived or char_length(btrim(archive_reason)) > 0)
  );

create index if not exists clients_archived_idx
  on public.clients (archived, archived_at desc);

create index if not exists clients_archived_by_idx
  on public.clients (archived_by);

create or replace function private.prepare_client_archive_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  actor_role text;
begin
  if new.archived is distinct from old.archived then
    select p.role into actor_role
    from public.profiles p
    where p.id = (select auth.uid());

    if coalesce(actor_role, '') not in ('superadmin', 'user_admin') then
      raise exception 'Only Superadmin or User Admin can archive or restore clients';
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

drop trigger if exists clients_prepare_archive_change on public.clients;
create trigger clients_prepare_archive_change
before update of archived, archive_reason, archive_note
on public.clients
for each row execute function private.prepare_client_archive_change();

revoke all on function private.prepare_client_archive_change() from public, anon, authenticated;
