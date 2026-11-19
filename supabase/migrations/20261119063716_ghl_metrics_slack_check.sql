-- Cross-check of GHL counts against the LeadConnector notices posted in each client's Slack channel.
-- Filled by ghl-metrics-sync when the SLACK_BOT_TOKEN Edge Function secret is configured.
alter table public.client_ghl_metrics
  add column if not exists slack_leads integer,
  add column if not exists slack_appointments integer,
  add column if not exists slack_first_notice_at timestamptz,
  add column if not exists slack_error text not null default '';

comment on column public.client_ghl_metrics.slack_leads is
  'New-lead notices posted by LeadConnector in the client Slack channel during the period (test contacts excluded). Null when not checked.';
comment on column public.client_ghl_metrics.slack_appointments is
  'Appointment-booked notices posted by LeadConnector in the client Slack channel during the period.';
comment on column public.client_ghl_metrics.slack_first_notice_at is
  'First LeadConnector notice found in the period; notices before it may not have been configured yet.';

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
  meta_token text,
  slack_channel_id text
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
         coalesce(c.meta_ad_account_id, ''), coalesce(s.meta_access_token, ''),
         coalesce(substring(coalesce(c.slack_channel_link, '') from '(C[A-Z0-9]{8,})'), '')
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
