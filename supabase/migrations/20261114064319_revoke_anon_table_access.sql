-- Security audit 2026-11: the anon role (visitors without a session) held full privileges
-- (SELECT, INSERT, UPDATE, DELETE, TRUNCATE...) on several public tables. RLS currently
-- blocks every anon request, but one permissive policy would expose the data. The app only
-- needs anon to read company branding on the login page.

revoke all on table
  public.client_interactions,
  public.client_offer_history,
  public.department_roles,
  public.departments,
  public.eod_daily_status,
  public.eod_report_comments,
  public.eod_report_reviews,
  public.notes,
  public.profile_department_roles
from anon;

-- Keep only read access to branding for the login screen.
revoke all on table public.company_settings from anon;
grant select on table public.company_settings to anon;

-- Stop new tables, sequences and functions created by migrations from being granted to anon
-- automatically. Grant anon access explicitly when a table truly needs it.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
