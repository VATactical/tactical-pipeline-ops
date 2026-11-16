-- Dossier aligned with the GHL Client Onboarding Form + Trello "47-Point Client Launch Checklist".
--
-- 1. New form fields: ads targeting address and targeting radius.
-- 2. The onboarding checklist becomes the Trello master checklist (deduplicated), grouped by
--    phase and owned by department, stored as a template so new clients get it automatically.
-- 3. Existing progress is preserved: old checklist steps and the old dossier Yes/No fields are
--    mapped onto the new steps (a step is complete if any old source said so).
-- 4. The checklist becomes the single source of truth: the old Yes/No columns and clients.phase
--    are now derived from it by trigger, so existing readers keep working.
-- 5. Retired free-text status fields (A2P/KYC/GHL/Meta status, project type, website timeline)
--    are kept in a client note so nothing is lost.

-- 0. Backup of everything this migration rewrites (private schema, not exposed to the API).
create table if not exists private.backup_20261116_client_workflow_steps as table public.client_workflow_steps;
create table if not exists private.backup_20261116_client_dossier_fields as
select id, phase, facebook_business_info, meta_assets_info, drive_folder_created, ghl_subaccount_created, ghl_access_confirmed,
       payment_method_confirmed, meta_payment_method_confirmed, facebook_access_confirmed, ad_account_access_confirmed,
       pixel_access_confirmed, domain_access_confirmed, gbp_access_confirmed, funnel_live, meta_campaign_live, onboarding_completed
from public.clients;

-- 1. Form fields -------------------------------------------------------------------------------
alter table public.clients
  add column if not exists ads_targeting_address text not null default '',
  add column if not exists targeting_radius_miles integer;
alter table public.clients drop constraint if exists clients_targeting_radius_miles_check;
alter table public.clients add constraint clients_targeting_radius_miles_check
  check (targeting_radius_miles is null or targeting_radius_miles between 1 and 500);

-- 2. Checklist template ------------------------------------------------------------------------
alter table public.client_workflow_steps
  add column if not exists title_en text not null default '',
  add column if not exists phase text not null default 'prep',
  add column if not exists department_id text references public.departments(id) on delete set null;
create index if not exists client_workflow_steps_department_idx on public.client_workflow_steps (department_id);

create table if not exists public.workflow_step_templates (
  step_key text primary key,
  sort_order integer not null unique,
  phase text not null check (phase in ('prep','call','build','launch','post')),
  department_id text not null references public.departments(id),
  owner_role text not null check (owner_role in ('onboarding_media','automation_funnels','user_admin','superadmin')),
  title_es text not null,
  title_en text not null
);
alter table public.workflow_step_templates enable row level security;
revoke all on public.workflow_step_templates from anon, authenticated;
grant select on public.workflow_step_templates to authenticated;
drop policy if exists "Active team reads checklist template" on public.workflow_step_templates;
create policy "Active team reads checklist template" on public.workflow_step_templates
  for select to authenticated using ((select private.current_app_role()) is not null);

