-- New GHL onboarding form → announcement in Slack #onboarding.
alter table public.slack_outbox drop constraint if exists slack_outbox_kind_check;
alter table public.slack_outbox add constraint slack_outbox_kind_check check (kind in (
  'ticket_status', 'ticket_update', 'client_status', 'client_stage', 'client_comment',
  'dm_ticket_assigned', 'dm_task_assigned', 'dm_eod_reminder', 'dm_eod_hours', 'dm_notice',
  'onboarding_new'));

-- Rotate the GHL onboarding webhook key. The new key is generated here, only its hash is
-- kept in private.integration_webhook_tokens, and the plain key is stored in Supabase Vault
-- as "ghl_onboarding_webhook_key" so an admin can copy it into the GHL workflow header.
-- The key never appears in this repo or in any log.
do $$
declare
  new_key text := encode(extensions.gen_random_bytes(32), 'hex');
  existing uuid;
begin
  insert into private.integration_webhook_tokens (integration_name, token_sha256, active, created_at, rotated_at)
  values ('ghl_onboarding', encode(extensions.digest(new_key, 'sha256'), 'hex'), true, now(), now())
  on conflict (integration_name) do update
    set token_sha256 = excluded.token_sha256, active = true, rotated_at = now();

  select id into existing from vault.secrets where name = 'ghl_onboarding_webhook_key';
  if existing is null then
    perform vault.create_secret(new_key, 'ghl_onboarding_webhook_key', 'x-tp-ops-key header for the GHL Client Onboarding Form workflow');
  else
    perform vault.update_secret(existing, new_key);
  end if;
end $$;
