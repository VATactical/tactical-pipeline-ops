create index if not exists calendar_events_created_by_idx on public.calendar_events (created_by);
create index if not exists client_dossier_events_actor_id_idx on public.client_dossier_events (actor_id);
create index if not exists clients_dossier_copied_by_idx on public.clients (dossier_copied_by);
create index if not exists clients_google_docs_updated_by_idx on public.clients (google_docs_updated_by);
