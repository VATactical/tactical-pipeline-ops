-- When a ticket was resolved, for the dashboard's tickets-per-week chart.
-- Set automatically when a ticket moves to Resolved/Closed (cleared if it is reopened);
-- the Slack sync passes the date of Viktor's sweep that resolved it.
alter table public.tickets add column if not exists resolved_at timestamptz;

create or replace function private.set_ticket_resolved_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('Resolved', 'Closed') then
    if tg_op = 'INSERT' then
      new.resolved_at := coalesce(new.resolved_at, now());
    elsif old.status not in ('Resolved', 'Closed') and new.resolved_at is not distinct from old.resolved_at then
      new.resolved_at := now();
    end if;
  else
    new.resolved_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists set_ticket_resolved_at on public.tickets;
create trigger set_ticket_resolved_at before insert or update of status, resolved_at on public.tickets
  for each row execute function private.set_ticket_resolved_at();

-- Tickets resolved in TP OPS before this change: use the time of their resolving update.
update public.tickets t set resolved_at = coalesce((
  select max(u.created_at) from public.ticket_updates u where u.ticket_id = t.id and u.status_after in ('Resolved', 'Closed')
), t.updated_at)
where t.status in ('Resolved', 'Closed') and t.resolved_at is null;
