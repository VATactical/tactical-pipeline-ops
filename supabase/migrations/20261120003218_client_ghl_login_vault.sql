-- GHL / LeadConnector login of each client (email + password) in the credential vault.
-- Kept in private.client_secrets next to the Meta token: never in the dossier, PDF, Google Docs,
-- notes or search. Viewing and saving need Superadmin or the "sensitive credentials" permission,
-- and every view or change is logged in private.client_secret_access_log.

alter table private.client_secrets
  add column if not exists ghl_login_email text not null default '',
  add column if not exists ghl_login_password text not null default '',
  add column if not exists ghl_login_updated_at timestamptz,
  add column if not exists ghl_login_updated_by uuid references public.profiles(id) on delete set null;

alter table private.client_secret_access_log drop constraint if exists client_secret_access_log_action_check;
alter table private.client_secret_access_log add constraint client_secret_access_log_action_check
  check (action in ('revealed', 'updated', 'ghl_login_revealed', 'ghl_login_updated'));

create or replace function private.can_use_sensitive_credentials()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.active and (p.role = 'superadmin' or coalesce((p.permissions ->> 'sensitive_credentials_view')::boolean, false))
    from public.profiles p where p.id = (select auth.uid())
  ), false)
$$;
revoke all on function private.can_use_sensitive_credentials() from public, anon;

-- Whether a login is saved (anyone in the team can see that it exists, not its value).
create or replace function public.client_ghl_login_status(p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if (select private.current_app_role()) is null then raise exception 'Sin acceso.'; end if;
  select jsonb_build_object(
    'saved', btrim(s.ghl_login_email) <> '' or btrim(s.ghl_login_password) <> '',
    'updated_at', s.ghl_login_updated_at,
    'updated_by', (select full_name from public.profiles where id = s.ghl_login_updated_by)
  ) into result
  from private.client_secrets s where s.client_id = p_client_id;
  return coalesce(result, jsonb_build_object('saved', false));
end;
$$;
revoke all on function public.client_ghl_login_status(text) from public, anon;
grant execute on function public.client_ghl_login_status(text) to authenticated;

create or replace function public.reveal_client_ghl_login(p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.can_use_sensitive_credentials() then
    raise exception 'No tienes permiso para ver credenciales sensibles.';
  end if;
  select jsonb_build_object('email', s.ghl_login_email, 'password', s.ghl_login_password) into result
  from private.client_secrets s where s.client_id = p_client_id;
  insert into private.client_secret_access_log (client_id, actor_id, action)
  values (p_client_id, (select auth.uid()), 'ghl_login_revealed');
  return coalesce(result, jsonb_build_object('email', '', 'password', ''));
end;
$$;
revoke all on function public.reveal_client_ghl_login(text) from public, anon;
grant execute on function public.reveal_client_ghl_login(text) to authenticated;

create or replace function public.save_client_ghl_login(p_client_id text, p_email text, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_use_sensitive_credentials() then
    raise exception 'No tienes permiso para guardar credenciales sensibles.';
  end if;
  if nullif(btrim(coalesce(p_email, '')), '') is null then raise exception 'Escribe el correo de acceso.'; end if;
  if nullif(coalesce(p_password, ''), '') is null then raise exception 'Escribe la contraseña.'; end if;
  if char_length(p_email) > 320 or char_length(p_password) > 200 then raise exception 'El correo o la contraseña son demasiado largos.'; end if;
  insert into private.client_secrets (client_id, ghl_login_email, ghl_login_password, ghl_login_updated_at, ghl_login_updated_by)
  values (p_client_id, btrim(p_email), p_password, now(), (select auth.uid()))
  on conflict (client_id) do update
  set ghl_login_email = excluded.ghl_login_email,
      ghl_login_password = excluded.ghl_login_password,
      ghl_login_updated_at = excluded.ghl_login_updated_at,
      ghl_login_updated_by = excluded.ghl_login_updated_by;
  insert into private.client_secret_access_log (client_id, actor_id, action)
  values (p_client_id, (select auth.uid()), 'ghl_login_updated');
end;
$$;
revoke all on function public.save_client_ghl_login(text, text, text) from public, anon;
grant execute on function public.save_client_ghl_login(text, text, text) to authenticated;
