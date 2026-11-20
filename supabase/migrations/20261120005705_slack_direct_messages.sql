-- Direct messages from the TP OPS Slack app (scopes chat:write + im:write):
--   * a ticket assigned to someone          -> DM to that person
--   * a task assigned to someone            -> DM to that person
--   * EOD still missing at 7:00 PM EST      -> DM reminder (Mon–Fri, one per person per day;
--                                             skipped when the person marked "working late")
-- The Slack user comes from profiles.slack_contact (profile link with the Slack ID).
-- Assigning something to yourself, and changes made by the integrations, never send a DM.
-- Messages follow the person's preferred language (es/en).

alter table public.slack_outbox drop constraint if exists slack_outbox_kind_check;
alter table public.slack_outbox add constraint slack_outbox_kind_check check (kind in (
  'ticket_status', 'ticket_update', 'client_status', 'client_stage', 'client_comment',
  'dm_ticket_assigned', 'dm_task_assigned', 'dm_eod_reminder'));

alter table public.slack_outbox drop constraint if exists slack_outbox_channel_id_check;
alter table public.slack_outbox add constraint slack_outbox_channel_id_check
  check (channel_id ~ '^[CGUW][A-Z0-9]{8,}$');

alter table public.slack_outbox
  add column if not exists recipient_id uuid references public.profiles(id) on delete set null,
  add column if not exists dedupe_key text;
create unique index if not exists slack_outbox_dedupe_idx on public.slack_outbox (dedupe_key) where dedupe_key is not null;

-- Slack user ID of an active TP OPS user (null when not linked).
create or replace function private.slack_user_of(p_profile_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select nullif(substring(coalesce(p.slack_contact, '') from '([UW][A-Z0-9]{8,})'), '')
  from public.profiles p
  where p.id = p_profile_id and coalesce(p.active, true) and p.deleted_at is null
$$;
revoke all on function private.slack_user_of(uuid) from public, anon, authenticated;

create or replace function private.profile_is_spanish(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select preferred_language from public.profiles where id = p_profile_id), 'en') = 'es'
$$;
revoke all on function private.profile_is_spanish(uuid) from public, anon, authenticated;

