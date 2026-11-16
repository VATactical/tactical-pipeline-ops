-- Add the requested onboarding checklist to existing and future clients.
-- Keep task ownership at team-role level so the checklist does not imply every item belongs to Diego.

revoke update on public.notes from authenticated;
grant update (title, body, updated_at, task_id, converted_at, converted_by)
  on public.notes to authenticated;

drop policy if exists "Operations admin updates notes" on public.notes;
drop policy if exists "Operations admin converts notes" on public.notes;
create policy "Operations admins update notes"
  on public.notes for update to authenticated
  using ((select private.has_permission('operations_admin')))
  with check ((select private.has_permission('operations_admin')));

create or replace function public.seed_client_onboarding_checklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.client_workflow_steps
    (client_id, step_key, title, owner_role, owner_name, sort_order)
  values
    (new.id, 'ghl_subaccount', 'Subcuenta GHL', 'onboarding_media', 'Onboarding & Media', 13),
    (new.id, 'buy_phone_number', 'Comprar número', 'automation_funnels', 'Automations & Funnels', 14),
    (new.id, 'leadconnector', 'LeadConnector', 'automation_funnels', 'Automations & Funnels', 15),
    (new.id, 'request_ein', 'Solicitar EIN', 'onboarding_media', 'Onboarding & Media', 16),
    (new.id, 'facebook_portfolio_partner', 'Facebook + socio de portafolio', 'onboarding_media', 'Onboarding & Media', 17),
    (new.id, 'ads_ghl_payment_method', 'Método de pago en Ads y GHL', 'onboarding_media', 'Onboarding & Media', 18),
    (new.id, 'domain_setup', 'Dominio', 'automation_funnels', 'Automations & Funnels', 19),
    (new.id, 'verify_dossier', 'Verificar información del dossier', 'onboarding_media', 'Onboarding & Media', 20),
    (new.id, 'google_business_profile', 'Google Business Profile', 'onboarding_media', 'Onboarding & Media', 21)
  on conflict (client_id, step_key) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_client_onboarding_checklist() from public, anon, authenticated;
drop trigger if exists seed_client_onboarding_checklist on public.clients;
create trigger seed_client_onboarding_checklist
  after insert on public.clients
  for each row execute function public.seed_client_onboarding_checklist();

insert into public.client_workflow_steps
  (client_id, step_key, title, owner_role, owner_name, sort_order)
select c.id, checklist.step_key, checklist.title, checklist.owner_role, checklist.owner_name, checklist.sort_order
from public.clients c
cross join (values
  ('ghl_subaccount', 'Subcuenta GHL', 'onboarding_media', 'Onboarding & Media', 13),
  ('buy_phone_number', 'Comprar número', 'automation_funnels', 'Automations & Funnels', 14),
  ('leadconnector', 'LeadConnector', 'automation_funnels', 'Automations & Funnels', 15),
  ('request_ein', 'Solicitar EIN', 'onboarding_media', 'Onboarding & Media', 16),
  ('facebook_portfolio_partner', 'Facebook + socio de portafolio', 'onboarding_media', 'Onboarding & Media', 17),
  ('ads_ghl_payment_method', 'Método de pago en Ads y GHL', 'onboarding_media', 'Onboarding & Media', 18),
  ('domain_setup', 'Dominio', 'automation_funnels', 'Automations & Funnels', 19),
  ('verify_dossier', 'Verificar información del dossier', 'onboarding_media', 'Onboarding & Media', 20),
  ('google_business_profile', 'Google Business Profile', 'onboarding_media', 'Onboarding & Media', 21)
) as checklist(step_key, title, owner_role, owner_name, sort_order)
where coalesce(c.archived, false) = false
on conflict (client_id, step_key) do nothing;