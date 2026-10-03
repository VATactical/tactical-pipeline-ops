-- Additive operations improvements. No client rows are renumbered or archived by this migration.
alter table public.clients
  add column if not exists lifecycle_stage text not null default 'onboarding';

alter table public.clients
  drop constraint if exists clients_lifecycle_stage_check;
alter table public.clients
  add constraint clients_lifecycle_stage_check
  check (lifecycle_stage in ('onboarding','data_access','technical_setup','campaign_ready','campaign_active','training','cruise_control'));

alter table public.tasks
  add column if not exists next_step text not null default '';

alter table public.eod_reports
  add column if not exists late_reason text not null default '';

comment on column public.eod_reports.created_at is 'Actual first creation timestamp; stable when an existing report is updated.';
comment on column public.eod_reports.report_date is 'Work date reported by the user, interpreted in America/New_York.';
comment on column public.eod_reports.submitted_at is 'Actual timestamp of the latest EOD submission/update.';
comment on column public.eod_reports.late_reason is 'Required explanation when the report is submitted after its New York work date.';

create or replace function private.require_eod_late_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.report_date < (now() at time zone 'America/New_York')::date
     and nullif(btrim(coalesce(new.late_reason, '')), '') is null then
    raise exception 'A reason is required for a late EOD report';
  end if;
  new.late_reason := btrim(coalesce(new.late_reason, ''));
  return new;
end;
$$;

drop trigger if exists eod_reports_require_late_reason on public.eod_reports;
create trigger eod_reports_require_late_reason
before insert or update of report_date, submitted_at, late_reason
on public.eod_reports
for each row execute function private.require_eod_late_reason();
revoke all on function private.require_eod_late_reason() from public, anon, authenticated;

alter table public.ghl_form_imports
  add column if not exists attempt_count integer not null default 1,
  add column if not exists last_attempt_at timestamptz not null default now(),
  add column if not exists sync_stage text not null default 'received'
    check (sync_stage in ('received','payload_saved','client_matched','client_saved','secrets_saved','audit_saved','notified','processed','failed'));

create table if not exists public.client_field_verifications (
  client_id text not null references public.clients(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,80}$'),
  status text not null default 'pending'
    check (status in ('complete','pending','not_applicable','verify')),
  note text not null default '' check (char_length(note) <= 1000),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (client_id, field_key),
  check (
    (status in ('complete','not_applicable') and verified_by is not null and verified_at is not null)
    or (status in ('pending','verify'))
  )
);

alter table public.client_field_verifications enable row level security;
grant select, insert, update on public.client_field_verifications to authenticated;

create policy "Active team reads client field verifications"
on public.client_field_verifications for select to authenticated
using ((select private.current_app_role()) is not null);

create policy "Client editors insert field verifications"
on public.client_field_verifications for insert to authenticated
with check (
  (select private.has_permission('clients_edit'))
  and (
    (status in ('complete','not_applicable') and verified_by = (select auth.uid()) and verified_at is not null)
    or status in ('pending','verify')
  )
);

create policy "Client editors update field verifications"
on public.client_field_verifications for update to authenticated
using ((select private.has_permission('clients_edit')))
with check (
  (select private.has_permission('clients_edit'))
  and (
    (status in ('complete','not_applicable') and verified_by = (select auth.uid()) and verified_at is not null)
    or status in ('pending','verify')
  )
);

create index if not exists client_field_verifications_status_idx
  on public.client_field_verifications (client_id, status);

create or replace function private.validate_client_field_verification()
returns trigger
language plpgsql
set search_path = ''
as $
declare
  v_value text;
begin
  if new.status <> 'complete' then
    return new;
  end if;

  select to_jsonb(c) ->> new.field_key into v_value
  from public.clients c
  where c.id = new.client_id;

  if v_value is null or btrim(v_value) = ''
     or v_value ~* '^(pending|pendiente|confirm|verificar|n/?a|none|null)
