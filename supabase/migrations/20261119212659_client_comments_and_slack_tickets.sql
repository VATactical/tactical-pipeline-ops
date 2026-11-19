-- 1) Client log ("bitácora"): quick comments on a client, like Trello card comments.
--    kind: update (default), done, blocked. Authors can edit/delete their own; operations admins any.
-- 2) Slack tickets: the TKT-### tickets that Viktor tracks in #blocked-accounts-and-pending-tasks
--    are synced into the Tickets module by the slack-ticket-sync Edge Function (hourly).

create table if not exists public.client_comments (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id) on delete cascade,
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  kind text not null default 'update' check (kind in ('update', 'done', 'blocked')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index if not exists client_comments_client_idx on public.client_comments(client_id, created_at desc) where deleted_at is null;

alter table public.client_comments enable row level security;
revoke all on public.client_comments from anon;
grant select, insert, update on public.client_comments to authenticated;

drop policy if exists "Team reads client comments" on public.client_comments;
create policy "Team reads client comments" on public.client_comments
  for select to authenticated using ((select private.current_app_role()) is not null);

drop policy if exists "Team adds client comments" on public.client_comments;
create policy "Team adds client comments" on public.client_comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select private.current_app_role()) is not null and deleted_at is null);

drop policy if exists "Author or admin edits client comments" on public.client_comments;
create policy "Author or admin edits client comments" on public.client_comments
  for update to authenticated
  using (author_id = (select auth.uid()) or (select private.has_permission('operations_admin')))
  with check (author_id = (select auth.uid()) or (select private.has_permission('operations_admin')));

-- Only body/kind/edited_at/deleted_at may change; author, client and creation time are fixed.
create or replace function private.guard_client_comment_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_id is distinct from old.client_id or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Solo se puede cambiar el texto del comentario.';
  end if;
  if new.body is distinct from old.body or new.kind is distinct from old.kind then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists guard_client_comment_update on public.client_comments;
create trigger guard_client_comment_update before update on public.client_comments
  for each row execute function private.guard_client_comment_update();

-- Slack tickets go into the existing Tickets module (public.tickets, ticket_clients, ticket_updates).
-- source = 'slack' marks tickets that Viktor tracks; slack_* keeps the latest sweep data.
alter table public.tickets
  add column if not exists source text not null default 'tops' check (source in ('tops', 'slack')),
  add column if not exists slack_summary text not null default '',
  add column if not exists slack_owner_id text not null default '',
  add column if not exists slack_owner_name text not null default '',
  add column if not exists source_url text not null default '',
  add column if not exists slack_synced_at timestamptz;

-- Scheduler entry point (same pattern as run_ghl_metrics_sync). Needs the Vault secret
-- slack_ticket_sync_key and its hash in private.integration_webhook_tokens ('slack_ticket_sync').
create or replace function private.run_slack_ticket_sync()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id bigint;
begin
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tp_ops_functions_url') || '/slack-ticket-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-tp-ops-key', (select decrypted_secret from vault.decrypted_secrets where name = 'slack_ticket_sync_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function private.run_slack_ticket_sync() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'slack-ticket-sync-hourly') then
    perform cron.unschedule('slack-ticket-sync-hourly');
  end if;
  perform cron.schedule('slack-ticket-sync-hourly', '17 * * * *', 'select private.run_slack_ticket_sync();');
end;
$$;