truncate public.workflow_step_templates;
insert into public.workflow_step_templates (sort_order, step_key, phase, department_id, owner_role, title_es, title_en) values
-- Sale and preparation (before the onboarding call)
(1,'collect_payment','prep','direction','superadmin','Cobrar el pago','Collect payment'),
(2,'form_to_drive','prep','onboarding_csm','onboarding_media','Descargar el formulario de onboarding (CSV), guardarlo en Drive, compartirlo en Slack y agregarlo a Trello','Download the onboarding form (CSV), save it to Drive, share it in Slack and add it to Trello'),
(3,'slack_active_hub','prep','operations_csm','user_admin','Actualizar el canal de Slack y moverlo a Active Hubs (automatización)','Update the Slack channel and move it into Active Hubs (automation)'),
(4,'dossier_created','prep','onboarding_csm','onboarding_media','Crear el dossier WWWW en TOPS con la información del formulario','Create the WWWW dossier in TOPS from the onboarding form'),
(5,'trello_card','prep','onboarding_csm','onboarding_media','Crear la tarjeta del cliente en Trello y agregar el WWWW para el equipo','Create the client Trello card and add the WWWW for the team'),
(6,'drive_folder','prep','onboarding_csm','onboarding_media','Crear la carpeta del cliente en Google Drive','Create the client Google Drive folder'),
(7,'ghl_a2p_account','prep','ghl_tech_automation','automation_funnels','Crear la subcuenta de GoHighLevel lista para A2P','Create the A2P-ready GoHighLevel sub-account'),
(8,'ghl_personalized','prep','ghl_tech_automation','automation_funnels','Confirmar que la subcuenta de GHL está personalizada con el dossier (direcciones y logos)','Confirm the GHL sub-account is personalized to the dossier (addresses and logos)'),
(9,'ghl_client_login','prep','onboarding_csm','onboarding_media','Agregar el correo y la contraseña del cliente a su subcuenta de GHL antes de la llamada','Add the client email and password to their GHL sub-account before the onboarding call'),
-- Onboarding call
(10,'onboarding_call','call','onboarding_csm','onboarding_media','Hacer la llamada de onboarding y presentar expectativas','Take the onboarding call and share the onboarding presentation and expectations'),
(11,'marketing_strategy','call','operations_csm','user_admin','Confirmar la estrategia de marketing según el formulario (oferta, ángulos y presupuesto)','Confirm the marketing strategy from the onboarding form (offer, angles and budget)'),
(12,'leadconnector_app','call','onboarding_csm','onboarding_media','Confirmar que el cliente descargó LeadConnector e inició sesión','Confirm the client downloaded LeadConnector and logged in'),
(13,'ghl_payment','call','onboarding_csm','onboarding_media','Confirmar el método de pago en la subcuenta de GHL (en la llamada o por enlace SMS)','Confirm the payment method on the GHL sub-account (on the call or via SMS link)'),
(14,'facebook_2fa','call','onboarding_csm','onboarding_media','Confirmar 2FA en el Facebook del cliente','Confirm 2FA on the client Facebook account'),
(15,'business_portfolio','call','onboarding_csm','onboarding_media','Confirmar que el cliente creó su Business Portfolio','Confirm the client created their Business Portfolio'),
(16,'facebook_page','call','onboarding_csm','onboarding_media','Confirmar que el cliente tiene su página de Facebook','Confirm the client has a Facebook page'),
(17,'ad_account','call','onboarding_csm','onboarding_media','Confirmar que el cliente creó su cuenta publicitaria','Confirm the client created an ad account'),
(18,'meta_payment','call','onboarding_csm','onboarding_media','Agregar el método de pago al Business Portfolio y a la cuenta publicitaria','Add the payment method to the Business Portfolio and the ad account'),
(19,'portfolio_partner','call','onboarding_csm','onboarding_media','Confirmar que el cliente nos invitó como partner a su Business Portfolio','Confirm the client invited us as a partner to their Business Portfolio'),
(20,'meta_access','call','onboarding_csm','onboarding_media','Confirmar acceso a la cuenta publicitaria y a la página de Facebook','Confirm access to the ad account and Facebook page'),
(21,'gbp_access','call','google_gbp','onboarding_media','Confirmar acceso a Google Business Profile (invitación a google@tacticalpipeline.com)','Confirm Google Business Profile access (invite google@tacticalpipeline.com)'),
(22,'media_request','call','onboarding_csm','onboarding_media','Pedir fotos, videos y selfies del cliente (media@tacticalpipeline.com o WhatsApp) para Drive','Request work photos, videos and selfies (media@tacticalpipeline.com or WhatsApp) for Drive'),
(23,'dossier_updated','call','onboarding_csm','onboarding_media','Actualizar el dossier después de la llamada (ofertas, presupuesto, dirección y radio)','Update the dossier after the call (offers, budget, address and radius)'),
-- Build
(24,'domain_ready','build','ghl_tech_automation','automation_funnels','Asegurar el dominio de la landing (acceso al del cliente, comprarlo en GHL o usar mylocalestimate.com con CNAME)','Secure the landing page domain (client domain access, purchase in GHL, or mylocalestimate.com with a CNAME)'),
(25,'pixel','build','media_buying_meta','onboarding_media','Crear el pixel del cliente en nuestro BP y conectarlo a su cuenta publicitaria','Create the client pixel in our BP and connect it to their ad account'),
(26,'ad_script','build','media_buying_meta','onboarding_media','Crear el guion del cliente según su oferta','Create the client script based on their offer'),
(27,'script_sent','build','media_buying_meta','onboarding_media','Enviar el guion al cliente para que grabe sus anuncios','Send the script for the client to record their ads'),
(28,'work_media','build','operations_csm','user_admin','Confirmar fotos y videos del trabajo (mínimo 5 videos o 5–10 fotos de antes y después)','Confirm work media (at least 5 videos or 5–10 before/after images)'),
(29,'selfie_broll','build','video_editing','onboarding_media','Confirmar selfies y B-roll del cliente','Confirm client selfies and B-roll'),
(30,'recorded_ads','build','video_editing','onboarding_media','Confirmar que recibimos los anuncios que grabó el cliente','Confirm we received the ads the client recorded'),
(31,'edit_ads','build','video_editing','onboarding_media','Editar los anuncios','Edit the ads'),
(32,'ads_frameio','build','video_editing','onboarding_media','Confirmar anuncios terminados y subidos a frame.io','Confirm ads are completed and uploaded to frame.io'),
(33,'landing_page','build','ghl_tech_automation','automation_funnels','Construir la landing page','Build the landing page'),
(34,'make_retell','build','ghl_tech_automation','automation_funnels','Crear los escenarios de Make y Retell AI (preparación Big 5)','Create the Make and Retell AI scenarios (Big 5 prep)'),
(35,'big5_pipeline','build','ghl_tech_automation','automation_funnels','Crear el pipeline de seguimiento y las automatizaciones Big 5 personalizadas','Create pipeline tracking and personalized Big 5 automations'),
(36,'lp_big5_ready','build','ghl_tech_automation','automation_funnels','Confirmar que la landing page y el Big 5 están listos','Confirm the landing page and Big 5 are ready'),
-- QA and launch
(37,'quality_check','launch','operations_csm','user_admin','Revisar la calidad de anuncios y landing page y preparar el lanzamiento','Confirm ad and landing page quality and prepare for launch'),
(38,'client_revisions','launch','operations_csm','user_admin','Pedir revisiones al cliente sobre la landing page y los anuncios','Ask the client for revisions to the landing page and ads'),
(39,'launch_training','launch','operations_csm','user_admin','Confirmar que todo está listo y repasar LeadConnector con el cliente (ver, llamar y escribir a sus leads)','Confirm launch readiness and walk the client through LeadConnector (view, call and message leads)'),
(40,'launch_ads','launch','media_buying_meta','onboarding_media','Lanzar los anuncios','Launch ads'),
-- After launch
(41,'first_report','post','media_buying_meta','onboarding_media','Primer reporte de rendimiento y optimización (1 semana después del lanzamiento)','First performance report and optimization (1 week after launch)'),
(42,'gbp_optimize','post','google_gbp','onboarding_media','Optimizar Google Business Profile','Optimize the Google Business Profile'),
(43,'ai_website','post','media_buying_meta','onboarding_media','Optimizar o crear el sitio web del cliente con IA','Optimize or create the client website with AI'),
(44,'cruise_control','post','operations_csm','user_admin','Pasar el cliente a Cruise Control','Move the client to Cruise Control');

