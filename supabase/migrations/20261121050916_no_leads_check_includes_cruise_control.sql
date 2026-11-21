-- No-leads check also covers CRUISE CONTROL clients.
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