create or replace function private.enqueue_slack_dm(
  p_kind text, p_recipient uuid, p_body text,
  p_ticket_id uuid default null, p_client_id text default null, p_dedupe text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  slack_user text := private.slack_user_of(p_recipient);
begin
  if slack_user is null then return false; end if;
  insert into public.slack_outbox (kind, recipient_id, channel_id, body, ticket_id, client_id, dedupe_key, created_by)
  values (p_kind, p_recipient, slack_user, left(p_body, 3900), p_ticket_id, p_client_id, p_dedupe, auth.uid())
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return found;
end;
$$;
revoke all on function private.enqueue_slack_dm(text, uuid, text, uuid, text, text) from public, anon, authenticated;

-- Tickets -------------------------------------------------------------------------------------
create or replace function private.slack_dm_on_ticket_assigned()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  es boolean;
  clients text;
begin
  if auth.uid() is null or new.assigned_to is null or new.assigned_to = auth.uid() then return new; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  es := private.profile_is_spanish(new.assigned_to);
  select string_agg(c.code, ', ' order by c.code) into clients
  from public.ticket_clients tc join public.clients c on c.id = tc.client_id where tc.ticket_id = new.id;
  perform private.enqueue_slack_dm('dm_ticket_assigned', new.assigned_to,
    format(case when es then ':ticket: %s te asignó el ticket *%s* (%s)' else ':ticket: %s assigned you ticket *%s* (%s)' end,
      private.slack_escape(private.slack_actor_name()), new.ticket_number, new.priority)
    || case when clients is not null then E'\n' || (case when es then 'Clientes: ' else 'Clients: ' end) || clients else '' end
    || E'\n' || private.slack_quote(new.title)
    || E'\n<' || private.tp_ops_app_url() || '/tickets?ticket=' || new.id || '|' || case when es then 'Abrir en TP OPS' else 'Open in TP OPS' end || '>',
    new.id);
  return new;
end;
$$;
drop trigger if exists slack_dm_on_ticket_assigned on public.tickets;
create trigger slack_dm_on_ticket_assigned after insert or update of assigned_to on public.tickets
  for each row execute function private.slack_dm_on_ticket_assigned();

-- Tasks ---------------------------------------------------------------------------------------
create or replace function private.slack_dm_on_task_assigned()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  es boolean;
  client_label text;
begin
  if auth.uid() is null or new.assigned_to is null or new.assigned_to = auth.uid() then return new; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  es := private.profile_is_spanish(new.assigned_to);
  select c.code || ' · ' || c.business_name into client_label from public.clients c where c.id = new.client_id;
  perform private.enqueue_slack_dm('dm_task_assigned', new.assigned_to,
    format(case when es then ':white_check_mark: %s te asignó una tarea' else ':white_check_mark: %s assigned you a task' end,
      private.slack_escape(private.slack_actor_name()))
    || case when client_label is not null then ' · ' || private.slack_escape(client_label) else '' end
    || case when new.due_at is not null then E'\n' || (case when es then 'Fecha: ' else 'Due: ' end) || to_char(new.due_at, 'YYYY-MM-DD') else '' end
    || E'\n' || private.slack_quote(new.title)
    || E'\n<' || private.tp_ops_app_url() || coalesce('/clientes/' || new.client_id, '/tickets') || '|'
    || case when es then 'Abrir en TP OPS' else 'Open in TP OPS' end || '>',
    null, new.client_id);
  return new;
end;
$$;
drop trigger if exists slack_dm_on_task_assigned on public.tasks;
create trigger slack_dm_on_task_assigned after insert or update of assigned_to on public.tasks
  for each row execute function private.slack_dm_on_task_assigned();

-- EOD reminder --------------------------------------------------------------------------------
-- Runs every hour; only acts at 19:xx New York time on weekdays (follows daylight saving).
create or replace function private.send_eod_slack_reminders(p_force boolean default false)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  ny timestamp := now() at time zone 'America/New_York';
  v_work_date date := (now() at time zone 'America/New_York')::date;
  day_start timestamptz := ((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York';
  member record;
  sent integer := 0;
  es boolean;
begin
  if not p_force and (extract(hour from ny) <> 19 or extract(isodow from ny) > 5) then return 0; end if;
  for member in
    select p.id from public.profiles p
    where coalesce(p.active, true) and p.deleted_at is null and p.role <> 'superadmin'
      and coalesce((p.permissions ->> 'eod_reports')::boolean, false)
      and not exists (select 1 from public.eod_reports r where r.user_id = p.id
                      and r.submitted_at >= day_start and r.submitted_at < day_start + interval '1 day')
      and not exists (select 1 from public.eod_daily_status s where s.user_id = p.id
                      and s.work_date = v_work_date and s.status in ('working_late', 'submitted'))
  loop
    es := private.profile_is_spanish(member.id);
    if private.enqueue_slack_dm('dm_eod_reminder', member.id,
      case when es
        then ':memo: Recordatorio: aún no has enviado tu EOD de hoy (' || to_char(v_work_date, 'YYYY-MM-DD') || ', hora EST). La hora límite es 8:00 PM EST.'
             || E'\nEscríbelo en TP OPS o, si ya lo publicaste en #eod-reports, usa *Send to TP OPS* en tu mensaje. Si sigues trabajando, márcalo en TP OPS.'
        else ':memo: Reminder: you have not sent today''s EOD yet (' || to_char(v_work_date, 'YYYY-MM-DD') || ', EST). The cutoff is 8:00 PM EST.'
             || E'\nWrite it in TP OPS or, if you already posted it in #eod-reports, use *Send to TP OPS* on your message. Still working? Mark it in TP OPS.'
      end
      || E'\n<' || private.tp_ops_app_url() || '/eod-reports|' || case when es then 'Abrir EOD en TP OPS' else 'Open EOD in TP OPS' end || '>',
      null, null, 'eod:' || member.id || ':' || v_work_date) then
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end;
$$;
revoke all on function private.send_eod_slack_reminders(boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'slack-eod-reminder') then
    perform cron.unschedule('slack-eod-reminder');
  end if;
  perform cron.schedule('slack-eod-reminder', '1 * * * *', 'select private.send_eod_slack_reminders();');
end;
$$;
