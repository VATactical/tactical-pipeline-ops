-- "Churned" / "client churned" / "inactive" in a client's Slack channel means the client is no longer active:
-- TP OPS archives it. When the person who wrote it may archive clients (Superadmin, User Admin, Operations Admin)
-- it is archived right away; otherwise the alert waits for someone with that permission.

alter table public.client_status_signals drop constraint client_status_signals_signal_check;
alter table public.client_status_signals add constraint client_status_signals_signal_check
  check (signal = any (array['ads_live', 'ads_paused', 'payment_error', 'payment_fixed', 'problem', 'churned']));

-- Archives the client of a churned signal as the given profile (the archive trigger checks that profile's rights).
create or replace function private.archive_client_from_signal(p_signal_id uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.client_status_signals;
  c public.clients;
  quote text;
  who text;
begin
  select * into s from public.client_status_signals where id = p_signal_id;
  if not found or s.signal <> 'churned' then return false; end if;
  select * into c from public.clients where id = s.client_id for update;
  if not found or c.archived then return false; end if;

  quote := left(regexp_replace(coalesce(s.excerpt, ''), '\s+', ' ', 'g'), 300);
  who := nullif(btrim(coalesce(s.slack_user_name, '')), '');
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  update public.clients
  set archived = true,
      archive_reason = 'Client cancellation',
      archive_note = left('Churned — Slack' || coalesce(' (' || who || ')', '') || ': ' || quote
        || case when coalesce(s.source_url, '') <> '' then E'\n' || s.source_url else '' end, 2000),
      updated_at = now()
  where id = c.id;

  insert into public.slack_outbox (kind, client_id, channel_id, body, dedupe_key, created_by)
  values ('client_status', c.id, 'C0C0RE8LRM1',
    '📦 *' || private.slack_escape(c.code || ' ' || coalesce(c.business_name, '')) || '* archivado en TP OPS como churned'
      || coalesce(' — lo dijo ' || private.slack_escape(who), '') || ' en Slack.'
      || case when coalesce(s.source_url, '') <> '' then E'\n<' || s.source_url || '|Ver mensaje>' else '' end
      || E'\n<' || private.tp_ops_app_url() || '/clientes/' || c.id || '|Abrir en TP OPS> (se puede restaurar desde el dossier)',
    'churn_archive:' || s.id, p_actor)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return true;
end;
$$;
revoke all on function private.archive_client_from_signal(uuid, uuid) from public, anon, authenticated;

-- New churned signal: archive right away when its author may archive clients.
create or replace function private.client_status_signal_auto_churn()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  actor uuid;
begin
  if new.signal <> 'churned' or new.status <> 'pending' then return new; end if;
  select p.id into actor
  from public.profiles p
  where p.active and private.slack_user_of(p.id) = new.slack_user_id
    and (p.role in ('superadmin', 'user_admin') or coalesce((p.permissions ->> 'operations_admin')::boolean, false))
  limit 1;
  if actor is null then return new; end if;
  begin
    if private.archive_client_from_signal(new.id, actor) then
      update public.client_status_signals set status = 'applied', decided_by = actor, decided_at = now() where id = new.id;
    end if;
  exception when others then
    -- Never lose the alert: if archiving fails it stays pending for a person.
    raise warning 'auto churn % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists client_status_signals_auto_churn on public.client_status_signals;
create trigger client_status_signals_auto_churn
after insert on public.client_status_signals
for each row execute function private.client_status_signal_auto_churn();

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
$function$;
