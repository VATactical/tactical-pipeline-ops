-- Remove the experimental internal chat and add personal UI preferences.
drop table if exists public.team_messages;

alter table public.profiles
  add column if not exists preferred_language text not null default 'es'
    check (preferred_language in ('es', 'en'));

grant update (avatar_url, preferred_language) on public.profiles to authenticated;

drop function if exists public.get_team_directory();

create function public.get_team_directory()
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  timezone text,
  slack_contact text,
  whatsapp_contact text,
  avatar_url text
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
    select p.id, p.full_name, p.email, p.role, p.timezone,
      p.slack_contact, p.whatsapp_contact, p.avatar_url
    from public.profiles p
    where p.active
    order by p.full_name nulls last;
end;
$$;

revoke all on function public.get_team_directory() from public, anon;
grant execute on function public.get_team_directory() to authenticated;
