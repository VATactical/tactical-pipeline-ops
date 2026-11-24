-- The "Updated in TP OPS" confirmation goes to the channel itself (not as a thread reply) and names the message.
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
  -- This confirmation replaces the generic "status changed" post.
  perform set_config('tp_ops.status_from_signal', '1', true);
  update public.clients set status = 'ADS LIVE', ads_launched_on = coalesce(ads_launched_on, current_date), updated_at = now()
  where id = c.id;
  perform set_config('tp_ops.status_from_signal', '', true);

  channel := private.slack_channel_of(c.slack_channel_link);
  if channel is not null then
    who := nullif(btrim(coalesce(s.slack_user_name, '')), '');
    select nullif(btrim(coalesce(full_name, '')), '') into confirmer from public.profiles where id = p_actor;
    insert into public.slack_outbox (kind, client_id, channel_id, body, dedupe_key, created_by)
    values ('client_status', c.id, channel,
      format(':white_check_mark: Updated in TP OPS: *%s %s* status %s → *ADS LIVE*', c.code, private.slack_escape(c.business_name), coalesce(c.status, '—'))
        || case when s.signal = 'payment_fixed' then ' (payment fixed)' else '' end
        || case when who is not null then ' · from ' || case when coalesce(s.source_url, '') <> ''
             then '<' || s.source_url || '|' || private.slack_escape(who) || '''s message>' else private.slack_escape(who) || '''s message' end else '' end
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

