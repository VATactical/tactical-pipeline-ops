-- TOPS <-> Slack, both ways.
--
-- TOPS -> Slack: important changes made by a person in TOPS are queued in public.slack_outbox and
-- posted by the slack-bridge Edge Function (needs the chat:write scope on the TOPS Slack app):
--   * ticket status changes and manual ticket follow-ups -> the thread of the ticket's original Slack
--     message, otherwise the channel of each linked client (agency tickets: #blocked-accounts...).
--   * client status changes and lifecycle board moves -> the client's Slack channel.
--   * bitácora comments marked "Bloqueado" or "Enviar a Slack" -> the client's Slack channel.
--   Changes made by the integrations themselves (no signed-in user) are never posted, so nothing loops.
--
-- Slack -> TOPS: slack-bridge reads new human messages in each client channel and proposes dossier
-- updates (pixel ID, ad account, landing page, budget, radius, address, links...). Nothing changes
-- until someone with clients_edit applies the suggestion in TOPS.
--
-- The Slack ticket sync (Viktor's sweeps) now runs every 15 minutes instead of hourly.

-- 1. Outbox ------------------------------------------------------------------------------------
create table if not exists public.slack_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ticket_status', 'ticket_update', 'client_status', 'client_stage', 'client_comment')),
  client_id text references public.clients(id) on delete set null,
  ticket_id uuid references public.tickets(id) on delete set null,
  comment_id uuid references public.client_comments(id) on delete set null,
  channel_id text not null check (channel_id ~ '^[CG][A-Z0-9]{8,}$'),
  thread_ts text,
  body text not null check (char_length(body) between 1 and 3900),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'expired')),
  attempts integer not null default 0,
  error text not null default '',
  slack_ts text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);
create index if not exists slack_outbox_pending_idx on public.slack_outbox (created_at) where status in ('queued', 'sending', 'failed');
create index if not exists slack_outbox_client_idx on public.slack_outbox (client_id, created_at desc);
create index if not exists slack_outbox_ticket_idx on public.slack_outbox (ticket_id);
create index if not exists slack_outbox_comment_idx on public.slack_outbox (comment_id);

alter table public.slack_outbox enable row level security;
revoke all on public.slack_outbox from anon, authenticated;
grant select on public.slack_outbox to authenticated;
drop policy if exists "Team reads Slack outbox" on public.slack_outbox;
create policy "Team reads Slack outbox" on public.slack_outbox
  for select to authenticated using ((select private.current_app_role()) is not null);

-- Comments: opt-in flag to post to Slack and the time it was posted.
alter table public.client_comments
  add column if not exists send_to_slack boolean not null default false,
  add column if not exists slack_sent_at timestamptz;

-- 2. Helpers -----------------------------------------------------------------------------------
create or replace function private.slack_channel_of(p_link text)
returns text language sql immutable set search_path = '' as $$
  select nullif(substring(coalesce(p_link, '') from '(C[A-Z0-9]{8,})'), '')
$$;

-- Slack mrkdwn needs &, < and > escaped.
create or replace function private.slack_escape(p_text text)
returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(coalesce(p_text, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

-- Quote every line ("> ...") and keep the message under Slack's practical size.
create or replace function private.slack_quote(p_text text)
returns text language sql immutable set search_path = '' as $$
  select '>' || replace(left(private.slack_escape(btrim(coalesce(p_text, ''))), 2500), E'\n', E'\n>')
$$;

create or replace function private.slack_actor_name()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(btrim(regexp_replace(full_name, '\s+', ' ', 'g')), '') from public.profiles where id = auth.uid()), 'Someone')
$$;

create or replace function private.tp_ops_app_url()
returns text language sql immutable set search_path = '' as $$ select 'https://app.tacticalpipeline.com' $$;

-- Calls a TOPS Edge Function with the scheduler key (same key as the Slack ticket sync).
create or replace function private.run_tp_ops_function(p_name text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id bigint;
begin
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tp_ops_functions_url') || '/' || p_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-tp-ops-key', (select decrypted_secret from vault.decrypted_secrets where name = 'slack_ticket_sync_key')
    ),
    body := p_body,
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function private.run_tp_ops_function(text, jsonb) from public, anon, authenticated;

