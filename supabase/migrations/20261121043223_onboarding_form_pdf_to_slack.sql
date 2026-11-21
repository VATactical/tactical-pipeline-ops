-- Onboarding form PDF → client's Slack channel, once the channel is linked.
create table if not exists public.client_form_pdf_posts (
  client_id text primary key references public.clients(id) on delete cascade,
  channel_id text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'waiting_scope', 'failed')),
  error text not null default '',
  slack_file_id text,
  bytes integer,
  attempts integer not null default 0,
  posted_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.client_form_pdf_posts enable row level security;
create policy "Staff read form PDF posts" on public.client_form_pdf_posts for select to authenticated using (true);
revoke insert, update, delete on public.client_form_pdf_posts from anon, authenticated;

-- When a client gets a Slack channel (new or changed) and has a completed intake form, post the PDF.
create or replace function private.post_onboarding_form_pdf()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  new_channel text := substring(coalesce(new.slack_channel_link, '') from 'C[A-Z0-9]{8,}');
  old_channel text := substring(coalesce(old.slack_channel_link, '') from 'C[A-Z0-9]{8,}');
begin
  if new_channel is not null and new_channel is distinct from old_channel and coalesce(new.intake_form_completed, false) then
    perform private.run_tp_ops_function('onboarding-form-pdf', jsonb_build_object('client_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists clients_post_onboarding_form_pdf on public.clients;
create trigger clients_post_onboarding_form_pdf after update of slack_channel_link on public.clients
  for each row execute function private.post_onboarding_form_pdf();

-- Retry the ones waiting for the files:write scope, every hour.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'onboarding-form-pdf-retry') then
    perform cron.unschedule('onboarding-form-pdf-retry');
  end if;
  perform cron.schedule('onboarding-form-pdf-retry', '41 * * * *',
    $job$select private.run_tp_ops_function('onboarding-form-pdf', '{"task":"retry"}'::jsonb) where exists (select 1 from public.client_form_pdf_posts where status = 'waiting_scope');$job$);
end $$;
