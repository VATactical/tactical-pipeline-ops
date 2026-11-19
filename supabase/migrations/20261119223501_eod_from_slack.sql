-- EOD reports from Slack: the "Send to TP OPS" message shortcut in Slack (slack-interactions Edge
-- Function) saves an EOD posted in Slack as that person's EOD report in TP OPS.

alter table public.eod_reports
  add column if not exists source text not null default 'tops' check (source in ('tops', 'slack')),
  add column if not exists slack_channel_id text,
  add column if not exists slack_ts text,
  add column if not exists slack_permalink text not null default '';
create unique index if not exists eod_reports_slack_message_idx on public.eod_reports (slack_channel_id, slack_ts) where slack_ts is not null;

-- Called only by slack-interactions (service role). Returns created | updated | exists_in_tops.
-- An EOD written in TP OPS for the same day is never overwritten.
create or replace function public.import_slack_eod(
  p_user_id uuid,
  p_report_date date,
  p_notes text,
  p_slack_channel_id text,
  p_slack_ts text,
  p_slack_permalink text,
  p_submitted_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  zone text;
  existing public.eod_reports;
  clean text := left(btrim(coalesce(p_notes, '')), 5000);
begin
  if clean = '' then raise exception 'El mensaje está vacío.'; end if;
  select coalesce(nullif(timezone, ''), 'America/Managua') into zone
  from public.profiles where id = p_user_id and active and deleted_at is null;
  if not found then raise exception 'El usuario no está activo en TP OPS.'; end if;

  select * into existing from public.eod_reports where user_id = p_user_id and report_date = p_report_date for update;
  if found and existing.source = 'tops' and btrim(existing.notes) <> '' then
    return 'exists_in_tops';
  end if;

  insert into public.eod_reports (user_id, report_date, notes, period_start, period_end, submitted_at, source,
    slack_channel_id, slack_ts, slack_permalink)
  values (p_user_id, p_report_date, clean,
    p_report_date::timestamp at time zone zone,
    ((p_report_date + 1)::timestamp at time zone zone) - interval '1 millisecond',
    coalesce(p_submitted_at, now()), 'slack', p_slack_channel_id, p_slack_ts, coalesce(p_slack_permalink, ''))
  on conflict (user_id, report_date) do update
    set notes = excluded.notes, source = 'slack', slack_channel_id = excluded.slack_channel_id, slack_ts = excluded.slack_ts,
        slack_permalink = excluded.slack_permalink, submitted_at = excluded.submitted_at, updated_at = now();
  return case when existing.id is null then 'created' else 'updated' end;
end;
$$;
revoke all on function public.import_slack_eod(uuid, date, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.import_slack_eod(uuid, date, text, text, text, text, timestamptz) to service_role;
