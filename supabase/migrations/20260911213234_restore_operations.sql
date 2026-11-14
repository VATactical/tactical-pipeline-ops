-- Restored from production (supabase_migrations.schema_migrations, version 20260911213234).
-- Schema only: the original migration also seeded client, task, blocker and team rows.
-- That seed data contained client contact details and staff emails and is intentionally
-- omitted because this repository is public. Production already contains those rows.

create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

revoke all on function private.current_app_role() from public, anon;
grant execute on function private.current_app_role() to authenticated;

create table public.clients (
  id text primary key,
  code text not null unique,
  business_name text not null,
  legal_name text not null default '',
  owner_name text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  timezone text not null default '',
  services text not null default '',
  offer text not null default '',
  kpi text not null default '',
  daily_budget numeric(10,2) not null default 30 check (daily_budget >= 0),
  minimum_project numeric(12,2) not null default 0 check (minimum_project >= 0),
  markets text not null default '',
  exclusions text not null default '',
  domain text not null default '',
  ghl_status text not null default 'Pendiente',
  meta_status text not null default 'Pendiente',
  a2p_status text not null default 'Pendiente',
  status text not null default 'ONBOARDING' check (status in ('ONBOARDING', 'A2P SUBMITTED', 'ADS LIVE')),
  phase text not null default 'Perfil',
  next_action text not null default 'Completar dossier',
  spend numeric(12,2) not null default 0 check (spend >= 0),
  leads integer not null default 0 check (leads >= 0),
  appointments integer not null default 0 check (appointments >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id text primary key,
  client_id text not null references public.clients(id) on delete cascade,
  phase text not null,
  title text not null,
  status text not null default 'Pendiente' check (status in ('Pendiente', 'En progreso', 'Bloqueada', 'Completada')),
  priority text not null default 'Media' check (priority in ('Urgente', 'Alta', 'Media')),
  owner_name text not null default 'Diego',
  owner_role text check (owner_role in ('onboarding_media', 'automation_funnels', 'superadmin')),
  evidence text not null default '',
  due_label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blockers (
  id text primary key,
  client_id text not null references public.clients(id) on delete cascade,
  title text not null,
  owner_name text not null default 'Cliente',
  promised_date date,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_status_idx on public.clients(status);
create index tasks_client_id_idx on public.tasks(client_id);
create index tasks_owner_role_status_idx on public.tasks(owner_role, status);
create index blockers_client_id_resolved_idx on public.blockers(client_id, resolved);

alter table public.clients enable row level security;
alter table public.tasks enable row level security;
alter table public.blockers enable row level security;

revoke all on public.clients, public.tasks, public.blockers from anon;
revoke all on public.clients, public.tasks, public.blockers from authenticated;
grant select, insert, update on public.clients, public.blockers to authenticated;
grant select, insert, update on public.tasks to authenticated;
grant delete on public.clients, public.tasks, public.blockers to authenticated;

create policy "Authenticated team reads clients" on public.clients for select to authenticated using (true);
create policy "Team updates clients" on public.clients for update to authenticated
using ((select private.current_app_role()) is not null)
with check ((select private.current_app_role()) is not null);
create policy "Superadmin creates clients" on public.clients for insert to authenticated
with check ((select private.is_superadmin()));
create policy "Superadmin deletes clients" on public.clients for delete to authenticated
using ((select private.is_superadmin()));

create policy "Role tasks or superadmin" on public.tasks for select to authenticated
using ((select private.is_superadmin()) or owner_role is null or owner_role = (select private.current_app_role()));
create policy "Role updates own tasks" on public.tasks for update to authenticated
using ((select private.is_superadmin()) or owner_role = (select private.current_app_role()))
with check ((select private.is_superadmin()) or owner_role = (select private.current_app_role()));
create policy "Role creates own tasks" on public.tasks for insert to authenticated
with check ((select private.is_superadmin()) or owner_role = (select private.current_app_role()));
create policy "Superadmin deletes tasks" on public.tasks for delete to authenticated
using ((select private.is_superadmin()));

create policy "Authenticated team reads blockers" on public.blockers for select to authenticated using (true);
create policy "Team creates blockers" on public.blockers for insert to authenticated
with check ((select private.current_app_role()) is not null);
create policy "Team updates blockers" on public.blockers for update to authenticated
using ((select private.current_app_role()) is not null)
with check ((select private.current_app_role()) is not null);
create policy "Superadmin deletes blockers" on public.blockers for delete to authenticated
using ((select private.is_superadmin()));
