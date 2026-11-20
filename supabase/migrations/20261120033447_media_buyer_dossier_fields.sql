-- Campaign fields the media buyer tracks per client (from the Marketing Master Sheet / PMS):
-- ad account name, conversion location, Instant Form name, creatives link, booking calendar and
-- the campaign result. They live in the client dossier, so the buyer view and the dossier share them.
alter table public.clients
  add column if not exists ad_account_name text not null default '',
  add column if not exists conversion_location text not null default '',
  add column if not exists instant_form_name text not null default '',
  add column if not exists ad_creatives_link text not null default '',
  add column if not exists booking_calendar_link text not null default '',
  add column if not exists ad_result_status text not null default '';

alter table public.clients drop constraint if exists clients_conversion_location_check;
alter table public.clients add constraint clients_conversion_location_check
  check (conversion_location in ('', 'Instant Form', 'Landing page'));
alter table public.clients drop constraint if exists clients_ad_result_status_check;
alter table public.clients add constraint clients_ad_result_status_check
  check (ad_result_status in ('', 'Bad', 'Good', 'Excellent'));
