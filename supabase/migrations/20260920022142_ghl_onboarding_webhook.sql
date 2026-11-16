-- GHL onboarding form integration.
-- Sensitive intake values and raw payloads stay in the private schema.

alter table public.clients
  add column if not exists ghl_contact_id text,
  add column if not exists ghl_location_id text,
  add column if not exists ghl_form_id text,
  add column if not exists onboarding_form_notes text not null default '',
  add column if not exists intake_source text not null default 'manual'
    check (intake_source in ('manual', 'ghl_form'));

create unique index if not exists clients_ghl_location_contact_unique
  on public.clients (ghl_location_id, ghl_contact_id)
  where ghl_location_id is not null and ghl_contact_id is not null;

alter table private.client_secrets
  add column if not exists personal_phone text not null default '',
  add column if not exists personal_email text not null default '',
  add column if not exists gbp_access_email text not null default '',
  add column if not exists ein_tax_id text not null default '';

create table if not exists public.ghl_form_imports (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  location_id text not null,
  contact_id text not null,
  form_id text not null default '',
  client_id text references public.clients(id) on delete set null,
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed', 'duplicate')),
  action text not null default ''
    check (action in ('', 'created', 'updated', 'ignored')),
  error_message text not null default '',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.ghl_form_imports is
  'Non-sensitive receipt log for GHL onboarding form imports.';

alter table public.ghl_form_imports enable row level security;
revoke all on public.ghl_form_imports from anon, authenticated;
grant select on public.ghl_form_imports to authenticated;
grant usage, select on sequence public.ghl_form_imports_id_seq to authenticated;

create policy "Operations admins read GHL form imports"
on public.ghl_form_imports
for select
to authenticated
using ((select private.has_permission('operations_admin')));

create index if not exists ghl_form_imports_received_idx
  on public.ghl_form_imports (received_at desc);
create index if not exists ghl_form_imports_client_idx
  on public.ghl_form_imports (client_id, received_at desc);

create table if not exists private.ghl_form_payloads (
  import_id bigint primary key references public.ghl_form_imports(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on private.ghl_form_payloads from public, anon, authenticated;

create table if not exists private.integration_webhook_tokens (
  integration_name text primary key,
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

revoke all on private.integration_webhook_tokens from public, anon, authenticated;

insert into private.integration_webhook_tokens
  (integration_name, token_sha256, active, rotated_at)
values
  ('ghl_onboarding', 'f42da45e5bc881f96f9b54bb4a80edb7f8aebc1532ebd18c0fa622e7920b7ee5', true, now())
on conflict (integration_name) do update
set token_sha256 = excluded.token_sha256,
    active = true,
    rotated_at = now();

grant select, insert, update on public.ghl_form_imports to service_role;
grant usage, select on sequence public.ghl_form_imports_id_seq to service_role;

create or replace function public.verify_integration_webhook_token(
  p_integration_name text,
  p_token_sha256 text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if current_user <> 'service_role'
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    return false;
  end if;
  return exists (
    select 1
    from private.integration_webhook_tokens
    where integration_name = p_integration_name
      and token_sha256 = p_token_sha256
      and active
  );
end;
$$;

revoke all on function public.verify_integration_webhook_token(text, text)
  from public, anon, authenticated;
grant execute on function public.verify_integration_webhook_token(text, text)
  to service_role;

create or replace function public.store_ghl_form_payload(
  p_import_id bigint,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.ghl_form_payloads (import_id, payload)
  values (p_import_id, p_payload)
  on conflict (import_id) do update
  set payload = excluded.payload,
      created_at = now();
end;
$$;

revoke all on function public.store_ghl_form_payload(bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.store_ghl_form_payload(bigint, jsonb)
  to service_role;

create or replace function public.save_ghl_client_secrets(
  p_client_id text,
  p_personal_phone text,
  p_personal_email text,
  p_gbp_access_email text,
  p_ein_tax_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.client_secrets (
    client_id, personal_phone, personal_email, gbp_access_email, ein_tax_id, updated_at
  ) values (
    p_client_id,
    coalesce(p_personal_phone, ''),
    coalesce(p_personal_email, ''),
    coalesce(p_gbp_access_email, ''),
    coalesce(p_ein_tax_id, ''),
    now()
  )
  on conflict (client_id) do update
  set personal_phone = case when excluded.personal_phone <> '' then excluded.personal_phone else private.client_secrets.personal_phone end,
      personal_email = case when excluded.personal_email <> '' then excluded.personal_email else private.client_secrets.personal_email end,
      gbp_access_email = case when excluded.gbp_access_email <> '' then excluded.gbp_access_email else private.client_secrets.gbp_access_email end,
      ein_tax_id = case when excluded.ein_tax_id <> '' then excluded.ein_tax_id else private.client_secrets.ein_tax_id end,
      updated_at = now();
end;
$$;

revoke all on function public.save_ghl_client_secrets(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.save_ghl_client_secrets(text, text, text, text, text)
  to service_role;
