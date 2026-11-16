-- Phase 1 / GHL: live lead and appointment metrics per client and billing period.
-- The GHL Private Integration Token of each sub-account stays in the private schema.

alter table public.clients
  add column if not exists ads_launched_on date,
  add column if not exists billing_cycle_anchor date,
  add column if not exists billing_cycle_days integer not null default 30,
  add column if not exists ghl_qualified_tag text not null default 'qualified';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_billing_cycle_days_range'
  ) then
    alter table public.clients
      add constraint clients_billing_cycle_days_range
      check (billing_cycle_days between 7 and 92);
  end if;
end;
$$;

comment on column public.clients.billing_cycle_anchor is
  'First day of the first billing cycle. Cycles repeat every billing_cycle_days from here.';
comment on column public.clients.ghl_qualified_tag is
  'GHL contact tag that marks a lead as qualified for this client.';

alter table private.client_secrets
  add column if not exists ghl_private_token text not null default '';

-- Current billing period for a client (falls back to a rolling 30 days ending today).
create or replace function public.client_billing_period(
  p_anchor date,
  p_days integer,
  p_today date default (now() at time zone 'America/New_York')::date
)
returns table (period_start date, period_end date)
language sql
immutable
set search_path = ''
as $$
  select
    case
      when p_anchor is null or p_anchor > p_today then p_today - (coalesce(p_days, 30) - 1)
      else p_anchor + ((p_today - p_anchor) / coalesce(p_days, 30)) * coalesce(p_days, 30)
    end,
    case
      when p_anchor is null or p_anchor > p_today then p_today
      else p_anchor + ((p_today - p_anchor) / coalesce(p_days, 30)) * coalesce(p_days, 30) + (coalesce(p_days, 30) - 1)
    end;
$$;

grant execute on function public.client_billing_period(date, integer, date) to authenticated, service_role;

create table if not exists public.client_ghl_metrics (
  id bigint generated always as identity primary key,
  client_id text not null references public.clients(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  leads integer not null default 0,
  qualified_leads integer not null default 0,
  appointments_booked integer not null default 0,
  appointments_cancelled integer not null default 0,
  sync_status text not null default 'ok' check (sync_status in ('ok', 'error')),
  error_message text not null default '',
  synced_at timestamptz not null default now(),
  synced_by uuid references public.profiles(id) on delete set null,
  unique (client_id, period_start)
);

comment on table public.client_ghl_metrics is
  'Lead and appointment counts pulled from each client GHL sub-account, one row per billing period.';

create index if not exists client_ghl_metrics_client_period_idx
  on public.client_ghl_metrics (client_id, period_start desc);
create index if not exists client_ghl_metrics_synced_by_idx
  on public.client_ghl_metrics (synced_by);

alter table public.client_ghl_metrics enable row level security;
revoke all on public.client_ghl_metrics from anon, authenticated;
grant select on public.client_ghl_metrics to authenticated;
grant select, insert, update on public.client_ghl_metrics to service_role;
grant usage, select on sequence public.client_ghl_metrics_id_seq to service_role;

drop policy if exists "Active team reads GHL metrics" on public.client_ghl_metrics;
create policy "Active team reads GHL metrics"
on public.client_ghl_metrics
for select
to authenticated
using ((select private.current_app_role()) is not null);

-- Superadmin saves (or clears) a sub-account token.
create or replace function public.save_client_ghl_token(p_client_id text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  allowed boolean;
begin
  select p.active and p.role = 'superadmin'
  into allowed
  from public.profiles p
  where p.id = (select auth.uid());

  if not coalesce(allowed, false) then
    raise exception 'Only Superadmin can update sensitive credentials';
  end if;

  insert into private.client_secrets (client_id, ghl_private_token, updated_at, updated_by)
  values (p_client_id, btrim(coalesce(p_token, '')), now(), (select auth.uid()))
  on conflict (client_id) do update
  set ghl_private_token = excluded.ghl_private_token,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  insert into private.client_secret_access_log (client_id, actor_id, action)
  values (p_client_id, (select auth.uid()), 'updated');
end;
$function$;

-- Lets the UI show "connected" without ever returning the token.
create or replace function public.client_ghl_token_configured(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.current_app_role()) is not null
    and exists (
      select 1 from private.client_secrets s
      where s.client_id = p_client_id and s.ghl_private_token <> ''
    );
$$;

-- Only the sync Edge Function (service role) can read tokens.
create or replace function public.get_ghl_sync_targets(p_client_id text default null)
returns table (
  client_id text,
  location_id text,
  token text,
  qualified_tag text,
  billing_cycle_anchor date,
  billing_cycle_days integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if current_user <> 'service_role'
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  return query
  select c.id, c.ghl_location_id, s.ghl_private_token, c.ghl_qualified_tag,
         c.billing_cycle_anchor, c.billing_cycle_days
  from public.clients c
  join private.client_secrets s on s.client_id = c.id
  where coalesce(c.archived, false) = false
    and coalesce(c.ghl_location_id, '') <> ''
    and s.ghl_private_token <> ''
    and (p_client_id is null or c.id = p_client_id);
end;
$$;

revoke all on function public.save_client_ghl_token(text, text) from public, anon;
revoke all on function public.client_ghl_token_configured(text) from public, anon;
revoke all on function public.get_ghl_sync_targets(text) from public, anon, authenticated;
grant execute on function public.save_client_ghl_token(text, text) to authenticated;
grant execute on function public.client_ghl_token_configured(text) to authenticated;
grant execute on function public.get_ghl_sync_targets(text) to service_role;

insert into private.integration_webhook_tokens (integration_name, token_sha256, active)
values ('ghl_metrics_sync', repeat('0', 64), false)
on conflict (integration_name) do nothing;
