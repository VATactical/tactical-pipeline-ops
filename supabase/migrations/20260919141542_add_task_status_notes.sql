alter table public.tasks
  add column if not exists status_note text not null default '',
  add column if not exists status_note_updated_at timestamptz,
  add column if not exists status_note_updated_by uuid references public.profiles(id) on delete set null;

alter table public.tasks
  drop constraint if exists tasks_status_note_length_check;

alter table public.tasks
  add constraint tasks_status_note_length_check
  check (char_length(status_note) <= 2000);

comment on column public.tasks.status_note is
  'Current operational context explaining why a task remains in progress or blocked.';
