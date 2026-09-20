-- Atomically reserve client codes so simultaneous GHL submissions cannot collide.

create table if not exists private.client_code_counter (
  singleton boolean primary key default true check (singleton),
  last_value bigint not null check (last_value >= 0),
  updated_at timestamptz not null default now()
);

revoke all on private.client_code_counter from public, anon, authenticated;

create or replace function public.reserve_next_client_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_max_existing bigint;
  v_reserved bigint;
begin
  select coalesce(max((substring(code from '^C([0-9]+)$'))::bigint), 0)
  into v_max_existing
  from public.clients
  where code ~ '^C[0-9]+$';

  insert into private.client_code_counter (singleton, last_value, updated_at)
  values (true, v_max_existing + 1, now())
  on conflict (singleton) do update
  set last_value = greatest(private.client_code_counter.last_value, v_max_existing) + 1,
      updated_at = now()
  returning last_value into v_reserved;

  return 'C' || v_reserved::text;
end;
$$;

revoke all on function public.reserve_next_client_code()
  from public, anon, authenticated;
grant execute on function public.reserve_next_client_code()
  to service_role;