-- Ticket messages: reply in the thread of the ticket's Slack message when there is one,
-- otherwise post in each linked client's channel, otherwise in the tickets channel.
create or replace function private.enqueue_ticket_slack(p_ticket public.tickets, p_kind text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  channel text;
  thread text;
  sent integer := 0;
  target record;
  body text := p_body || E'\n<' || private.tp_ops_app_url() || '/tickets?ticket=' || p_ticket.id || '|Open in TOPS>';
begin
  channel := substring(coalesce(p_ticket.source_url, '') from '/archives/([CG][A-Z0-9]{8,})/p[0-9]{16}');
  if channel is not null then
    thread := coalesce(
      substring(p_ticket.source_url from 'thread_ts=([0-9]+\.[0-9]+)'),
      regexp_replace(substring(p_ticket.source_url from '/p([0-9]{16})'), '^([0-9]{10})([0-9]{6})$', '\1.\2'));
    insert into public.slack_outbox (kind, ticket_id, channel_id, thread_ts, body, created_by)
    values (p_kind, p_ticket.id, channel, thread, body, auth.uid());
    return;
  end if;
  for target in
    select distinct c.id, private.slack_channel_of(c.slack_channel_link) as channel_id
    from public.ticket_clients tc join public.clients c on c.id = tc.client_id
    where tc.ticket_id = p_ticket.id and not c.archived
  loop
    if target.channel_id is not null then
      insert into public.slack_outbox (kind, client_id, ticket_id, channel_id, body, created_by)
      values (p_kind, target.id, p_ticket.id, target.channel_id, body, auth.uid());
      sent := sent + 1;
    end if;
  end loop;
  if sent = 0 then
    insert into public.slack_outbox (kind, ticket_id, channel_id, body, created_by)
    values (p_kind, p_ticket.id, 'C0C8FC8S10F', body, auth.uid());
  end if;
end;
$$;
revoke all on function private.enqueue_ticket_slack(public.tickets, text, text) from public, anon, authenticated;

-- 3. Triggers that queue messages (only for changes made by a signed-in person) ----------------
create or replace function private.slack_on_ticket_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or new.status is not distinct from old.status then return new; end if;
  perform private.enqueue_ticket_slack(new, 'ticket_status',
    format(':ticket: *%s* is now *%s* · by %s', new.ticket_number, new.status, private.slack_escape(private.slack_actor_name()))
    || E'\n' || private.slack_quote(new.title));
  return new;
end;
$$;
drop trigger if exists slack_on_ticket_status on public.tickets;
create trigger slack_on_ticket_status after update of status on public.tickets
  for each row execute function private.slack_on_ticket_status();

create or replace function private.slack_on_ticket_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ticket public.tickets;
begin
  -- "Updated: status, owner." notes are written by the Tickets page next to a field change;
  -- the status change already has its own message.
  if auth.uid() is null or new.author_id is null or new.body ~ '^Updated: ' then return new; end if;
  select * into ticket from public.tickets where id = new.ticket_id;
  if not found then return new; end if;
  perform private.enqueue_ticket_slack(ticket, 'ticket_update',
    format(':speech_balloon: *%s* update · %s', ticket.ticket_number, private.slack_escape(new.author_name))
    || E'\n' || private.slack_quote(new.body));
  return new;
end;
$$;
drop trigger if exists slack_on_ticket_update on public.ticket_updates;
create trigger slack_on_ticket_update after insert on public.ticket_updates
  for each row execute function private.slack_on_ticket_update();

create or replace function private.slack_on_client_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  channel text := private.slack_channel_of(new.slack_channel_link);
  stage_name text;
  body text;
  kind text;
  who text := private.slack_escape(private.slack_actor_name());
  label text := format('*%s %s*', new.code, private.slack_escape(new.business_name));
begin
  if auth.uid() is null or channel is null or new.archived then return new; end if;
  if new.board_stage is distinct from old.board_stage then
    select coalesce(nullif(name_en, ''), name) into stage_name from public.lifecycle_board_stages where key = new.board_stage;
  end if;
  if new.status is distinct from old.status then
    kind := 'client_status';
    body := format(':arrows_counterclockwise: %s status: %s → *%s* · by %s', label, coalesce(old.status, '—'), new.status, who);
    if stage_name is not null then body := body || format(E'\nBoard: *%s*', private.slack_escape(stage_name)); end if;
    if new.status = 'ADS PAUSED' and btrim(coalesce(new.ads_pause_reason, '')) <> '' then
      body := body || E'\n' || private.slack_quote('Reason: ' || new.ads_pause_reason);
    end if;
  elsif stage_name is not null then
    kind := 'client_stage';
    body := format(':card_index_dividers: %s moved to *%s* · by %s', label, private.slack_escape(stage_name), who);
  else
    return new;
  end if;
  insert into public.slack_outbox (kind, client_id, channel_id, body, created_by)
  values (kind, new.id, channel, body || E'\n<' || private.tp_ops_app_url() || '/clientes/' || new.id || '|Open in TOPS>', auth.uid());
  return new;
end;
$$;
drop trigger if exists slack_on_client_change on public.clients;
create trigger slack_on_client_change after update of status, board_stage on public.clients
  for each row execute function private.slack_on_client_change();

create or replace function private.slack_on_client_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  client public.clients;
  channel text;
  icon text := case new.kind when 'blocked' then ':no_entry: *Blocked*' when 'done' then ':white_check_mark: *Done*' else ':memo: *Update*' end;
begin
  if auth.uid() is null or new.deleted_at is not null or not (new.kind = 'blocked' or new.send_to_slack) then return new; end if;
  select * into client from public.clients where id = new.client_id;
  channel := private.slack_channel_of(client.slack_channel_link);
  if channel is null then return new; end if;
  insert into public.slack_outbox (kind, client_id, comment_id, channel_id, body, created_by)
  values ('client_comment', client.id, new.id, channel,
    format('%s · %s · %s', icon, format('*%s*', client.code), private.slack_escape(private.slack_actor_name()))
      || E'\n' || private.slack_quote(new.body)
      || E'\n<' || private.tp_ops_app_url() || '/clientes/' || client.id || '|Open in TOPS>',
    auth.uid());
  return new;
end;
$$;
drop trigger if exists slack_on_client_comment on public.client_comments;
create trigger slack_on_client_comment after insert on public.client_comments
  for each row execute function private.slack_on_client_comment();

-- Send right away (pg_net runs after commit); the 5-minute job retries anything left.
create or replace function private.slack_outbox_dispatch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.run_tp_ops_function('slack-bridge', '{"task":"outbox"}'::jsonb);
  return null;
end;
$$;
drop trigger if exists slack_outbox_dispatch on public.slack_outbox;
create trigger slack_outbox_dispatch after insert on public.slack_outbox
  for each statement execute function private.slack_outbox_dispatch();

-- Claimed by slack-bridge (service role only). Messages older than 24 h are not sent anymore.
create or replace function public.claim_slack_outbox(p_limit integer default 30)
returns setof public.slack_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.slack_outbox set status = 'expired', error = coalesce(nullif(error, ''), 'No se envió en 24 horas.')
  where status in ('queued', 'sending', 'failed') and created_at <= now() - interval '24 hours';
  return query
  update public.slack_outbox o
  set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
  where o.id in (
    select id from public.slack_outbox
    where (status = 'queued' or (status = 'failed' and attempts < 5) or (status = 'sending' and claimed_at < now() - interval '5 minutes'))
    order by created_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  )
  returning o.*;
end;
$$;
revoke all on function public.claim_slack_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_slack_outbox(integer) to service_role;

-- 4. Dossier suggestions from Slack --------------------------------------------------------------
create table if not exists public.client_dossier_suggestions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id) on delete cascade,
  field text not null check (field in (
    'meta_pixel_id', 'meta_ad_account_id', 'meta_business_portfolio_id', 'landing_page_url', 'website_url',
    'facebook_page_url', 'instagram_url', 'gbp_link', 'drive_folder_link', 'google_docs_url', 'make_scenario_link',
    'retell_agent_id', 'daily_budget', 'targeting_radius_miles', 'ads_targeting_address')),
  suggested_value text not null check (char_length(btrim(suggested_value)) between 1 and 1000),
  current_value text not null default '',
  excerpt text not null default '' check (char_length(excerpt) <= 600),
  slack_user_id text not null default '',
  slack_user_name text not null default '',
  source_url text not null default '',
  message_ts text not null default '',
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, field, suggested_value)
);
create index if not exists client_dossier_suggestions_pending_idx on public.client_dossier_suggestions (client_id) where status = 'pending';

