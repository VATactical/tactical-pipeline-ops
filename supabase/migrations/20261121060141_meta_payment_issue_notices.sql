-- Meta payment problems → the client's own Slack channel, business hours only (Mon–Fri 8 AM–5 PM New York).
-- One notice per business day while the problem lasts, and one when it is fixed.
create table if not exists public.client_meta_payment_alerts (
  client_id text primary key references public.clients(id) on delete cascade,
  status_label text not null,
  first_seen_at timestamptz not null default now(),
  last_notified_on date,
  resolved_at timestamptz
);
alter table public.client_meta_payment_alerts enable row level security;
create policy "Staff read Meta payment alerts" on public.client_meta_payment_alerts for select to authenticated using (true);
revoke insert, update, delete on public.client_meta_payment_alerts from anon, authenticated;

alter table public.slack_outbox drop constraint if exists slack_outbox_kind_check;
alter table public.slack_outbox add constraint slack_outbox_kind_check check (kind in (
  'ticket_status', 'ticket_update', 'client_status', 'client_stage', 'client_comment',
  'dm_ticket_assigned', 'dm_task_assigned', 'dm_eod_reminder', 'dm_eod_hours', 'dm_notice',
  'onboarding_new', 'lead_alert', 'client_report_draft', 'meta_check', 'meta_payment'));

create or replace function private.notify_meta_payment_issues(p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ny timestamp := now() at time zone 'America/New_York';
  r record;
  billing text;
  sent int := 0;
  fixed int := 0;
begin
  if not p_force and (extract(isodow from ny) > 5 or extract(hour from ny) < 8 or extract(hour from ny) >= 17) then
    return jsonb_build_object('skipped', 'outside business hours (Mon–Fri 8 AM–5 PM New York)');
  end if;

  for r in
    select c.id, c.code, c.business_name, c.slack_channel_link, s.account_status, s.account_status_label,
           s.account_name, s.ad_account_id, a.client_id as alert_client, a.last_notified_on, a.resolved_at
    from public.clients c
    join public.client_meta_status s on s.client_id = c.id and s.error = '' and s.checked_at > now() - interval '6 hours'
    left join public.client_meta_payment_alerts a on a.client_id = c.id
    where not c.archived and c.slack_channel_link ~ 'C[A-Z0-9]{8,}'
  loop
    billing := 'https://business.facebook.com/billing_hub/accounts/details/?asset_id=' || r.ad_account_id;
    if r.account_status in (3, 8, 9) then
      if r.alert_client is null or r.resolved_at is not null then
        insert into public.client_meta_payment_alerts (client_id, status_label, first_seen_at, last_notified_on, resolved_at)
        values (r.id, r.account_status_label, now(), null, null)
        on conflict (client_id) do update set status_label = excluded.status_label, first_seen_at = now(), last_notified_on = null, resolved_at = null;
        r.last_notified_on := null;
      end if;
      if r.last_notified_on is distinct from ny::date then
        insert into public.slack_outbox (kind, client_id, channel_id, body, dedupe_key)
        values ('meta_payment', r.id, substring(r.slack_channel_link from 'C[A-Z0-9]{8,}'),
          format(':credit_card: *Meta payment issue · %s %s*', r.code, private.slack_escape(r.business_name))
          || format(E'\nThe ad account *%s* is *%s*', private.slack_escape(coalesce(nullif(r.account_name, ''), r.ad_account_id)), r.account_status_label)
          || case when r.account_status = 9 then ': a payment failed and ads will stop soon if it is not paid.' else ', so ads cannot run until it is paid.' end
          || E'\nNext step: ask the client to pay the balance or update the card in Meta billing.'
          || format(E'\n<%s|Open Meta billing> · <%s/clientes/%s|Open in TOPS>', billing, private.tp_ops_app_url(), r.id)
          || E'\n_TOPS keeps checking Meta and will post here again next business day if it is still pending._',
          'meta_payment:' || r.id || ':' || ny::date)
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
        update public.client_meta_payment_alerts set last_notified_on = ny::date, status_label = r.account_status_label where client_id = r.id;
        sent := sent + 1;
      end if;
    elsif r.alert_client is not null and r.resolved_at is null and r.account_status in (1, 201) then
      update public.client_meta_payment_alerts set resolved_at = now() where client_id = r.id;
      if r.last_notified_on is not null then
        insert into public.slack_outbox (kind, client_id, channel_id, body, dedupe_key)
        values ('meta_payment', r.id, substring(r.slack_channel_link from 'C[A-Z0-9]{8,}'),
          format(':white_check_mark: *Meta payment resolved · %s %s*: the ad account is active again.', r.code, private.slack_escape(r.business_name))
          || E'\nIf ads should be running, confirm the campaign is on and update the status in TOPS.',
          'meta_payment_ok:' || r.id || ':' || ny::date)
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
        fixed := fixed + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('notified', sent, 'resolved', fixed);
end;
$$;
revoke all on function private.notify_meta_payment_issues(boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'client-meta-payment') then perform cron.unschedule('client-meta-payment'); end if;
  -- Hourly a few minutes after the Meta pull; the function only acts Mon–Fri 8 AM–5 PM New York.
  perform cron.schedule('client-meta-payment', '35 * * * *', $job$select private.notify_meta_payment_issues();$job$);
  -- Pull Meta every hour during business hours so payment notices go out early.
  if exists (select 1 from cron.job where jobname = 'client-meta-check') then perform cron.unschedule('client-meta-check'); end if;
  perform cron.schedule('client-meta-check', '27 * * * *',
    $job$select private.run_tp_ops_function('client-pulse', '{"task":"meta"}'::jsonb) where extract(hour from now())::int % 2 = 0 or extract(hour from now() at time zone 'America/New_York') between 8 and 16;$job$);
end $$;
