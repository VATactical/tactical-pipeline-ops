create index if not exists tasks_status_note_updated_by_idx
  on public.tasks(status_note_updated_by)
  where status_note_updated_by is not null;
