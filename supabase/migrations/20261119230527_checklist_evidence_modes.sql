-- Not every checklist step needs a screenshot. Each step now says what proof it expects:
--   required: a screenshot is the proof (access, payment methods, pixel, domain, launch, first report).
--             The step can still be checked; TP OPS flags it until the screenshot is attached.
--   optional: a screenshot can help but is not expected.
--   none:     internal or conversation steps, or steps whose proof is a link (Drive, Frame.io...).

alter table public.workflow_step_templates
  add column if not exists evidence text not null default 'optional' check (evidence in ('required', 'optional', 'none'));
alter table public.client_workflow_steps
  add column if not exists evidence text not null default 'optional' check (evidence in ('required', 'optional', 'none'));

update public.workflow_step_templates set evidence = case
  when step_key in ('leadconnector_app', 'ghl_payment', 'business_portfolio', 'ad_account', 'meta_payment', 'portfolio_partner',
                    'meta_access', 'gbp_access', 'domain_ready', 'pixel', 'lp_big5_ready', 'launch_ads', 'first_report') then 'required'
  when step_key in ('collect_payment', 'form_to_drive', 'slack_active_hub', 'dossier_created', 'trello_card', 'drive_folder',
                    'ghl_client_login', 'onboarding_call', 'marketing_strategy', 'media_request', 'dossier_updated', 'ad_script',
                    'script_sent', 'edit_ads', 'ads_frameio', 'cruise_control') then 'none'
  else 'optional' end;

-- Copy to every client's checklist without logging it as checklist activity.
alter table public.client_workflow_steps disable trigger audit_client_workflow_changes;
alter table public.client_workflow_steps disable trigger capture_workflow_activity;
update public.client_workflow_steps s set evidence = t.evidence
from public.workflow_step_templates t
where t.step_key = s.step_key and s.evidence is distinct from t.evidence;
alter table public.client_workflow_steps enable trigger audit_client_workflow_changes;
alter table public.client_workflow_steps enable trigger capture_workflow_activity;

-- New clients get the evidence setting with their checklist.
create or replace function public.seed_client_onboarding_checklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.client_workflow_steps
    (client_id, step_key, title, title_en, phase, department_id, owner_role, owner_name, sort_order, evidence)
  select new.id, t.step_key, t.title_es, t.title_en, t.phase, t.department_id, t.owner_role, d.name_es, t.sort_order, t.evidence
  from public.workflow_step_templates t
  join public.departments d on d.id = t.department_id
  on conflict (client_id, step_key) do nothing;
  return new;
end;
$function$;
