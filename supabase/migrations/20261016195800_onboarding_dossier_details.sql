alter table public.clients
  add column if not exists onboarding_call_language text not null default '',
  add column if not exists appointment_availability text not null default '',
  add column if not exists website_build_request text not null default '',
  add column if not exists website_timeline text not null default '',
  add column if not exists instagram_needed boolean,
  add column if not exists timezone_verified boolean;
