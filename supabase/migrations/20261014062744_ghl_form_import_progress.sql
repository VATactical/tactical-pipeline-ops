-- Add progress metadata used by the GHL onboarding webhook and operations log.
-- Existing import rows and payloads are preserved.

alter table public.ghl_form_imports
  add column if not exists sync_stage text not null default 'received',
  add column if not exists attempt_count integer not null default 1,
  add column if not exists last_attempt_at timestamptz;

update public.ghl_form_imports
set sync_stage = case status
  when 'processed' then 'processed'
  when 'failed' then 'failed'
  when 'duplicate' then 'duplicate'
  else 'received'
end
where sync_stage = 'received';

update public.ghl_form_imports
set last_attempt_at = coalesce(processed_at, received_at, created_at, now())
where last_attempt_at is null;

alter table public.ghl_form_imports
  alter column last_attempt_at set default now(),
  alter column last_attempt_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ghl_form_imports'::regclass
      and conname = 'ghl_form_imports_sync_stage_check'
  ) then
    alter table public.ghl_form_imports
      add constraint ghl_form_imports_sync_stage_check
      check (sync_stage in (
        'received', 'payload_saved', 'client_matched', 'client_saved',
        'secrets_saved', 'audit_saved', 'processed', 'failed', 'duplicate'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ghl_form_imports'::regclass
      and conname = 'ghl_form_imports_attempt_count_check'
  ) then
    alter table public.ghl_form_imports
      add constraint ghl_form_imports_attempt_count_check
      check (attempt_count >= 1);
  end if;
end
$$;

comment on column public.ghl_form_imports.sync_stage is
  'Last successful or terminal stage of GHL onboarding synchronization.';
comment on column public.ghl_form_imports.attempt_count is
  'Number of processing attempts for this idempotent GHL event.';
comment on column public.ghl_form_imports.last_attempt_at is
  'Timestamp of the most recent processing attempt.';
