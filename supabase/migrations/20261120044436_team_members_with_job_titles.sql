-- Team members with each person's job (department role) so "Mi equipo" shows the real position,
-- not the technical access role. Same people as before (active profiles).
create or replace function public.get_team_members()
returns table (
  id uuid, full_name text, email text, role text, timezone text, slack_contact text, whatsapp_contact text, avatar_url text,
  job_title_es text, job_title_en text, department_es text, department_en text, department_sort integer, job_description_es text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.active) then
    return;
  end if;

  return query
    select p.id, p.full_name, p.email, p.role, p.timezone, p.slack_contact, p.whatsapp_contact, p.avatar_url,
      job.title_es, job.title_en, job.name_es, job.name_en, job.sort_order, job.description_es
    from public.profiles p
    left join lateral (
      select dr.title_es, dr.title_en, d.name_es, d.name_en, d.sort_order, dr.description_es
      from public.profile_department_roles pdr
      join public.department_roles dr on dr.id = pdr.department_role_id
      join public.departments d on d.id = dr.department_id
      where pdr.profile_id = p.id
      order by pdr.is_primary desc, d.sort_order, dr.sort_order
      limit 1
    ) job on true
    where p.active
    order by p.full_name nulls last;
end;
$$;

revoke all on function public.get_team_members() from public, anon;
grant execute on function public.get_team_members() to authenticated, service_role;
