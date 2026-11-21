-- The dossier's "ad account name" is filled from Meta when it is empty (never overwrites a value typed by hand).
create or replace function private.fill_ad_account_name_from_meta()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.account_name, '') = '' then return new; end if;
  update public.clients set ad_account_name = new.account_name, updated_at = now()
  where id = new.client_id and coalesce(ad_account_name, '') = '';
  if found then
    insert into public.client_audit_log (client_id, actor_name, actor_role, action, changed_fields, summary)
    values (new.client_id, 'Meta', 'system', 'dossier_updated', array['ad_account_name'], 'Ad account name filled from Meta: ' || new.account_name);
  end if;
  return new;
end;
$$;
drop trigger if exists client_meta_status_fill_name on public.client_meta_status;
create trigger client_meta_status_fill_name after insert or update of account_name on public.client_meta_status
  for each row execute function private.fill_ad_account_name_from_meta();

-- Backfill from what Meta already returned.
update public.client_meta_status set account_name = account_name where account_name <> '';
