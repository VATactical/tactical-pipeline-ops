-- Security/consistency audit 2026-11.
-- The migration client_ops_lifecycle_followups was never recorded in production (the file was
-- also corrupted by a bad merge), so objects the app already uses are missing:
--   * clients.lifecycle_stage   -> changing a client's stage on the dossier tab fails
--   * tasks.next_step           -> creating tasks (incl. "convert note/comment to task") fails
--   * reassign_client_code()    -> changing a visible client code fails
--   * client_code_history       -> required by reassign_client_code()
-- This migration restores only those objects and is safe to re-run.
--
-- Intentionally NOT restored (the current UI has no flow for them and they would block work):
--   * client_field_verifications + validate_client_lifecycle_stage trigger (would reject every
--     stage change because no field can be marked verified from the UI)
--   * require_eod_late_reason trigger (9 existing late EODs have no reason; the trigger would
--     block editing them and could block payroll-relevant submissions)

alter table public.clients
  add column if not exists lifecycle_stage text not null default 'onboarding';

alter table public.clients
  drop constraint if exists clients_lifecycle_stage_check;
alter table public.clients
  add constraint clients_lifecycle_stage_check
  check (lifecycle_stage in ('onboarding','data_access','technical_setup','campaign_ready','campaign_active','training','cruise_control'));

alter table public.tasks
  add column if not exists next_step text not null default '';

create table if not exists public.client_code_history (
  id bigint generated always as identity primary key,
  client_id text not null references public.clients(id) on delete cascade,
  previous_code text not null,
  new_code text not null,
  reason text not null default 'manual',
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.client_code_history enable row level security;
revoke all on public.client_code_history from anon, authenticated;
grant select on public.client_code_history to authenticated;

drop policy if exists "Client editors read client code history" on public.client_code_history;
create policy "Client editors read client code history"
on public.client_code_history for select to authenticated
using ((select private.has_permission('clients_edit')));

create index if not exists client_code_history_client_created_idx
  on public.client_code_history (client_id, created_at desc);

comment on table public.client_code_history is 'Visible client number changes; clients.id remains stable and all relations continue to use it.';

create or replace function public.reassign_client_code(p_client_id text, p_new_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_code text;
  v_collision_id text;
  v_collision_archived boolean;
  v_displaced_code text;
begin
  if not (select private.has_permission('clients_edit')) then
    raise exception 'Client edit permission is required';
  end if;

  if p_new_code is null or p_new_code !~ '^[A-Z][A-Z0-9-]{0,29}$' then
    raise exception 'Use a visible client number with letters, numbers, or hyphens';
  end if;

  select c.code into v_old_code
  from public.clients c
  where c.id = p_client_id and not c.archived
  for update;
  if not found then
    raise exception 'Active client was not found';
  end if;

  if v_old_code = p_new_code then
    return v_old_code;
  end if;

  select c.id, c.archived into v_collision_id, v_collision_archived
  from public.clients c
  where c.code = p_new_code and c.id <> p_client_id
  for update;

  if v_collision_id is not null and not v_collision_archived then
    raise exception 'That client number is assigned to an active client';
  end if;

  if v_collision_id is not null then
    v_displaced_code := left('ARCH-' || p_new_code || '-' || right(replace(v_collision_id, '-', ''), 8), 30);
    update public.clients
    set code = v_displaced_code, updated_at = now()
    where id = v_collision_id;

    insert into public.client_code_history (client_id, previous_code, new_code, reason, changed_by)
    values (v_collision_id, p_new_code, v_displaced_code, 'archived number released for reuse', (select auth.uid()));
  end if;

  update public.clients
  set code = p_new_code, updated_at = now()
  where id = p_client_id;

  insert into public.client_code_history (client_id, previous_code, new_code, reason, changed_by)
  values (p_client_id, v_old_code, p_new_code, 'manual visible code change', (select auth.uid()));

  return p_new_code;
end;
$$;

revoke all on function public.reassign_client_code(text,text) from public, anon;
grant execute on function public.reassign_client_code(text,text) to authenticated;
