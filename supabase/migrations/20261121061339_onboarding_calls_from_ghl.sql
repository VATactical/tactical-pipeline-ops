-- Onboarding calls booked in the GHL onboarding calendar.
create table if not exists public.client_onboarding_calls (
  appointment_id text primary key,
  client_id text references public.clients(id) on delete set null,
  ghl_contact_id text not null default '',
  ghl_location_id text not null default '',
  contact_name text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  company_name text not null default '',
  calendar_name text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  time_zone text not null default 'America/New_York',
  status text not null default 'booked',
  meeting_link text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_onboarding_calls_client on public.client_onboarding_calls (client_id, starts_at desc);
alter table public.client_onboarding_calls enable row level security;
create policy "Staff read onboarding calls" on public.client_onboarding_calls for select to authenticated using (true);
revoke insert, update, delete on public.client_onboarding_calls from anon, authenticated;

alter table public.clients add column if not exists onboarding_call_at timestamptz;
comment on column public.clients.onboarding_call_at is 'Next onboarding call booked in the GHL onboarding calendar (UTC).';

alter table public.slack_outbox drop constraint if exists slack_outbox_kind_check;
alter table public.slack_outbox add constraint slack_outbox_kind_check check (kind in (
  'ticket_status', 'ticket_update', 'client_status', 'client_stage', 'client_comment',
  'dm_ticket_assigned', 'dm_task_assigned', 'dm_eod_reminder', 'dm_eod_hours', 'dm_notice',
  'onboarding_new', 'lead_alert', 'client_report_draft', 'meta_check', 'meta_payment', 'onboarding_call'));
