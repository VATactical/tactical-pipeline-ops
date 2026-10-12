alter table public.clients
  add column if not exists contact_phone text not null default '',
  add column if not exists gbp_email text not null default '';
