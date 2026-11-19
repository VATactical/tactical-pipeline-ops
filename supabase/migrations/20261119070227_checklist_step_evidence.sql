-- Screenshots that prove a checklist step is done (e.g. GBP access granted).
-- Files live in the private bucket step-evidence at {client_id}/{step_id}/{uuid}.webp.
-- Whoever can see a step sees its evidence and can attach more (same rule as ticking it);
-- the uploader or an operations admin can remove it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('step-evidence', 'step-evidence', false, 5242880, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.client_step_evidence (
  id uuid primary key default gen_random_uuid(),
  step_id bigint not null references public.client_workflow_steps(id) on delete cascade,
  client_id text not null references public.clients(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null default '',
  size_bytes integer not null default 0 check (size_bytes >= 0),
  width integer,
  height integer,
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_step_evidence_step_idx on public.client_step_evidence(step_id);
create index if not exists client_step_evidence_client_idx on public.client_step_evidence(client_id);

-- True when the signed-in user can tick the step (same rule as the workflow update policy).
create or replace function private.can_edit_workflow_step(p_step_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.client_workflow_steps s
    where s.id = p_step_id
      and (private.has_permission('operations_admin') or s.owner_role = private.current_app_role())
  );
$$;

-- True when the signed-in user can read the step (same rule as the workflow read policy).
create or replace function private.can_view_workflow_step(p_step_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.client_workflow_steps s
    where s.id = p_step_id
      and (private.has_permission('operations_admin') or s.owner_role = private.current_app_role())
  );
$$;

revoke all on function private.can_edit_workflow_step(bigint) from public, anon;
revoke all on function private.can_view_workflow_step(bigint) from public, anon;
grant execute on function private.can_edit_workflow_step(bigint) to authenticated;
grant execute on function private.can_view_workflow_step(bigint) to authenticated;

alter table public.client_step_evidence enable row level security;
revoke all on public.client_step_evidence from anon;
grant select, insert, delete on public.client_step_evidence to authenticated;

drop policy if exists "Team reads step evidence" on public.client_step_evidence;
create policy "Team reads step evidence" on public.client_step_evidence
  for select to authenticated
  using ((select private.can_view_workflow_step(step_id)));

drop policy if exists "Step owners add evidence" on public.client_step_evidence;
create policy "Step owners add evidence" on public.client_step_evidence
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and (select private.can_edit_workflow_step(step_id))
    and client_id = (select s.client_id from public.client_workflow_steps s where s.id = step_id)
    and storage_path like client_id || '/' || step_id::text || '/%'
  );

drop policy if exists "Uploader or admin removes evidence" on public.client_step_evidence;
create policy "Uploader or admin removes evidence" on public.client_step_evidence
  for delete to authenticated
  using (uploaded_by = (select auth.uid()) or (select private.has_permission('operations_admin')));

-- Storage: path segments are {client_id}/{step_id}/{file}. The helper parses the path safely
-- (a malformed path is simply denied) and checks that the step belongs to that client.
create or replace function private.step_evidence_path_allowed(p_name text, p_for_upload boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_step_id bigint;
begin
  if coalesce(array_length(v_parts, 1), 0) <> 3 or v_parts[2] !~ '^[0-9]{1,18}$' then
    return false;
  end if;
  v_step_id := v_parts[2]::bigint;
  if not exists (select 1 from public.client_workflow_steps s where s.id = v_step_id and s.client_id = v_parts[1]) then
    return false;
  end if;
  return case when p_for_upload then private.can_edit_workflow_step(v_step_id)
              else private.can_view_workflow_step(v_step_id) end;
end;
$$;
revoke all on function private.step_evidence_path_allowed(text, boolean) from public, anon;
grant execute on function private.step_evidence_path_allowed(text, boolean) to authenticated;

drop policy if exists "Team reads step evidence files" on storage.objects;
create policy "Team reads step evidence files" on storage.objects
  for select to authenticated
  using (bucket_id = 'step-evidence' and (select private.step_evidence_path_allowed(name, false)));

drop policy if exists "Step owners upload evidence files" on storage.objects;
create policy "Step owners upload evidence files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'step-evidence' and (select private.step_evidence_path_allowed(name, true)));

drop policy if exists "Uploader or admin deletes evidence files" on storage.objects;
create policy "Uploader or admin deletes evidence files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'step-evidence'
    and (owner_id = (select auth.uid())::text or (select private.has_permission('operations_admin')))
  );
