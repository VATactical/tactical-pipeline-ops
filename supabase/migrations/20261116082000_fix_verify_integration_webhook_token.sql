-- verify_integration_webhook_token checked current_user / request.jwt.claim.role, which never
-- equal 'service_role' inside a SECURITY DEFINER function under current PostgREST, so it always
-- returned false. Like store_ghl_form_payload and save_ghl_client_secrets, access is enforced by
-- EXECUTE privileges: only service_role (Edge Functions) may call it.
create or replace function public.verify_integration_webhook_token(p_integration_name text, p_token_sha256 text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  return exists (
    select 1
    from private.integration_webhook_tokens
    where integration_name = p_integration_name
      and token_sha256 = p_token_sha256
      and active
  );
end;
$function$;

revoke all on function public.verify_integration_webhook_token(text, text) from public, anon, authenticated;
grant execute on function public.verify_integration_webhook_token(text, text) to service_role;
