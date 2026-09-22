alter table public.clients
  add column if not exists ghl_subaccount_created boolean not null default false,
  add column if not exists drive_folder_created boolean not null default false;

comment on column public.clients.ghl_subaccount_created is 'Whether the client GHL sub-account has been created.';
comment on column public.clients.drive_folder_created is 'Whether the client Google Drive folder has been created.';

update public.clients
set ghl_subaccount_created = true
where nullif(trim(ghl_subaccount_link), '') is not null
  and ghl_subaccount_created = false;

update public.clients
set drive_folder_created = true
where nullif(trim(drive_folder_link), '') is not null
  and drive_folder_created = false;
