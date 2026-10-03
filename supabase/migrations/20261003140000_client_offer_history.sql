-- Track current offer changes without replacing the current value in clients.offer.
-- Existing values are captured as a baseline; exact historical changes begin when this migration runs.
create table if not exists public.client_offer_history (
  id bigint generated always as identity primary key,
  client_id text not null references public.clients(id) on delete cascade,
  previous_offer text not null default '',
  new_offer text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  source text not null default 'manual'
    check (source in ('manual','integration','baseline'))
);

alter table public.client_offer_history enable row level security;
grant select on public.client_offer_history to authenticated;

create policy "Active team reads client offer history"
on public.client_offer_history for select to authenticated
using ((select private.current_app_role()) is not null);

create index if not exists client_offer_history_client_changed_idx
  on public.client_offer_history (client_id, changed_at desc);

insert into public.client_offer_history (client_id, previous_offer, new_offer, changed_by, changed_at, source)
select c.id, '', c.offer, null, now(), 'baseline'
from public.clients c
where nullif(btrim(coalesce(c.offer, '')), '') is not null
  and not exists (
    select 1 from public.client_offer_history h where h.client_id = c.id
  );

create or replace function private.record_client_offer_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_offer text := '';
  v_source text := 'manual';
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(coalesce(new.offer, '')), '') is null then
      return new;
    end if;
  else
    if new.offer is not distinct from old.offer then
      return new;
    end if;
    v_previous_offer := coalesce(old.offer, '');
  end if;

  if auth.uid() is null then
    v_source := 'integration';
  end if;

  insert into public.client_offer_history (
    client_id, previous_offer, new_offer, changed_by, changed_at, source
  ) values (
    new.id, v_previous_offer, coalesce(new.offer, ''), auth.uid(), now(), v_source
  );

  return new;
end;
$$;

drop trigger if exists clients_offer_history_insert on public.clients;
create trigger clients_offer_history_insert
after insert on public.clients
for each row execute function private.record_client_offer_change();

drop trigger if exists clients_offer_history_update on public.clients;
create trigger clients_offer_history_update
after update of offer on public.clients
for each row
when (old.offer is distinct from new.offer)
execute function private.record_client_offer_change();

revoke all on function private.record_client_offer_change() from public, anon, authenticated;

comment on table public.client_offer_history is
  'Append-only history of offer values. The current value remains on clients.offer and is used in dossier exports.';
comment on column public.client_offer_history.source is
  'baseline records the value captured when history tracking was enabled; integration records service-role updates.';
