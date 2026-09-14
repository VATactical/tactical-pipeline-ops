create index if not exists client_ad_status_events_actor_id_idx
  on public.client_ad_status_events (actor_id);

create or replace function private.prepare_client_ads_status_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.status is distinct from old.status and new.status = 'ADS PAUSED' then
    if old.status <> 'ADS LIVE' then
      raise exception 'Only ADS LIVE clients can be paused';
    end if;
    if nullif(btrim(new.ads_pause_reason), '') is null then
      raise exception 'A pause reason is required';
    end if;
    new.ads_pause_reason = btrim(new.ads_pause_reason);
    new.ads_paused_at = now();
    new.ads_paused_by = (select auth.uid());
    new.meta_campaign_live = false;
    new.meta_status = 'Paused';
  elsif new.status is distinct from old.status and old.status = 'ADS PAUSED' then
    if new.status <> 'ADS LIVE' then
      raise exception 'ADS PAUSED clients must be resumed to ADS LIVE before another lifecycle change';
    end if;
    new.meta_campaign_live = true;
    new.meta_status = 'Active';
  end if;
  return new;
end;
$function$;

revoke all on function private.prepare_client_ads_status_change() from public, anon, authenticated;
