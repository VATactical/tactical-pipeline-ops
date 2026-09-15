update public.activity_log
set
  old_values = case
    when coalesce(old_values->>'meta_pixel_id','') ~* 'access[[:space:]]*token|EA[A-Za-z0-9]{20,}'
    then jsonb_set(
      old_values,
      '{meta_pixel_id}',
      to_jsonb(case
        when old_values->>'meta_pixel_id' like '%|%'
        then btrim(regexp_replace(old_values->>'meta_pixel_id', '[[:space:]]*\|[[:space:]]*access[[:space:]]*token.*$', '', 'i'))
        else '[REDACTED: protected credential]'
      end),
      true
    )
    else old_values
  end,
  new_values = case
    when coalesce(new_values->>'meta_pixel_id','') ~* 'access[[:space:]]*token|EA[A-Za-z0-9]{20,}'
    then jsonb_set(
      new_values,
      '{meta_pixel_id}',
      to_jsonb(case
        when new_values->>'meta_pixel_id' like '%|%'
        then btrim(regexp_replace(new_values->>'meta_pixel_id', '[[:space:]]*\|[[:space:]]*access[[:space:]]*token.*$', '', 'i'))
        else '[REDACTED: protected credential]'
      end),
      true
    )
    else new_values
  end
where coalesce(old_values->>'meta_pixel_id','') ~* 'access[[:space:]]*token|EA[A-Za-z0-9]{20,}'
   or coalesce(new_values->>'meta_pixel_id','') ~* 'access[[:space:]]*token|EA[A-Za-z0-9]{20,}';

create or replace function private.reject_public_meta_access_tokens()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if coalesce(new.meta_pixel_id, '') ~* 'access[[:space:]]*token|EA[A-Za-z0-9]{20,}' then
    raise exception 'Store Meta Access Tokens in the protected credential vault, not in Pixel ID';
  end if;
  return new;
end;
$function$;

drop trigger if exists clients_reject_public_meta_access_tokens on public.clients;
create trigger clients_reject_public_meta_access_tokens
before insert or update of meta_pixel_id
on public.clients
for each row execute function private.reject_public_meta_access_tokens();

revoke all on function private.reject_public_meta_access_tokens() from public, anon, authenticated;
