alter table public.profiles
  add column if not exists slack_contact text not null default '' check (char_length(slack_contact) <= 300),
  add column if not exists whatsapp_contact text not null default '' check (char_length(whatsapp_contact) <= 300);

grant update (timezone, slack_contact, whatsapp_contact) on public.profiles to authenticated;

create or replace function public.get_team_directory()
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  timezone text,
  slack_contact text,
  whatsapp_contact text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
  ) then
    return;
  end if;

  return query
    select p.id, p.full_name, p.email, p.role, p.timezone, p.slack_contact, p.whatsapp_contact
    from public.profiles p
    where p.active
    order by p.full_name nulls last;
end;
$$;

revoke all on function public.get_team_directory() from public, anon;
grant execute on function public.get_team_directory() to authenticated;

create table if not exists public.company_settings (
  id smallint primary key default 1 check (id = 1),
  company_name text not null default 'Tactical Pipeline' check (char_length(btrim(company_name)) between 1 and 120),
  system_name text not null default 'TP | Ops' check (char_length(btrim(system_name)) between 1 and 80),
  company_email text not null default 'info@tacticalpipeline.com' check (char_length(company_email) <= 180),
  company_website text not null default '' check (char_length(company_website) <= 300),
  logo_url text not null default '/tp-logo.png' check (char_length(logo_url) <= 1000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.company_settings enable row level security;
revoke all on public.company_settings from anon, authenticated;
grant select on public.company_settings to anon, authenticated;
grant update on public.company_settings to authenticated;

create policy "Public reads company branding" on public.company_settings
  for select to anon, authenticated using (true);
create policy "Superadmin updates company branding" on public.company_settings
  for update to authenticated
  using ((select private.is_superadmin()))
  with check ((select private.is_superadmin()));

insert into public.company_settings (id) values (1) on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Superadmin uploads branding" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'branding' and (select private.is_superadmin()));
create policy "Superadmin updates branding" on storage.objects
  for update to authenticated
  using (bucket_id = 'branding' and (select private.is_superadmin()))
  with check (bucket_id = 'branding' and (select private.is_superadmin()));
create policy "Superadmin deletes branding" on storage.objects
  for delete to authenticated
  using (bucket_id = 'branding' and (select private.is_superadmin()));

grant insert, update, delete on public.training_modules, public.training_items to authenticated;

create policy "Superadmin creates training modules" on public.training_modules
  for insert to authenticated with check ((select private.is_superadmin()));
create policy "Superadmin updates training modules" on public.training_modules
  for update to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));
create policy "Superadmin deletes training modules" on public.training_modules
  for delete to authenticated using ((select private.is_superadmin()));

create policy "Superadmin creates training items" on public.training_items
  for insert to authenticated with check ((select private.is_superadmin()));
create policy "Superadmin updates training items" on public.training_items
  for update to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));
create policy "Superadmin deletes training items" on public.training_items
  for delete to authenticated using ((select private.is_superadmin()));

create index if not exists company_settings_updated_by_idx on public.company_settings (updated_by);
