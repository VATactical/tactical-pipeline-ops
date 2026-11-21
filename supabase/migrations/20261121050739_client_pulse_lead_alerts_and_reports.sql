-- Client pulse: GHL lead/appointment notices from Slack → no-leads alerts with follow-up tickets,
-- and weekly report drafts posted in each client channel for the account owner to send.

create table if not exists public.client_lead_notices (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id) on delete cascade,
  channel_id text not null,
  message_ts text not null,
  kind text not null check (kind in ('lead', 'appointment')),
  headline text not null default '',
  posted_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (channel_id, message_ts)
);
create index if not exists client_lead_notices_client_time on public.client_lead_notices (client_id, kind, posted_at desc);
alter table public.client_lead_notices enable row level security;
create policy "Staff read lead notices" on public.client_lead_notices for select to authenticated using (true);
revoke insert, update, delete on public.client_lead_notices from anon, authenticated;

create table if not exists public.client_pulse_scan_state (
  channel_id text primary key,
  last_ts text not null,
  last_error text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.client_pulse_scan_state enable row level security;
revoke all on public.client_pulse_scan_state from anon, authenticated;

alter table public.slack_outbox drop constraint if exists slack_outbox_kind_check;
alter table public.slack_outbox add constraint slack_outbox_kind_check check (kind in (
  'ticket_status', 'ticket_update', 'client_status', 'client_stage', 'client_comment',
  'dm_ticket_assigned', 'dm_task_assigned', 'dm_eod_reminder', 'dm_eod_hours', 'dm_notice',
  'onboarding_new', 'lead_alert', 'client_report_draft'));

-- Who follows up on lead problems: the active media buyer (media_buyer_view, not superadmin),
-- falling back to a superadmin.
create or replace function private.lead_alert_owner()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.profiles
  where active and coalesce((permissions->>'media_buyer_view')::boolean, false)
  order by (role = 'superadmin'), created_at
  limit 1
$$;

create or replace function private.next_ticket_number()
returns text language sql security definer set search_path = '' as $$
  select 'TKT-' || lpad((coalesce(max(nullif(regexp_replace(ticket_number, '\D', '', 'g'), '')::int), 0) + 1)::text, 3, '0')
  from public.tickets
$$;

-- Daily at 10 AM New York: every ADS LIVE / CRUISE CONTROL client with a Slack channel, live for 2+ days, and no GHL
-- lead notice in the last 48 hours gets an open "No leads" ticket (one per client) assigned to the
-- media buyer, with what TOPS knows about why. Open tickets get a daily follow-up; when leads come
-- back the ticket is resolved automatically.
create or replace function private.check_no_lead_clients(p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ny timestamp := now() at time zone 'America/New_York';
  owner uuid := private.lead_alert_owner();
  c record;
  leads_48h int;
  last_lead timestamptz;
  open_ticket uuid;
  open_number text;
  ticket_age int;
  diag text;
  signals text;
  metrics record;
  new_ticket uuid;
  number text;
  opened int := 0;
  followed int := 0;
  resolved int := 0;
  client_ops constant text := 'C0C0RE8LRM1';
begin
  if not p_force and extract(hour from ny) <> 10 then return jsonb_build_object('skipped', 'not 10 AM New York'); end if;

  for c in
    select * from public.clients
    where not archived and status in ('ADS LIVE', 'CRUISE CONTROL')
      and slack_channel_link ~ 'C[A-Z0-9]{8,}'
      and (ads_launched_on is null or ads_launched_on <= (ny::date - 2))
  loop
    select count(*) filter (where posted_at > now() - interval '48 hours'), max(posted_at)
      into leads_48h, last_lead
      from public.client_lead_notices where client_id = c.id and kind = 'lead';

    open_ticket := null; open_number := null; ticket_age := null;
    select t.id, t.ticket_number, (ny::date - (t.created_at at time zone 'America/New_York')::date)
      into open_ticket, open_number, ticket_age
      from public.tickets t join public.ticket_clients tc on tc.ticket_id = t.id
      where tc.client_id = c.id and t.source = 'tops' and t.title like 'No leads in 48h%'
        and t.status not in ('Resolved', 'Closed')
      order by t.created_at desc limit 1;

    if leads_48h > 0 then
      if open_ticket is not null then
        insert into public.ticket_updates (ticket_id, author_name, body, status_after)
        values (open_ticket, 'TP OPS', format('Leads are coming in again: %s in the last 48h. Closed automatically.', leads_48h), 'Resolved');
        update public.tickets set status = 'Resolved', updated_at = now() where id = open_ticket;
        insert into public.slack_outbox (kind, client_id, ticket_id, channel_id, body, dedupe_key)
        values ('lead_alert', c.id, open_ticket, client_ops,
          format(':white_check_mark: *%s %s* has leads again (%s in 48h). %s closed.', c.code, private.slack_escape(c.business_name), leads_48h, open_number),
          'no_leads_resolved:' || open_ticket)
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
        resolved := resolved + 1;
      end if;
      continue;
    end if;

    -- What TOPS knows about why.
    select string_agg(distinct s.signal, ', ') into signals
      from public.client_status_signals s
      where s.client_id = c.id and s.created_at > now() - interval '7 days' and s.signal <> 'LIVE';
    select m.leads, m.slack_leads, m.meta_spend, m.meta_spend_error, m.period_start, m.period_end
      into metrics
      from public.client_ghl_metrics m where m.client_id = c.id and m.sync_status = 'ok'
      order by m.synced_at desc limit 1;

    diag := concat_ws(E'\n',
      '• Last GHL lead alert in Slack: ' || coalesce(to_char(last_lead at time zone 'America/New_York', 'Mon DD, HH12:MI AM') || ' EST', 'none in the last 5 weeks'),
      case when c.ads_launched_on is not null then '• Ads launched on ' || to_char(c.ads_launched_on, 'Mon DD') end,
      case when coalesce(signals, '') <> '' then '• Slack signals this week: ' || signals end,
      case when coalesce(c.ads_pause_reason, '') <> '' then '• Pause reason on file: ' || c.ads_pause_reason end,
      case when metrics.leads is not null and coalesce(metrics.slack_leads, 0) < metrics.leads
        then format('• GHL counted %s leads this cycle but only %s reached Slack: check the GHL → Slack notification workflow.', metrics.leads, coalesce(metrics.slack_leads, 0)) end,
      case when metrics.meta_spend is not null then format('• Meta spend this cycle: $%s', metrics.meta_spend)
           when coalesce(metrics.meta_spend_error, '') <> '' then '• Meta spend unavailable: ' || left(metrics.meta_spend_error, 120) end);

    if open_ticket is null then
      number := private.next_ticket_number();
      insert into public.tickets (ticket_number, title, description, status, priority, assigned_to, source, next_follow_up, needs_confirmation)
      values (number, format('No leads in 48h · %s %s', c.code, c.business_name),
        'TOPS found no new GHL lead alerts in this client''s Slack channel in the last 48 hours while ads are live.'
        || E'\n\nWhat TOPS knows:\n' || diag
        || E'\n\nCheck, in this order:\n1. Ads Manager: is the campaign delivering and spending? Any rejected ads or account restrictions?\n2. Payment method on the ad account.\n3. Submit a test lead on the form / landing page and confirm it reaches GHL and Slack.\n4. GHL → Slack notification workflow is on.\n5. Budget, audience and creative fatigue.\n\nPost what you found as an update here. TOPS closes this ticket by itself when leads come back.',
        'Open', 'High', owner, 'tops', ny::date + 1, false)
      returning id into new_ticket;
      insert into public.ticket_clients (ticket_id, client_id, client_code_snapshot, business_name_snapshot)
      values (new_ticket, c.id, c.code, c.business_name) on conflict do nothing;
      insert into public.ticket_updates (ticket_id, author_name, body, status_after)
      values (new_ticket, 'TP OPS', 'Ticket created automatically: no GHL lead alerts in 48h.', 'Open');
      insert into public.slack_outbox (kind, client_id, ticket_id, channel_id, body, dedupe_key)
      values ('lead_alert', c.id, new_ticket, client_ops,
        format(':rotating_light: *No leads in 48h · %s %s* (%s)', c.code, private.slack_escape(c.business_name), c.status)
        || E'\n' || private.slack_escape(diag)
        || format(E'\nOwner: %s · Ticket %s · <%s/tickets?ticket=%s|Open in TOPS>',
             coalesce((select private.slack_escape(full_name) from public.profiles where id = owner), 'unassigned'), number, private.tp_ops_app_url(), new_ticket),
        'no_leads_open:' || new_ticket)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
      if owner is not null then
        perform private.enqueue_slack_dm('dm_ticket_assigned', owner,
          format(':rotating_light: TP OPS assigned you *%s*: no leads in 48h for *%s %s*. Please check why and post an update.', number, c.code, private.slack_escape(c.business_name))
          || format(E'\n<%s/tickets?ticket=%s|Open in TP OPS>', private.tp_ops_app_url(), new_ticket),
          new_ticket, c.id, 'no_leads_dm:' || new_ticket);
      end if;
      opened := opened + 1;
    else
      insert into public.ticket_updates (ticket_id, author_name, body, status_after)
      values (open_ticket, 'TP OPS', format('Still no leads (day %s of this ticket).', ticket_age + 1) || E'\n' || diag, null);
      update public.tickets set next_follow_up = ny::date + 1, priority = case when ticket_age >= 2 then 'Urgent' else priority end, updated_at = now()
        where id = open_ticket;
      if owner is not null then
        perform private.enqueue_slack_dm('dm_ticket_assigned', owner,
          format(':hourglass: *%s* is still open: %s %s has had no leads for %s+ days. Any update?', open_number, c.code, private.slack_escape(c.business_name), ticket_age + 2)
          || format(E'\n<%s/tickets?ticket=%s|Open in TP OPS>', private.tp_ops_app_url(), open_ticket),
          open_ticket, c.id, 'no_leads_dm:' || open_ticket || ':' || ny::date);
      end if;
      followed := followed + 1;
    end if;
  end loop;
  return jsonb_build_object('opened', opened, 'followed_up', followed, 'resolved', resolved);
end;
$$;
revoke all on function private.check_no_lead_clients(boolean) from public, anon, authenticated;

-- Mondays at 9 AM New York: a weekly report draft for each running client, posted in the client's
-- own channel (the client is not in it) for the account owner to review and send.
create or replace function private.draft_weekly_client_reports(p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ny timestamp := now() at time zone 'America/New_York';
  week_end date := date_trunc('week', ny)::date - 1;      -- last Sunday
  week_start date := week_end - 6;                         -- last Monday
  c record;
  leads int; appts int; prev_leads int; prev_appts int;
  first_name text;
  channel text;
  client_text text;
  drafted int := 0;
begin
  if not p_force and (extract(isodow from ny) <> 1 or extract(hour from ny) <> 9) then
    return jsonb_build_object('skipped', 'not Monday 9 AM New York');
  end if;
  for c in
    select * from public.clients
    where not archived and status in ('ADS LIVE', 'ADS PAUSED', 'CRUISE CONTROL') and slack_channel_link ~ 'C[A-Z0-9]{8,}'
  loop
    channel := substring(c.slack_channel_link from 'C[A-Z0-9]{8,}');
    select count(*) filter (where kind = 'lead' and (posted_at at time zone 'America/New_York')::date between week_start and week_end),
           count(*) filter (where kind = 'appointment' and (posted_at at time zone 'America/New_York')::date between week_start and week_end),
           count(*) filter (where kind = 'lead' and (posted_at at time zone 'America/New_York')::date between week_start - 7 and week_end - 7),
           count(*) filter (where kind = 'appointment' and (posted_at at time zone 'America/New_York')::date between week_start - 7 and week_end - 7)
      into leads, appts, prev_leads, prev_appts
      from public.client_lead_notices where client_id = c.id;
    first_name := coalesce(nullif(split_part(trim(coalesce(c.owner_name, '')), ' ', 1), ''), 'there');

    client_text := format('Hi %s! Here''s your weekly update for %s – %s:', first_name, to_char(week_start, 'Mon DD'), to_char(week_end, 'Mon DD'))
      || E'\n' || format('• New leads: %s (previous week: %s)', leads, prev_leads)
      || E'\n' || format('• Appointments booked: %s (previous week: %s)', appts, prev_appts)
      || E'\n' || case
           when c.status = 'ADS PAUSED' then 'Your ads are currently paused. [Add the reason and the plan to restart.]'
           when leads = 0 then 'We had a slow week on leads and are already adjusting the campaign. [Add what changed.]'
           when leads > prev_leads then 'Lead flow is up compared with last week. [Add a highlight.]'
           else '[Add a highlight from the week.]' end
      || E'\n' || 'Next week: [add next steps]'
      || E'\n' || 'Any questions, just reply here!';

    insert into public.slack_outbox (kind, client_id, channel_id, body, dedupe_key)
    values ('client_report_draft', c.id, channel,
      format(':memo: *Weekly report draft · %s %s* (%s – %s)', c.code, private.slack_escape(c.business_name), to_char(week_start, 'Mon DD'), to_char(week_end, 'Mon DD'))
      || E'\nFor the account owner: complete the [brackets], then send it to the client. The client is not in this channel.'
      || E'\n```' || replace(client_text, '```', '') || '```'
      || E'\n_Counts come from the GHL lead and appointment alerts in this channel._',
      'report_draft:' || c.id || ':' || week_start)
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
    if found then drafted := drafted + 1; end if;
  end loop;
  return jsonb_build_object('drafted', drafted, 'week_start', week_start, 'week_end', week_end);
end;
$$;
revoke all on function private.draft_weekly_client_reports(boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'client-pulse-scan') then perform cron.unschedule('client-pulse-scan'); end if;
  if exists (select 1 from cron.job where jobname = 'client-no-leads-check') then perform cron.unschedule('client-no-leads-check'); end if;
  if exists (select 1 from cron.job where jobname = 'client-weekly-report-drafts') then perform cron.unschedule('client-weekly-report-drafts'); end if;
  perform cron.schedule('client-pulse-scan', '13,43 * * * *',
    $job$select private.run_tp_ops_function('client-pulse', '{"task":"scan"}'::jsonb);$job$);
  -- Runs a few minutes after the :43 scan; the functions act only at 10 AM / Monday 9 AM New York.
  perform cron.schedule('client-no-leads-check', '53 * * * *', $job$select private.check_no_lead_clients();$job$);
  perform cron.schedule('client-weekly-report-drafts', '53 * * * 1', $job$select private.draft_weekly_client_reports();$job$);
end $$;
