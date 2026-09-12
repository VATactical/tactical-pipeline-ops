create table public.team_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint team_messages_distinct_users check (sender_id <> recipient_id)
);

alter table public.team_messages enable row level security;
revoke all on public.team_messages from anon, authenticated;
grant select, insert on public.team_messages to authenticated;
grant update (read_at) on public.team_messages to authenticated;

create policy "Users read their team messages" on public.team_messages
  for select to authenticated
  using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);

create policy "Users send their own team messages" on public.team_messages
  for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and sender_id <> recipient_id
    and exists (
      select 1 from public.profiles sender
      where sender.id = (select auth.uid()) and sender.active
    )
  );

create policy "Recipients mark messages read" on public.team_messages
  for update to authenticated
  using ((select auth.uid()) = recipient_id)
  with check ((select auth.uid()) = recipient_id and sender_id <> recipient_id);

create index team_messages_recipient_unread_idx
  on public.team_messages (recipient_id, created_at desc)
  where read_at is null;
create index team_messages_sender_created_idx
  on public.team_messages (sender_id, created_at desc);

do $$
begin
  alter publication supabase_realtime add table public.team_messages;
exception when duplicate_object then
  null;
end
$$;
