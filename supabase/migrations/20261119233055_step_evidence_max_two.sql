-- At most two screenshots per checklist step.
create or replace function private.limit_step_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('step-evidence:' || new.step_id::text));
  if (select count(*) from public.client_step_evidence where step_id = new.step_id) >= 2 then
    raise exception 'Máximo 2 capturas por paso. Elimina una para subir otra.';
  end if;
  return new;
end;
$$;
drop trigger if exists limit_step_evidence on public.client_step_evidence;
create trigger limit_step_evidence before insert on public.client_step_evidence
  for each row execute function private.limit_step_evidence();