-- 3. Rebuild every client's checklist, preserving progress ------------------------------------
alter table public.client_workflow_steps disable trigger audit_client_workflow_changes;
alter table public.client_workflow_steps disable trigger capture_workflow_activity;

create temporary table step_map (old_key text, new_key text);
insert into step_map values
  ('sale_closed','collect_payment'), ('onboarding_call','onboarding_call'), ('assets_ingested','work_media'),
  ('a2p_submitted','ghl_a2p_account'), ('ghl_subaccount','ghl_a2p_account'), ('funnel_live','lp_big5_ready'),
  ('domain_ssl','domain_ready'), ('domain_setup','domain_ready'), ('integrations','make_retell'),
  ('creatives_ready','ads_frameio'), ('client_approval','client_revisions'), ('campaign_launched','launch_ads'),
  ('campaign_launched','pixel'), ('slack_updates','slack_active_hub'), ('daily_audit','first_report'),
  ('leadconnector','leadconnector_app'), ('facebook_portfolio_partner','portfolio_partner'),
  ('ads_ghl_payment_method','ghl_payment'), ('ads_ghl_payment_method','meta_payment'),
  ('verify_dossier','dossier_updated'), ('google_business_profile','gbp_access');

create temporary table step_progress (client_id text, step_key text, completed_at timestamptz, notes text, proof boolean);

