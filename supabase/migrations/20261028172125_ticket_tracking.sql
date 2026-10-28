create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  title text not null check (char_length(trim(title)) between 1 and 240),
  description text not null default '',
  status text not null default 'Open'
    check (status in ('Open', 'In progress', 'Waiting', 'Resolved', 'Closed')),
  priority text not null default 'Medium'
    check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  next_follow_up date,
  needs_confirmation boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.ticket_clients (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  client_id text references public.clients(id) on delete set null,
  client_code_snapshot text not null,
  business_name_snapshot text not null,
  created_at timestamptz not null default now(),
  primary key (ticket_id, client_code_snapshot)
);

create table if not exists public.ticket_updates (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null default 'Team member',
  body text not null check (char_length(trim(body)) between 1 and 5000),
  status_after text check (status_after is null or status_after in ('Open', 'In progress', 'Waiting', 'Resolved', 'Closed')),
  created_at timestamptz not null default now()
);

create index if not exists tickets_status_followup_idx
  on public.tickets (status, next_follow_up);
create index if not exists tickets_assigned_updated_idx
  on public.tickets (assigned_to, updated_at desc);
create index if not exists ticket_clients_client_idx
  on public.ticket_clients (client_id);
create index if not exists ticket_updates_ticket_created_idx
  on public.ticket_updates (ticket_id, created_at desc);

alter table public.tickets enable row level security;
alter table public.ticket_clients enable row level security;
alter table public.ticket_updates enable row level security;

revoke all on public.tickets, public.ticket_clients, public.ticket_updates from anon;
grant select, insert, update on public.tickets to authenticated;
grant select, insert, delete on public.ticket_clients to authenticated;
grant select, insert on public.ticket_updates to authenticated;

drop policy if exists "Active team reads tickets" on public.tickets;
create policy "Active team reads tickets" on public.tickets
  for select to authenticated
  using ((select private.current_app_role()) is not null);

drop policy if exists "Active team creates tickets" on public.tickets;
create policy "Active team creates tickets" on public.tickets
  for insert to authenticated
  with check (
    (select private.current_app_role()) is not null
    and created_by = (select auth.uid())
    and (assigned_to is null or (select private.is_active_profile(assigned_to)))
  );

drop policy if exists "Ticket owner or operations admin updates tickets" on public.tickets;
create policy "Ticket owner or operations admin updates tickets" on public.tickets
  for update to authenticated
  using (
    (select private.current_app_role()) is not null
    and (
      created_by = (select auth.uid())
      or assigned_to = (select auth.uid())
      or (select private.has_permission('operations_admin'))
    )
  )
  with check (
    (select private.current_app_role()) is not null
    and updated_by = (select auth.uid())
    and (assigned_to is null or (select private.is_active_profile(assigned_to)))
  );

drop policy if exists "Active team reads ticket clients" on public.ticket_clients;
create policy "Active team reads ticket clients" on public.ticket_clients
  for select to authenticated
  using ((select private.current_app_role()) is not null);

drop policy if exists "Ticket owner links clients" on public.ticket_clients;
create policy "Ticket owner links clients" on public.ticket_clients
  for insert to authenticated
  with check (
    (select private.current_app_role()) is not null
    and client_id is not null
    and exists (select 1 from public.clients c where c.id = client_id)
    and exists (
      select 1 from public.tickets t
      where t.id = ticket_id
        and (
          t.created_by = (select auth.uid())
          or t.assigned_to = (select auth.uid())
          or (select private.has_permission('operations_admin'))
        )
    )
  );

drop policy if exists "Ticket owner unlinks clients" on public.ticket_clients;
create policy "Ticket owner unlinks clients" on public.ticket_clients
  for delete to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_id
        and (
          t.created_by = (select auth.uid())
          or t.assigned_to = (select auth.uid())
          or (select private.has_permission('operations_admin'))
        )
    )
  );

drop policy if exists "Active team reads ticket updates" on public.ticket_updates;
create policy "Active team reads ticket updates" on public.ticket_updates
  for select to authenticated
  using ((select private.current_app_role()) is not null);

drop policy if exists "Active team adds ticket updates" on public.ticket_updates;
create policy "Active team adds ticket updates" on public.ticket_updates
  for insert to authenticated
  with check (
    (select private.current_app_role()) is not null
    and author_id = (select auth.uid())
    and exists (
      select 1 from public.tickets t
      where t.id = ticket_id
        and (
          t.created_by = (select auth.uid())
          or t.assigned_to = (select auth.uid())
          or (select private.has_permission('operations_admin'))
        )
    )
  );

create or replace function public.create_ticket_with_clients(
  p_ticket_number text,
  p_title text,
  p_description text,
  p_status text,
  p_priority text,
  p_assigned_to uuid,
  p_next_follow_up date,
  p_needs_confirmation boolean,
  p_client_ids text[]
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ticket_id uuid;
  v_requested_count integer;
  v_found_count integer;
  v_status text;
  v_author_name text;
begin
  if (select private.current_app_role()) is null then
    raise exception 'Active team profile required';
  end if;

  select count(distinct requested.client_id)
    into v_requested_count
    from unnest(coalesce(p_client_ids, '{}'::text[])) as requested(client_id);

  select count(*)
    into v_found_count
    from public.clients c
    where c.id = any(coalesce(p_client_ids, '{}'::text[]))
      and c.archived is false;

  if v_requested_count < 1 or v_found_count <> v_requested_count then
    raise exception 'Select at least one active client';
  end if;

  insert into public.tickets (
    ticket_number, title, description, status, priority, assigned_to,
    created_by, next_follow_up, needs_confirmation, updated_by
  )
  values (
    trim(p_ticket_number), trim(p_title), coalesce(p_description, ''),
    p_status, p_priority, p_assigned_to, (select auth.uid()),
    p_next_follow_up, coalesce(p_needs_confirmation, false), (select auth.uid())
  )
  returning id, status into v_ticket_id, v_status;

  insert into public.ticket_clients (
    ticket_id, client_id, client_code_snapshot, business_name_snapshot
  )
  select v_ticket_id, c.id, c.code, c.business_name
  from public.clients c
  where c.id = any(coalesce(p_client_ids, '{}'::text[]))
    and c.archived is false
  on conflict (ticket_id, client_code_snapshot) do nothing;

  select coalesce(nullif(trim(p.full_name), ''), 'Team member')
    into v_author_name
    from public.profiles p
    where p.id = (select auth.uid());

  insert into public.ticket_updates (ticket_id, author_id, author_name, body, status_after)
  values (v_ticket_id, (select auth.uid()), coalesce(v_author_name, 'Team member'), 'Ticket created', v_status);

  return v_ticket_id;
end;
$$;

revoke all on function public.create_ticket_with_clients(text, text, text, text, text, uuid, date, boolean, text[]) from public, anon;
grant execute on function public.create_ticket_with_clients(text, text, text, text, text, uuid, date, boolean, text[]) to authenticated;
