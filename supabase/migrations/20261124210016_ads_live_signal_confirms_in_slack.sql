-- "Ads live" / "campaña activa" in a client's Slack channel: TP OPS sets ADS LIVE and replies in that
-- message's thread that the status changed in TP OPS. Written by a team member -> applied right away;
-- written by anyone else (the client) -> alert in TP OPS, and the same reply once someone applies it.

-- Sets ADS LIVE from a signal and confirms in the Slack thread. Returns 'applied' or 'already'.
create or replace function private.apply_live_signal(p_signal_id uuid, p_actor uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.client_status_signals;
  c public.clients;
  channel text;
  who text;
  confirmer text;
begin
  select * into s from public.client_status_signals where id = p_signal_id;
  if not found or s.signal not in ('ads_live', 'payment_fixed') then return 'already'; end if;
  select * into c from public.clients where id = s.client_id for update;
  if not found or c.archived or c.status in ('ADS LIVE', 'CRUISE CONTROL') then return 'already'; end if;

  if p_actor is not null and auth.uid() is null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  end if;
  -- The thread reply below replaces the generic "status changed" post.
  perform set_config('tp_ops.status_from_signal', '1', true);
  update public.clients set status = 'ADS LIVE', ads_launched_on = coalesce(ads_launched_on, current_date), updated_at = now()
  where id = c.id;
  perform set_config('tp_ops.status_from_signal', '', true);

  channel := private.slack_channel_of(c.slack_channel_link);
  if channel is not null then
    who := nullif(btrim(coalesce(s.slack_user_name, '')), '');
    select nullif(btrim(coalesce(full_name, '')), '') into confirmer from public.profiles where id = p_actor;
    insert into public.slack_outbox (kind, client_id, channel_id, thread_ts, body, dedupe_key, created_by)
    values ('client_status', c.id, channel, nullif(s.message_ts, ''),
      format(':white_check_mark: Updated in TP OPS: *%s %s* status %s → *ADS LIVE*', c.code, private.slack_escape(c.business_name), coalesce(c.status, '—'))
        || case when s.signal = 'payment_fixed' then ' (payment fixed)' else '' end
        || case when confirmer is not null and coalesce(private.slack_user_of(p_actor), '') <> coalesce(s.slack_user_id, '')
             then ' · confirmed by ' || private.slack_escape(confirmer) else '' end
        || E'\n<' || private.tp_ops_app_url() || '/clientes/' || c.id || '|Open in TP OPS>',
      'live_signal:' || s.id, p_actor)
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return 'applied';
end;
$$;
revoke all on function private.apply_live_signal(uuid, uuid) from public, anon, authenticated;

-- New "ads live" signal written by a team member: apply it right away.
create or replace function private.client_status_signal_auto_live()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  actor uuid;
begin
  if new.signal <> 'ads_live' or new.status <> 'pending' then return new; end if;
  select p.id into actor from public.profiles p
  where p.active and private.slack_user_of(p.id) = new.slack_user_id limit 1;
  if actor is null then return new; end if;
  begin
    perform private.apply_live_signal(new.id, actor);
    update public.client_status_signals set status = 'applied', decided_by = actor, decided_at = now() where id = new.id;
  exception when others then
    raise warning 'auto live % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists client_status_signals_auto_live on public.client_status_signals;
create trigger client_status_signals_auto_live
after insert on public.client_status_signals
for each row execute function private.client_status_signal_auto_live();

-- The generic status post stays quiet when the change came from a Slack signal (it gets a thread reply instead).
create or replace function private.slack_on_client_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  channel text := private.slack_channel_of(new.slack_channel_link);
  stage_name text;
  body text;
  kind text;
  who text := private.slack_escape(private.slack_actor_name());
  label text := format('*%s %s*', new.code, private.slack_escape(new.business_name));
begin
  if auth.uid() is null or channel is null or new.archived then return new; end if;
  if coalesce(current_setting('tp_ops.status_from_signal', true), '') = '1' then return new; end if;
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
  values (kind, new.id, channel, body || E'\n<' || private.tp_ops_app_url() || '/clientes/' || new.id || '|Open in TP OPS>', auth.uid());
  return new;
end;
$function$;

create or replace function public.resolve_status_signal(p_id uuid, p_apply boolean)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
    if s.signal = 'churned' then
      if c.archived then
        result := 'already';
      elsif not exists (select 1 from public.profiles p where p.id = auth.uid() and p.active
          and (p.role in ('superadmin', 'user_admin') or private.has_permission('operations_admin'))) then
        raise exception 'Solo Superadmin, User Admin u Operations Admin pueden archivar clientes.';
      else
        perform private.archive_client_from_signal(s.id, auth.uid());
        result := 'applied';
      end if;
    elsif s.signal in ('ads_live', 'payment_fixed') then
      result := private.apply_live_signal(s.id, auth.uid());
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
$function$;
