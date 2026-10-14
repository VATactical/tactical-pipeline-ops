-- Restore the client follow-up and offer history tables used by the dossier.
-- Additive only: existing clients, offers, and related records are preserved.

create table if not exists public.client_interactions (
  id bigint generated always as identity primary key,
  client_id text not null references public.clients(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound','internal')),
  channel text not null check (channel in ('whatsapp','phone','email','sms','ghl','other')),
  summary text not null check (char_length(btrim(summary)) between 1 and 3000),
  responder_id uuid references public.profiles(id) on delete set null,
  next_step text not null default '' check (char_length(next_step) <= 1000),
  next_follow_up_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_interactions enable row level security;
grant select, insert on public.client_interactions to authenticated;

drop policy if exists "Active team reads client interactions" on public.client_interactions;
create policy "Active team reads client interactions"
on public.client_interactions for select to authenticated
using ((select private.current_app_role()) is not null);

drop policy if exists "Client editors create client interactions" on public.client_interactions;
create policy "Client editors create client interactions"
on public.client_interactions for insert to authenticated
with check (
  (select private.has_permission('clients_edit'))
  and created_by = (select auth.uid())
  and (responder_id is null or private.is_active_profile(responder_id))
);

create index if not exists client_interactions_client_created_idx
  on public.client_interactions (client_id, created_at desc);
create index if not exists client_interactions_follow_up_idx
  on public.client_interactions (next_follow_up_at)
  where next_follow_up_at is not null;

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

drop policy if exists "Active team reads client offer history" on public.client_offer_history;
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

comment on table public.client_interactions is 'Client contact log with reply owner and next follow-up.';
comment on table public.client_offer_history is 'Append-only offer history; the current client offer remains on clients.offer.';
