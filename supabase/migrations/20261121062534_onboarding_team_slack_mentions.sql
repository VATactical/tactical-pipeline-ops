-- Slack mentions for everyone active in the Onboarding department (used by the onboarding-call notice).
create or replace function public.onboarding_team_slack_mentions()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(string_agg(distinct '<@' || private.slack_user_of(p.id) || '>', ' '), '')
  from public.profiles p
  join public.profile_department_roles pdr on pdr.profile_id = p.id
  join public.department_roles dr on dr.id = pdr.department_role_id
  where p.active and p.deleted_at is null and dr.department_id = 'onboarding_csm'
    and private.slack_user_of(p.id) is not null
$$;
revoke all on function public.onboarding_team_slack_mentions() from public, anon, authenticated;
grant execute on function public.onboarding_team_slack_mentions() to service_role;
