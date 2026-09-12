create or replace function private.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'superadmin' and active
  );
$$;

revoke all on function private.is_superadmin() from public, anon;
grant execute on function private.is_superadmin() to authenticated;

alter table public.tasks
  add column if not exists completed_by uuid references public.profiles(id) on delete set null;

create or replace function private.set_task_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  if new.status = 'Completada' and old.status is distinct from 'Completada' then
    new.completed_at = now();
    new.completed_by = (select auth.uid());
  elsif new.status <> 'Completada' then
    new.completed_at = null;
    new.completed_by = null;
  end if;
  return new;
end;
$$;

revoke all on function private.set_task_timestamps() from public, anon, authenticated;
create index if not exists tasks_completed_by_at_idx on public.tasks (completed_by, completed_at desc);
