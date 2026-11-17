-- Cost metrics per period: appointment status breakdown from GHL, ad spend from Meta
-- (automatic) or entered by hand, so the panel can show cost per lead and cost per appointment.

alter table public.client_ghl_metrics
  add column if not exists appointments_confirmed integer not null default 0,
  add column if not exists appointments_showed integer not null default 0,
  add column if not exists appointments_noshow integer not null default 0,
  add column if not exists meta_spend numeric(12,2),
  add column if not exists meta_spend_synced_at timestamptz,
  add column if not exists meta_spend_error text not null default '',
  add column if not exists manual_spend numeric(12,2),
  add column if not exists manual_spend_by uuid references public.profiles(id) on delete set null,
  add column if not exists manual_spend_at timestamptz;

alter table public.client_ghl_metrics drop constraint if exists client_ghl_metrics_spend_check;
alter table public.client_ghl_metrics add constraint client_ghl_metrics_spend_check
  check ((meta_spend is null or meta_spend >= 0) and (manual_spend is null or manual_spend >= 0));
create index if not exists client_ghl_metrics_manual_spend_by_idx on public.client_ghl_metrics (manual_spend_by);

-- A period can exist with manual spend before its first GHL sync.
alter table public.client_ghl_metrics drop constraint if exists client_ghl_metrics_sync_status_check;
alter table public.client_ghl_metrics add constraint client_ghl_metrics_sync_status_check
  check (sync_status in ('ok', 'error', 'pending'));

comment on column public.client_ghl_metrics.manual_spend is
  'Ad spend entered by hand for the period. When set it takes priority over meta_spend.';

-- Sync targets now also carry the Meta ad account and the per-client Meta token (fallback when
-- no portfolio-wide token is configured as the META_ACCESS_TOKEN Edge Function secret).
drop function if exists public.get_ghl_sync_targets(text);
create function public.get_ghl_sync_targets(p_client_id text default null)
returns table (
  client_id text,
  location_id text,
  token text,
  qualified_tag text,
  billing_cycle_anchor date,
  billing_cycle_days integer,
  meta_ad_account_id text,
  meta_token text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select c.id, c.ghl_location_id, s.ghl_private_token, c.ghl_qualified_tag,
         c.billing_cycle_anchor, c.billing_cycle_days,
         coalesce(c.meta_ad_account_id, ''), coalesce(s.meta_access_token, '')
  from public.clients c
  join private.client_secrets s on s.client_id = c.id
  where coalesce(c.archived, false) = false
    and coalesce(c.ghl_location_id, '') <> ''
    and s.ghl_private_token <> ''
    and (p_client_id is null or c.id = p_client_id);
end;
$$;
revoke all on function public.get_ghl_sync_targets(text) from public, anon, authenticated;
grant execute on function public.get_ghl_sync_targets(text) to service_role;

-- Manual spend for one period. Client editors only; a null amount clears it.
create or replace function public.set_client_period_spend(
  p_client_id text, p_period_start date, p_period_end date, p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.has_permission('clients_edit')) then
    raise exception 'Client edit permission is required';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Invalid period';
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 10000000) then
    raise exception 'Invalid spend amount';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Client not found';
  end if;

  insert into public.client_ghl_metrics
    (client_id, period_start, period_end, manual_spend, manual_spend_by, manual_spend_at, sync_status)
  values (p_client_id, p_period_start, p_period_end, round(p_amount, 2), (select auth.uid()), now(), 'pending')
  on conflict (client_id, period_start) do update
  set manual_spend = round(p_amount, 2),
      manual_spend_by = (select auth.uid()),
      manual_spend_at = now();
end;
$$;
revoke all on function public.set_client_period_spend(text, date, date, numeric) from public, anon;
grant execute on function public.set_client_period_spend(text, date, date, numeric) to authenticated;