create table if not exists public.client_interactions (
  id bigint generated always as identity primary key,
  client_id text not null references public.clients(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound','internal')),
  channel text not null check (channel in ('whatsapp','phone','email','sms','ghl','other')),
  summary text not null check (char_length(btrim(summary)) between 1 and 3000),
  responder_id uuid references public.profiles(id) on delete set null,
  next_step text not null default '' check (char_length(next_step) <= 1000),
  next_follow_up_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_interactions enable row level security;
grant select, insert, update on public.client_interactions to authenticated;

create policy "Active team reads client interactions"
on public.client_interactions for select to authenticated
using ((select private.current_app_role()) is not null);

create policy "Client editors create client interactions"
on public.client_interactions for insert to authenticated
with check (
  (select private.has_permission('clients_edit'))
  and created_by = (select auth.uid())
  and (
    responder_id is null
    or private.is_active_profile(responder_id)
  )
);

create policy "Client editors update client interactions"
on public.client_interactions for update to authenticated
using ((select private.has_permission('clients_edit')))
with check (
  (select private.has_permission('clients_edit'))
  and (
    responder_id is null
    or private.is_active_profile(responder_id)
  )
);

create index if not exists client_interactions_client_created_idx
  on public.client_interactions (client_id, created_at desc);
create index if not exists client_interactions_follow_up_idx
  on public.client_interactions (next_follow_up_at)
  where next_follow_up_at is not null;

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
grant select on public.client_code_history to authenticated;
create policy "Client editors read client code history"
on public.client_code_history for select to authenticated
using ((select private.has_permission('clients_edit')));

create index if not exists client_code_history_client_created_idx
  on public.client_code_history (client_id, created_at desc);

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

create or replace function private.validate_client_lifecycle_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stage_order integer;
  v_missing text;
  v_fields text[];
  v_key text;
  v_value text;
  v_status text;
begin
  if new.lifecycle_stage is not distinct from old.lifecycle_stage then
    return new;
  end if;

  v_stage_order := case new.lifecycle_stage
    when 'onboarding' then 1
    when 'data_access' then 2
    when 'technical_setup' then 3
    when 'campaign_ready' then 4
    when 'campaign_active' then 5
    when 'training' then 6
    when 'cruise_control' then 7
    else 0
  end;

  for v_key in
    select required.field_key
    from (values
      (1, 'business_name'), (1, 'legal_name'), (1, 'owner_name'), (1, 'phone'), (1, 'email'),
      (2, 'contact_phone'), (2, 'address'), (2, 'timezone'), (2, 'markets'), (2, 'target_zip_codes'),
      (2, 'services'), (2, 'offer'), (2, 'daily_budget'), (2, 'legal_business_info'), (2, 'payment_method_confirmed'),
      (3, 'ghl_subaccount_link'), (3, 'drive_folder_link'), (3, 'gbp_status'), (3, 'gbp_email'), (3, 'gbp_link'),
      (3, 'facebook_business_info'), (3, 'facebook_access_confirmed'), (3, 'meta_business_portfolio_id'), (3, 'meta_ad_account_id'),
      (3, 'domain'), (3, 'website_url'),
      (4, 'ad_strategy'), (4, 'ideal_customer_profile'), (4, 'available_assets'), (4, 'landing_page_url'),
      (5, 'meta_campaign_live'),
      (6, 'onboarding_completed'),
      (7, 'target_launch_date')
    ) as required(stage_order, field_key)
    where required.stage_order <= v_stage_order
  loop
    select v.status into v_status
    from public.client_field_verifications v
    where v.client_id = new.id and v.field_key = v_key;

    if v_status is distinct from 'complete' and v_status is distinct from 'not_applicable' then
      v_missing := coalesce(v_missing || ', ', '') || v_key;
      continue;
    end if;

    if v_status = 'complete' then
      v_value := coalesce(to_jsonb(new) ->> v_key, '');
      if btrim(v_value) = '' or v_value ~* '^(pending|pendiente|confirm|verificar|n/?a|none|null)$' then
        v_missing := coalesce(v_missing || ', ', '') || v_key;
      elsif v_key in ('payment_method_confirmed','facebook_access_confirmed','meta_campaign_live','onboarding_completed')
        and v_value <> 'true' then
        v_missing := coalesce(v_missing || ', ', '') || v_key;
      end if;
    end if;
  end loop;

  if v_missing is not null then
    raise exception 'Verify required dossier fields before advancing: %', v_missing;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_validate_lifecycle_stage on public.clients;
create trigger clients_validate_lifecycle_stage
before update of lifecycle_stage on public.clients
for each row execute function private.validate_client_lifecycle_stage();
revoke all on function private.validate_client_lifecycle_stage() from public, anon, authenticated;

comment on table public.client_field_verifications is 'Latest verification state for each client dossier field. Completion records actor and timestamp.';
comment on table public.client_interactions is 'Client contact log with owner and next follow-up.';
comment on table public.client_code_history is 'Visible client number changes; clients.id remains stable and all relations continue to use it.';
 then
    raise exception 'A field needs a value before it can be marked complete';
  end if;

  if new.field_key in ('payment_method_confirmed','facebook_access_confirmed','meta_campaign_live','onboarding_completed')
     and v_value <> 'true' then
    raise exception 'Confirm the access or completion before marking this field complete';
  end if;

  return new;
end;
$;

drop trigger if exists client_field_verifications_validate on public.client_field_verifications;
create trigger client_field_verifications_validate
before insert or update of status, field_key, client_id
on public.client_field_verifications
for each row execute function private.validate_client_field_verification();
revoke all on function private.validate_client_field_verification() from public, anon, authenticated;

create table if not exists public.client_interactions (
  id bigint generated always as identity primary key,
  client_id text not null references public.clients(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound','internal')),
  channel text not null check (channel in ('whatsapp','phone','email','sms','ghl','other')),
  summary text not null check (char_length(btrim(summary)) between 1 and 3000),
  responder_id uuid references public.profiles(id) on delete set null,
  next_step text not null default '' check (char_length(next_step) <= 1000),
  next_follow_up_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_interactions enable row level security;
grant select, insert, update on public.client_interactions to authenticated;

create policy "Active team reads client interactions"
on public.client_interactions for select to authenticated
using ((select private.current_app_role()) is not null);

create policy "Client editors create client interactions"
on public.client_interactions for insert to authenticated
with check (
  (select private.has_permission('clients_edit'))
  and created_by = (select auth.uid())
  and (
    responder_id is null
    or private.is_active_profile(responder_id)
  )
);

create policy "Client editors update client interactions"
on public.client_interactions for update to authenticated
using ((select private.has_permission('clients_edit')))
with check (
  (select private.has_permission('clients_edit'))
  and (
    responder_id is null
    or private.is_active_profile(responder_id)
  )
);

create index if not exists client_interactions_client_created_idx
  on public.client_interactions (client_id, created_at desc);
create index if not exists client_interactions_follow_up_idx
  on public.client_interactions (next_follow_up_at)
  where next_follow_up_at is not null;

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
grant select on public.client_code_history to authenticated;
create policy "Client editors read client code history"
on public.client_code_history for select to authenticated
using ((select private.has_permission('clients_edit')));

create index if not exists client_code_history_client_created_idx
  on public.client_code_history (client_id, created_at desc);

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

create or replace function private.validate_client_lifecycle_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stage_order integer;
  v_missing text;
  v_fields text[];
  v_key text;
  v_value text;
  v_status text;
begin
  if new.lifecycle_stage is not distinct from old.lifecycle_stage then
    return new;
  end if;

  v_stage_order := case new.lifecycle_stage
    when 'onboarding' then 1
    when 'data_access' then 2
    when 'technical_setup' then 3
    when 'campaign_ready' then 4
    when 'campaign_active' then 5
    when 'training' then 6
    when 'cruise_control' then 7
    else 0
  end;

  for v_key in
    select required.field_key
    from (values
      (1, 'business_name'), (1, 'legal_name'), (1, 'owner_name'), (1, 'phone'), (1, 'email'),
      (2, 'contact_phone'), (2, 'address'), (2, 'timezone'), (2, 'markets'), (2, 'target_zip_codes'),
      (2, 'services'), (2, 'offer'), (2, 'daily_budget'), (2, 'legal_business_info'), (2, 'payment_method_confirmed'),
      (3, 'ghl_subaccount_link'), (3, 'drive_folder_link'), (3, 'gbp_status'), (3, 'gbp_email'), (3, 'gbp_link'),
      (3, 'facebook_business_info'), (3, 'facebook_access_confirmed'), (3, 'meta_business_portfolio_id'), (3, 'meta_ad_account_id'),
      (3, 'domain'), (3, 'website_url'),
      (4, 'ad_strategy'), (4, 'ideal_customer_profile'), (4, 'available_assets'), (4, 'landing_page_url'),
      (5, 'meta_campaign_live'),
      (6, 'onboarding_completed'),
      (7, 'target_launch_date')
    ) as required(stage_order, field_key)
    where required.stage_order <= v_stage_order
  loop
    select v.status into v_status
    from public.client_field_verifications v
    where v.client_id = new.id and v.field_key = v_key;

    if v_status is distinct from 'complete' and v_status is distinct from 'not_applicable' then
      v_missing := coalesce(v_missing || ', ', '') || v_key;
      continue;
    end if;

    if v_status = 'complete' then
      v_value := coalesce(to_jsonb(new) ->> v_key, '');
      if btrim(v_value) = '' or v_value ~* '^(pending|pendiente|confirm|verificar|n/?a|none|null)$' then
        v_missing := coalesce(v_missing || ', ', '') || v_key;
      elsif v_key in ('payment_method_confirmed','facebook_access_confirmed','meta_campaign_live','onboarding_completed')
        and v_value <> 'true' then
        v_missing := coalesce(v_missing || ', ', '') || v_key;
      end if;
    end if;
  end loop;

  if v_missing is not null then
    raise exception 'Verify required dossier fields before advancing: %', v_missing;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_validate_lifecycle_stage on public.clients;
create trigger clients_validate_lifecycle_stage
before update of lifecycle_stage on public.clients
for each row execute function private.validate_client_lifecycle_stage();
revoke all on function private.validate_client_lifecycle_stage() from public, anon, authenticated;

comment on table public.client_field_verifications is 'Latest verification state for each client dossier field. Completion records actor and timestamp.';
comment on table public.client_interactions is 'Client contact log with owner and next follow-up.';
comment on table public.client_code_history is 'Visible client number changes; clients.id remains stable and all relations continue to use it.';
