alter table public.clients
  add column if not exists contact_email text not null default '';
