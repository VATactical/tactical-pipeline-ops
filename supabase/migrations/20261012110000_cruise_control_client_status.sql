alter table public.clients
  drop constraint if exists clients_status_check;

alter table public.clients
  add constraint clients_status_check
  check (status in ('ONBOARDING', 'A2P SUBMITTED', 'ADS LIVE', 'ADS PAUSED', 'CRUISE CONTROL'));

alter table public.clients
  add column if not exists ads_paused_previous_status text not null default 'ADS LIVE';

alter table public.clients
  drop constraint if exists clients_ads_paused_previous_status_check;

alter table public.clients
  add constraint clients_ads_paused_previous_status_check
  check (ads_paused_previous_status in ('ADS LIVE', 'CRUISE CONTROL'));

create or replace function private.prepare_client_ads_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status = 'CRUISE CONTROL' then
    if old.status <> 'ADS LIVE' then
      raise exception 'Cruise Control can only be set after ADS LIVE';
    end if;
    new.meta_campaign_live = true;
    new.meta_status = 'Active';
  elsif new.status is distinct from old.status and new.status = 'ADS PAUSED' then
    if old.status not in ('ADS LIVE', 'CRUISE CONTROL') then
      raise exception 'Only active campaigns can be paused';
    end if;
    if nullif(btrim(new.ads_pause_reason), '') is null then
      raise exception 'A pause reason is required';
    end if;
    new.ads_pause_reason = btrim(new.ads_pause_reason);
    new.ads_paused_previous_status = old.status;
    new.ads_paused_at = now();
    new.ads_paused_by = (select auth.uid());
    new.meta_campaign_live = false;
    new.meta_status = 'Paused';
  elsif new.status is distinct from old.status and old.status = 'ADS PAUSED' and new.status = 'ADS LIVE' then
    if old.ads_paused_previous_status = 'CRUISE CONTROL' then
      new.status = 'CRUISE CONTROL';
    end if;
    new.meta_campaign_live = true;
    new.meta_status = 'Active';
  end if;
  return new;
end;
$$;

create or replace function private.capture_client_ads_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text := 'Sistema';
  v_actor_role text := 'system';
  v_event_type text;
  v_note text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'ADS PAUSED' then
    v_event_type := 'paused';
    v_note := new.ads_pause_reason;
  elsif old.status = 'ADS PAUSED' and new.status in ('ADS LIVE', 'CRUISE CONTROL') then
    v_event_type := 'resumed';
    v_note := 'Campaña reactivada';
  else
    return new;
  end if;

  select coalesce(full_name, 'Usuario'), role
  into v_actor_name, v_actor_role
  from public.profiles
  where id = (select auth.uid());

  insert into public.client_ad_status_events
    (client_id, actor_id, actor_name, actor_role, event_type, previous_status, new_status, note)
  values
    (new.id, (select auth.uid()), coalesce(v_actor_name, 'Sistema'), coalesce(v_actor_role, 'system'),
     v_event_type, old.status, new.status, v_note);

  return new;
end;
$$;

comment on column public.clients.ads_paused_previous_status is
  'Client status to restore when ADS PAUSED campaigns are reactivated.';
