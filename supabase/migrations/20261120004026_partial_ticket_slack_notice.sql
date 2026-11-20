-- Partial ticket resolution: Slack notice only in the ticket's thread or the resolved client's channel.
create or replace function public.set_ticket_client_resolved(p_ticket_id uuid, p_client_code text, p_resolved boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.tickets;
  link public.ticket_clients;
  done integer;
  total integer;
  who text := coalesce((select nullif(btrim(regexp_replace(full_name, '\s+', ' ', 'g')), '') from public.profiles where id = auth.uid()), 'Equipo');
  label text;
  body text;
  slack_body text;
  channel text;
begin
  select * into ticket from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'El ticket no existe.'; end if;
  if (select private.current_app_role()) is null
     or not (ticket.created_by = auth.uid() or ticket.assigned_to = auth.uid() or (select private.has_permission('operations_admin'))) then
    raise exception 'Solo el responsable, quien creó el ticket o un administrador de operaciones puede cambiarlo.';
  end if;
  select * into link from public.ticket_clients where ticket_id = p_ticket_id and client_code_snapshot = p_client_code for update;
  if not found then raise exception 'Ese cliente no está en el ticket.'; end if;
  if (link.resolved_at is not null) = p_resolved then
    return jsonb_build_object('status', ticket.status);
  end if;

  update public.ticket_clients
  set resolved_at = case when p_resolved then now() else null end,
      resolved_by = case when p_resolved then auth.uid() else null end
  where ticket_id = p_ticket_id and client_code_snapshot = p_client_code;

  select count(*) filter (where resolved_at is not null), count(*) into done, total
  from public.ticket_clients where ticket_id = p_ticket_id;
  label := link.client_code_snapshot || coalesce(' · ' || nullif(link.business_name_snapshot, ''), '');

  if p_resolved and done = total then
    body := format('Resuelto para %s. Todos los clientes del ticket están resueltos (%s de %s).', label, done, total);
  elsif p_resolved then
    body := format('Resuelto parcialmente: %s resuelto (%s de %s clientes).', label, done, total);
  else
    body := format('Reabierto para %s (%s de %s clientes resueltos).', label, done, total);
  end if;

  -- author_id stays empty so the generic Slack trigger skips it: the notice below goes only to the
  -- ticket's Slack thread or, without one, to the channel of the client that changed.
  insert into public.ticket_updates (ticket_id, author_id, author_name, body, status_after)
  values (p_ticket_id, null, who, body,
    case when p_resolved and done = total then 'Resolved'
         when not p_resolved and ticket.status in ('Resolved', 'Closed') then 'Open'
         else ticket.status end);

  slack_body := format(':%s: *%s* · %s', case when p_resolved then 'white_check_mark' else 'leftwards_arrow_with_hook' end,
      ticket.ticket_number, private.slack_escape(who)) || E'\n' || private.slack_quote(body);
  if substring(coalesce(ticket.source_url, '') from '/archives/([CG][A-Z0-9]{8,})/p[0-9]{16}') is not null then
    perform private.enqueue_ticket_slack(ticket, 'ticket_update', slack_body);
  else
    channel := (select private.slack_channel_of(c.slack_channel_link) from public.clients c where c.id = link.client_id);
    if channel is not null then
      insert into public.slack_outbox (kind, client_id, ticket_id, channel_id, body, created_by)
      values ('ticket_update', link.client_id, p_ticket_id, channel,
        slack_body || E'\n<' || private.tp_ops_app_url() || '/tickets?ticket=' || p_ticket_id || '|Open in TP OPS>', auth.uid());
    end if;
  end if;

  if p_resolved and done = total and ticket.status not in ('Resolved', 'Closed') then
    update public.tickets set status = 'Resolved', updated_at = now(), updated_by = auth.uid() where id = p_ticket_id;
  elsif not p_resolved and ticket.status in ('Resolved', 'Closed') then
    update public.tickets set status = 'Open', updated_at = now(), updated_by = auth.uid() where id = p_ticket_id;
  else
    update public.tickets set updated_at = now(), updated_by = auth.uid() where id = p_ticket_id;
  end if;
  return jsonb_build_object('done', done, 'total', total, 'status', (select status from public.tickets where id = p_ticket_id));
end;
$$;
revoke all on function public.set_ticket_client_resolved(uuid, text, boolean) from public, anon;
grant execute on function public.set_ticket_client_resolved(uuid, text, boolean) to authenticated;
