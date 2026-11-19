-- Slack messages from the app say "Open in TP OPS" (the app's name), not "Open in TOPS".
do $$
declare
  definition text;
begin
  for definition in
    select pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('enqueue_ticket_slack', 'slack_on_client_change', 'slack_on_client_comment')
  loop
    execute replace(definition, '|Open in TOPS>', '|Open in TP OPS>');
  end loop;
end;
$$;
update public.slack_outbox set body = replace(body, '|Open in TOPS>', '|Open in TP OPS>') where status in ('queued', 'failed');
