-- Daily automatic GHL sync for every connected client (the manual button stays).
-- Runs at 11:00 UTC = 6:00 AM Eastern in winter (7:00 AM during daylight saving time).
-- The scheduler key is generated inside the database: the raw value lives only in Vault and
-- private.integration_webhook_tokens keeps its SHA-256, which is what the Edge Function checks.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  scheduler_key text;
begin
  if not exists (select 1 from vault.secrets where name = 'ghl_metrics_sync_key') then
    scheduler_key := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(scheduler_key, 'ghl_metrics_sync_key', 'x-tp-ops-key for the ghl-metrics-sync Edge Function (daily cron)');

    insert into private.integration_webhook_tokens (integration_name, token_sha256, active, rotated_at)
    values ('ghl_metrics_sync', encode(extensions.digest(scheduler_key, 'sha256'), 'hex'), true, now())
    on conflict (integration_name) do update
    set token_sha256 = excluded.token_sha256,
        active = true,
        rotated_at = excluded.rotated_at;
  end if;

  if not exists (select 1 from vault.secrets where name = 'tp_ops_functions_url') then
    perform vault.create_secret('https://ouecekxhdzgermqospbj.supabase.co/functions/v1', 'tp_ops_functions_url', 'Base URL of the TP Ops Edge Functions');
  end if;
end;
$$;

-- Called by pg_cron; also handy to trigger a full sync by hand: select private.run_ghl_metrics_sync();
create or replace function private.run_ghl_metrics_sync()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id bigint;
begin
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tp_ops_functions_url') || '/ghl-metrics-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-tp-ops-key', (select decrypted_secret from vault.decrypted_secrets where name = 'ghl_metrics_sync_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function private.run_ghl_metrics_sync() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ghl-metrics-daily-sync') then
    perform cron.unschedule('ghl-metrics-daily-sync');
  end if;
  perform cron.schedule('ghl-metrics-daily-sync', '0 11 * * *', 'select private.run_ghl_metrics_sync();');
end;
$$;