alter table public.client_dossier_suggestions enable row level security;
revoke all on public.client_dossier_suggestions from anon, authenticated;
grant select on public.client_dossier_suggestions to authenticated;
drop policy if exists "Team reads dossier suggestions" on public.client_dossier_suggestions;
create policy "Team reads dossier suggestions" on public.client_dossier_suggestions
  for select to authenticated using ((select private.current_app_role()) is not null);

-- Last Slack message read per client channel (service role only).
create table if not exists public.slack_channel_scan_state (
  channel_id text primary key,
  last_ts text not null,
  last_error text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.slack_channel_scan_state enable row level security;
revoke all on public.slack_channel_scan_state from anon, authenticated;

-- Apply or dismiss a suggestion. Applying writes the dossier field and leaves a note in the bitácora.
create or replace function public.resolve_dossier_suggestion(p_id uuid, p_apply boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.client_dossier_suggestions;
  labels constant jsonb := '{
    "meta_pixel_id": "Meta Pixel ID", "meta_ad_account_id": "Ad account ID", "meta_business_portfolio_id": "Business Portfolio ID",
    "landing_page_url": "Landing page", "website_url": "Website", "facebook_page_url": "Facebook page", "instagram_url": "Instagram",
    "gbp_link": "Google Business Profile", "drive_folder_link": "Drive folder", "google_docs_url": "Google Doc",
    "make_scenario_link": "Make scenario", "retell_agent_id": "Retell agent ID", "daily_budget": "Daily budget",
    "targeting_radius_miles": "Targeting radius (miles)", "ads_targeting_address": "Ads targeting address"}';
begin
  if not (select private.has_permission('clients_edit')) then
    raise exception 'No tienes permiso para editar el dossier.';
  end if;
  select * into s from public.client_dossier_suggestions where id = p_id for update;
  if not found then raise exception 'La sugerencia no existe.'; end if;
  if s.status <> 'pending' then raise exception 'Esta sugerencia ya fue revisada.'; end if;
  if p_apply then
    if s.field = 'daily_budget' then
      update public.clients set daily_budget = s.suggested_value::numeric, updated_at = now() where id = s.client_id;
    elsif s.field = 'targeting_radius_miles' then
      update public.clients set targeting_radius_miles = s.suggested_value::integer, updated_at = now() where id = s.client_id;
    else
      execute format('update public.clients set %I = $1, updated_at = now() where id = $2', s.field) using s.suggested_value, s.client_id;
    end if;
    insert into public.client_comments (client_id, author_id, kind, body)
    values (s.client_id, auth.uid(), 'update',
      format('Dossier actualizado desde Slack: %s = %s', labels ->> s.field, s.suggested_value)
      || case when s.source_url <> '' then E'\n' || s.source_url else '' end);
  end if;
  update public.client_dossier_suggestions
  set status = case when p_apply then 'applied' else 'dismissed' end, decided_by = auth.uid(), decided_at = now()
  where id = p_id;
  return case when p_apply then 'applied' else 'dismissed' end;
end;
$$;
revoke all on function public.resolve_dossier_suggestion(uuid, boolean) from public, anon;
grant execute on function public.resolve_dossier_suggestion(uuid, boolean) to authenticated;

-- 5. Schedules -----------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'slack-ticket-sync-hourly') then
    perform cron.unschedule('slack-ticket-sync-hourly');
  end if;
  if exists (select 1 from cron.job where jobname = 'slack-ticket-sync') then
    perform cron.unschedule('slack-ticket-sync');
  end if;
  perform cron.schedule('slack-ticket-sync', '2,17,32,47 * * * *', 'select private.run_slack_ticket_sync();');

  if exists (select 1 from cron.job where jobname = 'slack-outbox-retry') then
    perform cron.unschedule('slack-outbox-retry');
  end if;
  perform cron.schedule('slack-outbox-retry', '*/5 * * * *', $job$
    select private.run_tp_ops_function('slack-bridge', '{"task":"outbox"}'::jsonb)
    where exists (
      select 1 from public.slack_outbox
      where created_at > now() - interval '24 hours'
        and (status = 'queued' or (status = 'failed' and attempts < 5) or (status = 'sending' and claimed_at < now() - interval '5 minutes'))
    );
  $job$);

  if exists (select 1 from cron.job where jobname = 'slack-dossier-scan') then
    perform cron.unschedule('slack-dossier-scan');
  end if;
  perform cron.schedule('slack-dossier-scan', '37 * * * *', $job$select private.run_tp_ops_function('slack-bridge', '{"task":"scan"}'::jsonb);$job$);
end;
$$;