-- Completed old steps.
insert into step_progress (client_id, step_key, completed_at, proof)
select o.client_id, m.new_key, o.completed_at, true
from public.client_workflow_steps o join step_map m on m.old_key = o.step_key
where o.completed;

-- Notes on old steps (completed or not) move to the matching new step, or to the first step.
insert into step_progress (client_id, step_key, notes, proof)
select o.client_id, coalesce(m.new_key, 'collect_payment'), 'Nota anterior (' || o.title || '): ' || btrim(o.notes), false
from public.client_workflow_steps o
left join lateral (select new_key from step_map where old_key = o.step_key limit 1) m on true
where coalesce(btrim(o.notes), '') <> '';

-- Old dossier Yes/No fields (and live status) also prove a step was done.
insert into step_progress (client_id, step_key, completed_at, proof)
select c.id, s.step_key, c.updated_at, true
from public.clients c
cross join lateral (values
  ('drive_folder', coalesce(c.drive_folder_created, false)),
  ('ghl_a2p_account', coalesce(c.ghl_subaccount_created, false) or coalesce(c.a2p_submitted, false)),
  ('ghl_payment', coalesce(c.payment_method_confirmed, false)),
  ('meta_payment', coalesce(c.meta_payment_method_confirmed, false)),
  ('meta_access', coalesce(c.facebook_access_confirmed, false) and coalesce(c.ad_account_access_confirmed, false)),
  ('pixel', coalesce(c.pixel_access_confirmed, false)),
  ('domain_ready', coalesce(c.domain_access_confirmed, false)),
  ('gbp_access', coalesce(c.gbp_access_confirmed, false)),
  ('lp_big5_ready', coalesce(c.funnel_live, false)),
  ('onboarding_call', coalesce(c.onboarding_completed, false)),
  ('launch_ads', coalesce(c.meta_campaign_live, false) or c.status in ('ADS LIVE','ADS PAUSED','CRUISE CONTROL')),
  ('cruise_control', c.status = 'CRUISE CONTROL')
) s(step_key, done)
where s.done;

delete from public.client_workflow_steps;

insert into public.client_workflow_steps
  (client_id, step_key, title, title_en, phase, department_id, owner_role, owner_name, sort_order, completed, completed_at, notes)
select c.id, t.step_key, t.title_es, t.title_en, t.phase, t.department_id, t.owner_role, d.name_es, t.sort_order,
       coalesce(p.done, false), case when p.done then coalesce(p.completed_at, now()) end, coalesce(p.notes, '')
from public.clients c
cross join public.workflow_step_templates t
join public.departments d on d.id = t.department_id
left join (
  select client_id, step_key, bool_or(proof) done, min(completed_at) filter (where proof) completed_at,
         string_agg(notes, E'\n') filter (where notes is not null) notes
  from step_progress group by client_id, step_key
) p on p.client_id = c.id and p.step_key = t.step_key;

-- Clients already live necessarily went through every step up to the launch.
update public.client_workflow_steps w
set completed = true, completed_at = coalesce(w.completed_at, now())
from public.clients c
where c.id = w.client_id and c.status in ('ADS LIVE','ADS PAUSED','CRUISE CONTROL')
  and w.sort_order <= (select sort_order from public.workflow_step_templates where step_key = 'launch_ads')
  and not w.completed;

