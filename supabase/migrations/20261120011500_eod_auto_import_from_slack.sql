-- EODs posted in #eod-reports are imported automatically (slack-bridge task "eod", every 10 minutes,
-- re-reading the last 48 hours so edits in Slack update TP OPS too).
--   * Unchanged messages are skipped, so reviewers do not see the report as new again.
--   * When there are two EOD messages for the same day, the newest one wins.
--   * An EOD written in TP OPS is never replaced by Slack.
--   * Slack EODs carry no hours: when the day has no time entries yet, the author gets one DM with a
--     link to add them in TP OPS.

alter table public.slack_outbox drop constraint if exists slack_outbox_kind_check;
alter table public.slack_outbox add constraint slack_outbox_kind_check check (kind in (
  'ticket_status', 'ticket_update', 'client_status', 'client_stage', 'client_comment',
  'dm_ticket_assigned', 'dm_task_assigned', 'dm_eod_reminder', 'dm_eod_hours'));

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
  saved public.eod_reports;
  clean text := left(btrim(coalesce(p_notes, '')), 5000);
  es boolean;
begin
  if clean = '' then raise exception 'El mensaje está vacío.'; end if;
  select coalesce(nullif(timezone, ''), 'America/Managua') into zone
  from public.profiles where id = p_user_id and active and deleted_at is null;
  if not found then raise exception 'El usuario no está activo en TP OPS.'; end if;

  select * into existing from public.eod_reports where user_id = p_user_id and report_date = p_report_date for update;
  if found then
    if existing.source = 'tops' and btrim(existing.notes) <> '' then return 'exists_in_tops'; end if;
    if existing.source = 'slack' and existing.slack_ts = p_slack_ts and existing.notes = clean then return 'unchanged'; end if;
    if existing.source = 'slack' and existing.slack_ts is distinct from p_slack_ts
       and coalesce(existing.slack_ts, '0')::numeric > coalesce(nullif(p_slack_ts, ''), '0')::numeric then
      return 'newer_exists';
    end if;
  end if;

  insert into public.eod_reports (user_id, report_date, notes, period_start, period_end, submitted_at, source,
    slack_channel_id, slack_ts, slack_permalink)
  values (p_user_id, p_report_date, clean,
    p_report_date::timestamp at time zone zone,
    ((p_report_date + 1)::timestamp at time zone zone) - interval '1 millisecond',
    coalesce(p_submitted_at, now()), 'slack', p_slack_channel_id, p_slack_ts, coalesce(p_slack_permalink, ''))
  on conflict (user_id, report_date) do update
    set notes = excluded.notes, source = 'slack', slack_channel_id = excluded.slack_channel_id, slack_ts = excluded.slack_ts,
        slack_permalink = excluded.slack_permalink, submitted_at = excluded.submitted_at, updated_at = now()
  returning * into saved;

  if not exists (select 1 from public.time_entries where user_id = p_user_id and work_date = p_report_date) then
    es := private.profile_is_spanish(p_user_id);
    perform private.enqueue_slack_dm('dm_eod_hours', p_user_id,
      case when es
        then ':white_check_mark: Tu EOD del ' || to_char(p_report_date, 'YYYY-MM-DD') || ' se guardó en TP OPS desde Slack.'
             || E'\nSolo falta agregar tus horas del día.'
        else ':white_check_mark: Your EOD for ' || to_char(p_report_date, 'YYYY-MM-DD') || ' was saved in TP OPS from Slack.'
             || E'\nOnly your hours for the day are missing.'
      end
      || E'\n<' || private.tp_ops_app_url() || '/eod-reports?report=' || saved.id || '|'
      || case when es then 'Agregar horas en TP OPS' else 'Add hours in TP OPS' end || '>',
      null, null, 'eodhours:' || p_user_id || ':' || p_report_date);
  end if;

  return case when existing.id is null then 'created' else 'updated' end;
end;
$$;
revoke all on function public.import_slack_eod(uuid, date, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.import_slack_eod(uuid, date, text, text, text, text, timestamptz) to service_role;

-- Every 10 minutes (the 7 PM EST reminder runs at :03, right after the :00 import).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'slack-eod-import') then perform cron.unschedule('slack-eod-import'); end if;
  perform cron.schedule('slack-eod-import', '*/10 * * * *', $job$select private.run_tp_ops_function('slack-bridge', '{"task":"eod"}'::jsonb);$job$);
  if exists (select 1 from cron.job where jobname = 'slack-eod-reminder') then perform cron.unschedule('slack-eod-reminder'); end if;
  perform cron.schedule('slack-eod-reminder', '3 * * * *', 'select private.send_eod_slack_reminders();');
end;
$$;
