alter table public.calendar_events
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

create index if not exists calendar_events_assigned_to_start_at_idx
  on public.calendar_events (assigned_to, start_at);

comment on column public.calendar_events.assigned_to is
  'Team member responsible for the event; null means it is shared with the whole team.';