drop table step_map;
drop table step_progress;

alter table public.client_workflow_steps enable trigger audit_client_workflow_changes;
alter table public.client_workflow_steps enable trigger capture_workflow_activity;

-- The original 12-step seeding trigger is replaced by the template-based one below.
drop trigger if exists create_client_workflow_steps on public.clients;
drop function if exists private.create_default_workflow_steps();

-- New clients get the full template.
create or replace function public.seed_client_onboarding_checklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.client_workflow_steps
    (client_id, step_key, title, title_en, phase, department_id, owner_role, owner_name, sort_order)
  select new.id, t.step_key, t.title_es, t.title_en, t.phase, t.department_id, t.owner_role, d.name_es, t.sort_order
  from public.workflow_step_templates t
  join public.departments d on d.id = t.department_id
  on conflict (client_id, step_key) do nothing;
  return new;
end;
$$;

-- 4. The checklist drives the legacy Yes/No columns and the visible phase ----------------------
create or replace function private.sync_client_from_checklist(p_client_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  done text[];
  v_phase text;
begin
  select coalesce(array_agg(step_key) filter (where completed), '{}') into done
  from public.client_workflow_steps where client_id = p_client_id;

  select case w.phase
           when 'prep' then 'Venta y preparación'
           when 'call' then 'Llamada de onboarding'
           when 'build' then 'Montaje'
           when 'launch' then 'QA y lanzamiento'
           else 'Post-lanzamiento' end
  into v_phase
  from public.client_workflow_steps w
  where w.client_id = p_client_id and not w.completed
  order by w.sort_order limit 1;

  update public.clients c set
    phase = coalesce(v_phase, 'Cruise Control'),
    drive_folder_created = 'drive_folder' = any(done),
    ghl_subaccount_created = 'ghl_a2p_account' = any(done),
    ghl_access_confirmed = 'ghl_a2p_account' = any(done),
    payment_method_confirmed = 'ghl_payment' = any(done),
    meta_payment_method_confirmed = 'meta_payment' = any(done),
    facebook_access_confirmed = 'meta_access' = any(done),
    ad_account_access_confirmed = 'meta_access' = any(done),
    pixel_access_confirmed = 'pixel' = any(done),
    domain_access_confirmed = 'domain_ready' = any(done),
    gbp_access_confirmed = 'gbp_access' = any(done),
    funnel_live = 'lp_big5_ready' = any(done),
    meta_campaign_live = 'launch_ads' = any(done),
    onboarding_completed = 'onboarding_call' = any(done)
  where c.id = p_client_id
    and (c.phase, c.drive_folder_created, c.ghl_subaccount_created, c.ghl_access_confirmed, c.payment_method_confirmed,
         c.meta_payment_method_confirmed, c.facebook_access_confirmed, c.ad_account_access_confirmed, c.pixel_access_confirmed,
         c.domain_access_confirmed, c.gbp_access_confirmed, c.funnel_live, c.meta_campaign_live, c.onboarding_completed)
      is distinct from
        (coalesce(v_phase, 'Cruise Control'), 'drive_folder' = any(done), 'ghl_a2p_account' = any(done), 'ghl_a2p_account' = any(done),
         'ghl_payment' = any(done), 'meta_payment' = any(done), 'meta_access' = any(done), 'meta_access' = any(done),
         'pixel' = any(done), 'domain_ready' = any(done), 'gbp_access' = any(done), 'lp_big5_ready' = any(done),
         'launch_ads' = any(done), 'onboarding_call' = any(done));
end;
$$;
revoke all on function private.sync_client_from_checklist(text) from public, anon, authenticated;

create or replace function private.sync_client_from_checklist_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_client_from_checklist(coalesce(new.client_id, old.client_id));
  return null;
end;
$$;
revoke all on function private.sync_client_from_checklist_trigger() from public, anon, authenticated;

drop trigger if exists sync_client_from_checklist on public.client_workflow_steps;
create trigger sync_client_from_checklist
after insert or update of completed or delete on public.client_workflow_steps
for each row execute function private.sync_client_from_checklist_trigger();

-- Columns derived from the checklist are not manual dossier edits; keep them out of the audit log.
create or replace function private.capture_client_audit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor_name text := 'Sistema';
  v_actor_role text := 'system';
  v_fields text[];
begin
  select coalesce(full_name, 'Usuario'), role into v_actor_name, v_actor_role
  from public.profiles where id = (select auth.uid());

  select array_agg(key order by key) into v_fields
  from jsonb_each(to_jsonb(new))
  where key not in ('updated_at', 'phase', 'drive_folder_created', 'ghl_subaccount_created', 'ghl_access_confirmed',
                    'payment_method_confirmed', 'meta_payment_method_confirmed', 'facebook_access_confirmed',
                    'ad_account_access_confirmed', 'pixel_access_confirmed', 'domain_access_confirmed',
                    'gbp_access_confirmed', 'funnel_live', 'meta_campaign_live', 'onboarding_completed')
    and (to_jsonb(old) -> key) is distinct from value;

  if coalesce(array_length(v_fields, 1), 0) > 0 then
    insert into public.client_audit_log
      (client_id, actor_id, actor_name, actor_role, action, changed_fields, summary)
    values
      (new.id, (select auth.uid()), coalesce(v_actor_name, 'Sistema'), coalesce(v_actor_role, 'system'),
       'dossier_updated', v_fields, 'Actualizó el dossier');
  end if;
  return new;
end;
$function$;

alter table public.clients disable trigger audit_client_dossier_changes;
alter table public.clients disable trigger capture_clients_activity;

do $$
declare r record;
begin
  for r in select id from public.clients loop
    perform private.sync_client_from_checklist(r.id);
  end loop;
end $$;

-- 5. Keep retired free-text values as a client note ---------------------------------------
update public.clients
set facebook_business_info = btrim(concat_ws(E'\n', nullif(btrim(facebook_business_info), ''), nullif(btrim(meta_assets_info), ''))),
    meta_assets_info = ''
where coalesce(btrim(meta_assets_info), '') <> '';

insert into public.notes (client_id, title, body, created_by)
select c.id, 'Datos del dossier anterior',
       concat_ws(E'\n',
         case when btrim(coalesce(c.a2p_status, '')) !~* '^(pendiente( confirmar)?|pending|n/?a|none|)$' then 'Estado A2P: ' || c.a2p_status end,
         case when btrim(coalesce(c.kyc_status, '')) !~* '^(pendiente( confirmar)?|pending|n/?a|none|)$' then 'Estado Persona / KYC: ' || c.kyc_status end,
         case when btrim(coalesce(c.ghl_status, '')) !~* '^(pendiente( confirmar)?|pending|n/?a|none|)$' then 'Estado GHL: ' || c.ghl_status end,
         case when btrim(coalesce(c.meta_status, '')) !~* '^(pendiente( confirmar)?|pending|n/?a|none|)$' then 'Estado Meta: ' || c.meta_status end,
         case when btrim(coalesce(c.project_type, '')) !~* '^(pendiente( confirmar)?|pending|n/?a|none|)$' then 'Tipo de proyecto: ' || c.project_type end,
         case when btrim(coalesce(c.website_timeline, '')) !~* '^(pendiente( confirmar)?|pending|n/?a|none|)$' then 'Tiempo estimado del sitio web: ' || c.website_timeline end),
       (select p.id from public.profiles p where p.role = 'superadmin' and p.active order by p.created_at limit 1)
from public.clients c
where exists (
    select 1 from unnest(array[c.a2p_status, c.kyc_status, c.ghl_status, c.meta_status, c.project_type, c.website_timeline]) v
    where btrim(coalesce(v, '')) !~* '^(pendiente( confirmar)?|pending|n/?a|none|)$'
  )
  and (select p.id from public.profiles p where p.role = 'superadmin' and p.active limit 1) is not null;

alter table public.clients enable trigger audit_client_dossier_changes;
alter table public.clients enable trigger capture_clients_activity;
