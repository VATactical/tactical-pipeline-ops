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
  created_by uuid not null references public.profiles(id) on delete set null,
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
grant select, insert, update, delete on public.tickets, public.ticket_clients to authenticated;
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
    and (
      created_by = (select auth.uid())
      or assigned_to = (select auth.uid())
      or (select private.has_permission('operations_admin'))
    )
    and (assigned_to is null or (select private.is_active_profile(assigned_to)))
    and (updated_by is null or updated_by = (select auth.uid()))
  );

drop policy if exists "Superadmin deletes tickets" on public.tickets;
create policy "Superadmin deletes tickets" on public.tickets
  for delete to authenticated
  using ((select private.is_superadmin()));

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
