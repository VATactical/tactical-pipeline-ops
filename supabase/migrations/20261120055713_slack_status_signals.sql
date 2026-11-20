-- Status signals read from the clients' Slack channels (slack-bridge task "scan"): campaign launched,
-- paused, payment problem, payment fixed, or a problem / complaint. Each one waits for a person to apply
-- or dismiss it in TP OPS; applying changes the client status (same rules as the dossier) or logs a blocker.

create table if not exists public.client_status_signals (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id) on delete cascade,
  signal text not null check (signal in ('ads_live', 'ads_paused', 'payment_error', 'payment_fixed', 'problem')),
  excerpt text not null default '' check (char_length(excerpt) <= 600),
  slack_user_id text not null default '',
  slack_user_name text not null default '',
  source_url text not null default '',
  message_ts text not null default '',
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, signal, message_ts)
);
create index if not exists client_status_signals_pending_idx on public.client_status_signals (client_id) where status = 'pending';
create index if not exists client_status_signals_decided_by_idx on public.client_status_signals (decided_by);

alter table public.client_status_signals enable row level security;
revoke all on public.client_status_signals from anon, authenticated;
grant select on public.client_status_signals to authenticated;
drop policy if exists "Team reads status signals" on public.client_status_signals;
create policy "Team reads status signals" on public.client_status_signals
  for select to authenticated using ((select private.current_app_role()) is not null);

-- Comments logged from a Slack signal came from Slack: do not post them back to the channel.
create or replace function private.slack_on_client_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  client public.clients;
  channel text;
  icon text := case new.kind when 'blocked' then ':no_entry: *Blocked*' when 'done' then ':white_check_mark: *Done*' else ':memo: *Update*' end;
begin
  if auth.uid() is null or new.deleted_at is not null or not (new.kind = 'blocked' or new.send_to_slack) then return new; end if;
  if coalesce(current_setting('tp_ops.from_slack', true), '') = '1' then return new; end if;
  select * into client from public.clients where id = new.client_id;
  channel := private.slack_channel_of(client.slack_channel_link);
  if channel is null then return new; end if;
  insert into public.slack_outbox (kind, client_id, comment_id, channel_id, body, created_by)
  values ('client_comment', client.id, new.id, channel,
    format('%s · %s · %s', icon, format('*%s*', client.code), private.slack_escape(private.slack_actor_name()))
      || E'\n' || private.slack_quote(new.body)
      || E'\n<' || private.tp_ops_app_url() || '/clientes/' || client.id || '|Open in TP OPS>',
    auth.uid());
  return new;
end;
$$;

create or replace function public.resolve_status_signal(p_id uuid, p_apply boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.client_status_signals;
  c public.clients;
  quote text;
  result text := 'dismissed';
begin
  if not (select private.has_permission('clients_edit')) then
    raise exception 'No tienes permiso para editar clientes.';
  end if;
  select * into s from public.client_status_signals where id = p_id for update;
  if not found then raise exception 'La alerta no existe.'; end if;
  if s.status <> 'pending' then raise exception 'Esta alerta ya fue revisada.'; end if;

  if p_apply then
    select * into c from public.clients where id = s.client_id for update;
    quote := left(regexp_replace(s.excerpt, '\s+', ' ', 'g'), 160);
    if s.signal in ('ads_live', 'payment_fixed') then
      if c.status in ('ADS LIVE', 'CRUISE CONTROL') then
        result := 'already';
      else
        update public.clients set status = 'ADS LIVE', ads_launched_on = coalesce(ads_launched_on, current_date), updated_at = now() where id = c.id;
        result := 'applied';
      end if;
    elsif s.signal in ('ads_paused', 'payment_error') then
      if c.status in ('ADS LIVE', 'CRUISE CONTROL') then
        update public.clients set status = 'ADS PAUSED',
          ads_pause_reason = case when s.signal = 'payment_error' then 'Payment Error: ' else '' end || quote || ' (Slack)',
          updated_at = now() where id = c.id;
        result := 'applied';
      elsif c.status = 'ADS PAUSED' then
        if s.signal = 'payment_error' then
          update public.clients set ads_pause_reason = 'Payment Error: ' || quote || ' (Slack)', updated_at = now() where id = c.id;
        end if;
        result := 'applied';
      else
        raise exception 'El cliente aún no tiene anuncios lanzados (%).', c.status;
      end if;
    else
      perform set_config('tp_ops.from_slack', '1', true);
      insert into public.client_comments (client_id, author_id, kind, body)
      values (s.client_id, auth.uid(), 'blocked',
        'Problema reportado en Slack' || case when s.slack_user_name <> '' then ' por ' || s.slack_user_name else '' end || ': ' || s.excerpt
        || case when s.source_url <> '' then E'\n' || s.source_url else '' end);
      perform set_config('tp_ops.from_slack', '', true);
      result := 'applied';
    end if;
  end if;

  update public.client_status_signals
  set status = case when p_apply then 'applied' else 'dismissed' end, decided_by = auth.uid(), decided_at = now()
  where id = p_id;
  return result;
end;
$$;
revoke all on function public.resolve_status_signal(uuid, boolean) from public, anon;
grant execute on function public.resolve_status_signal(uuid, boolean) to authenticated;

-- Read the client channels every 15 minutes, so a launch or a payment problem shows up quickly.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'slack-dossier-scan') then perform cron.unschedule('slack-dossier-scan'); end if;
  perform cron.schedule('slack-dossier-scan', '7,22,37,52 * * * *', $job$select private.run_tp_ops_function('slack-bridge', '{"task":"scan"}'::jsonb);$job$);
end;
$$;
