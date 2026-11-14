-- Normalize team access around departments and department roles.
-- Existing profile.role and profile.permissions remain as compatibility caches for current RLS policies.
-- Rollback snapshot permits restoring pre-migration access assignments and account states.

-- New Auth identities have no access until the admin assigns a department role.
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, permissions, active)
  VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    'onboarding_media',
    '{}'::jsonb,
    false
  );
  RETURN NEW;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.departments (
  id text PRIMARY KEY,
  name_es text NOT NULL,
  name_en text NOT NULL,
  legacy_app_role text NOT NULL CHECK (legacy_app_role IN ('superadmin', 'user_admin', 'onboarding_media', 'automation_funnels')),
  permissions jsonb NOT NULL CHECK (jsonb_typeof(permissions) = 'object'),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.department_roles (
  id text PRIMARY KEY,
  department_id text NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  title_es text NOT NULL,
  title_en text NOT NULL,
  description_es text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (department_id, title_en)
);

CREATE TABLE IF NOT EXISTS public.profile_department_roles (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_role_id text NOT NULL REFERENCES public.department_roles(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, department_role_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS profile_department_roles_one_primary
  ON public.profile_department_roles(profile_id) WHERE is_primary;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_department_roles ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.departments, public.department_roles, public.profile_department_roles TO authenticated;

CREATE POLICY "Active team reads departments"
  ON public.departments FOR SELECT TO authenticated
  USING ((SELECT private.current_app_role()) IS NOT NULL);

CREATE POLICY "Active team reads department roles"
  ON public.department_roles FOR SELECT TO authenticated
  USING ((SELECT private.current_app_role()) IS NOT NULL);

CREATE POLICY "Users read their own team assignments; superadmins read all"
  ON public.profile_department_roles FOR SELECT TO authenticated
  USING ((profile_id = (SELECT auth.uid()) AND (SELECT private.current_app_role()) IS NOT NULL) OR (SELECT private.is_superadmin()));

-- Disabled profiles lose application access even if an old access token still exists.
DROP POLICY "Users read own profile; superadmins read all" ON public.profiles;
CREATE POLICY "Users read own active profile; superadmins read all"
  ON public.profiles FOR SELECT TO authenticated
  USING ((id = (SELECT auth.uid()) AND active) OR (SELECT private.is_superadmin()));

DROP POLICY "Users update their own profile" ON public.profiles;
CREATE POLICY "Active users update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) AND (SELECT private.current_app_role()) IS NOT NULL)
  WITH CHECK (id = (SELECT auth.uid()) AND (SELECT private.current_app_role()) IS NOT NULL);

DROP POLICY "Team records own dossier events" ON public.client_dossier_events;
CREATE POLICY "Active team records own dossier events"
  ON public.client_dossier_events FOR INSERT TO authenticated
  WITH CHECK (actor_id = (SELECT auth.uid()) AND (SELECT private.current_app_role()) IS NOT NULL);

DROP POLICY "Users read own note receipts" ON public.note_reads;
CREATE POLICY "Active users read own note receipts"
  ON public.note_reads FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.current_app_role()) IS NOT NULL);

DROP POLICY "Users refresh own note receipts" ON public.note_reads;
CREATE POLICY "Active users refresh own note receipts"
  ON public.note_reads FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.current_app_role()) IS NOT NULL)
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.current_app_role()) IS NOT NULL);

CREATE TABLE IF NOT EXISTS private.profile_team_access_backup (
  profile_id uuid PRIMARY KEY,
  legacy_role text NOT NULL,
  legacy_permissions jsonb NOT NULL,
  was_active boolean NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO private.profile_team_access_backup (profile_id, legacy_role, legacy_permissions, was_active)
SELECT id, role, permissions, active FROM public.profiles
ON CONFLICT (profile_id) DO NOTHING;

INSERT INTO public.departments (id, name_es, name_en, legacy_app_role, permissions, sort_order)
VALUES
  ('direction', 'Dirección', 'Direction', 'superadmin',
    '{"clients_create":true,"clients_edit":true,"clients_delete_archived":true,"tasks_create":true,"calendar_manage":false,"eod_reports":true,"users_manage":true,"sensitive_credentials_view":true,"operations_admin":true}'::jsonb, 1),
  ('operations_csm', 'Operaciones / CSM', 'Operations / CSM', 'user_admin',
    '{"clients_create":true,"clients_edit":true,"clients_delete_archived":false,"tasks_create":true,"calendar_manage":false,"eod_reports":true,"users_manage":false,"sensitive_credentials_view":false,"operations_admin":true}'::jsonb, 2),
  ('onboarding_csm', 'Onboarding (CSM)', 'Onboarding (CSM)', 'onboarding_media',
    '{"clients_create":true,"clients_edit":true,"clients_delete_archived":true,"tasks_create":true,"calendar_manage":false,"eod_reports":true,"users_manage":false,"sensitive_credentials_view":false,"operations_admin":true}'::jsonb, 3),
  ('ghl_tech_automation', 'GHL / Tecnología y Automatizaciones', 'GHL / Tech & Automations', 'automation_funnels',
    '{"clients_create":false,"clients_edit":true,"clients_delete_archived":false,"tasks_create":true,"calendar_manage":false,"eod_reports":true,"users_manage":false,"sensitive_credentials_view":false,"operations_admin":false}'::jsonb, 4),
  ('media_buying_meta', 'Media Buying (Meta)', 'Media Buying (Meta)', 'onboarding_media',
    '{"clients_create":false,"clients_edit":true,"clients_delete_archived":false,"tasks_create":true,"calendar_manage":false,"eod_reports":true,"users_manage":false,"sensitive_credentials_view":false,"operations_admin":false}'::jsonb, 5),
  ('google_gbp', 'Google / GBP', 'Google / GBP', 'onboarding_media',
    '{"clients_create":false,"clients_edit":true,"clients_delete_archived":false,"tasks_create":true,"calendar_manage":false,"eod_reports":true,"users_manage":false,"sensitive_credentials_view":false,"operations_admin":false}'::jsonb, 6),
  ('video_editing', 'Edición de video', 'Video Editing', 'onboarding_media',
    '{"clients_create":false,"clients_edit":false,"tasks_create":false,"calendar_manage":false,"eod_reports":true,"users_manage":false,"sensitive_credentials_view":false,"operations_admin":false}'::jsonb, 7)
ON CONFLICT (id) DO UPDATE SET
  name_es = EXCLUDED.name_es,
  name_en = EXCLUDED.name_en,
  legacy_app_role = EXCLUDED.legacy_app_role,
  permissions = EXCLUDED.permissions,
  sort_order = EXCLUDED.sort_order,
  active = true;

DROP POLICY "Onboarding deletes archived clients" ON public.clients;
CREATE POLICY "Onboarding deletes archived clients"
  ON public.clients FOR DELETE TO authenticated
  USING (archived IS TRUE AND (SELECT private.has_permission('clients_delete_archived')));

INSERT INTO public.department_roles (id, department_id, title_es, title_en, description_es, description_en, sort_order)
VALUES
  ('direction_owner', 'direction', 'Dueño / Dirección', 'Owner / Direction', 'Ventas, cierre de clientes, estándares de anuncios y superadministración de TP Ops.', 'Sales, client closing, ad standards, and TP Ops superadmin.', 1),
  ('ops_lead', 'operations_csm', 'Líder de operaciones', 'Operations Lead', 'Retención, llamadas, auditoría diaria de GHL y reportes de Cruise Control.', 'Client retention, calls, daily GHL audits, and Cruise Control reporting.', 1),
  ('onboarding_specialist', 'onboarding_csm', 'Especialista de onboarding', 'Onboarding Specialist', 'Verifica accesos y assets, mantiene Trello y entrega clientes a Operaciones.', 'Verifies access and assets, maintains Trello, and hands clients to Operations.', 1),
  ('funnels_websites_a2p', 'ghl_tech_automation', 'Funnels, sitios web y A2P', 'Funnels, Websites & A2P', 'Configura funnels, landing pages, websites y A2P.', 'Builds funnels, landing pages, websites, and A2P.', 1),
  ('automation_integrations', 'ghl_tech_automation', 'Automatización e integraciones', 'Automation & Integrations', 'Configura Big 5, Retell AI, Make y CAPI.', 'Configures Big 5, Retell AI, Make, and CAPI.', 2),
  ('a2p_intake', 'ghl_tech_automation', 'Recepción de A2P', 'A2P Intake', 'Recibe y procesa los casos de A2P.', 'Receives and processes A2P cases.', 3),
  ('media_buyer_meta', 'media_buying_meta', 'Media Buyer', 'Media Buyer', 'Lanza y optimiza campañas, prepara scripts y reporta rendimiento.', 'Launches and optimizes campaigns, prepares scripts, and reports performance.', 1),
  ('google_gbp_specialist', 'google_gbp', 'Especialista Google / GBP', 'Google / GBP Specialist', 'Configura y verifica GBP, revisa Google Ads y landing pages.', 'Configures and verifies GBP, reviews Google Ads, and landing pages.', 1),
  ('video_editor', 'video_editing', 'Editor de video', 'Video Editor', 'Edita videos, hooks y cortes verticales para clientes.', 'Edits client videos, hooks, and vertical cuts.', 1)
ON CONFLICT (id) DO UPDATE SET
  department_id = EXCLUDED.department_id,
  title_es = EXCLUDED.title_es,
  title_en = EXCLUDED.title_en,
  description_es = EXCLUDED.description_es,
  description_en = EXCLUDED.description_en,
  sort_order = EXCLUDED.sort_order,
  active = true;

CREATE OR REPLACE FUNCTION private.sync_profile_department_permissions(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role text;
  v_permissions jsonb;
BEGIN
  SELECT CASE
    WHEN bool_or(d.legacy_app_role = 'superadmin') THEN 'superadmin'
    WHEN bool_or(d.legacy_app_role = 'automation_funnels') THEN 'automation_funnels'
    WHEN bool_or(d.legacy_app_role = 'user_admin') THEN 'user_admin'
    ELSE 'onboarding_media'
  END
  INTO v_role
  FROM public.profile_department_roles pdr
  JOIN public.department_roles dr ON dr.id = pdr.department_role_id
  JOIN public.departments d ON d.id = dr.department_id
  WHERE pdr.profile_id = p_profile_id;

  SELECT coalesce(jsonb_object_agg(permission_name, granted), '{}'::jsonb)
  INTO v_permissions
  FROM (
    SELECT permission.key AS permission_name, bool_or(permission.value::boolean) AS granted
    FROM public.profile_department_roles pdr
    JOIN public.department_roles dr ON dr.id = pdr.department_role_id
    JOIN public.departments d ON d.id = dr.department_id
    CROSS JOIN LATERAL jsonb_each_text(d.permissions) AS permission(key, value)
    WHERE pdr.profile_id = p_profile_id
    GROUP BY permission.key
  ) AS permission_union;

  UPDATE public.profiles
     SET role = coalesce(v_role, 'onboarding_media'),
         permissions = coalesce(v_permissions, '{}'::jsonb)
   WHERE id = p_profile_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.sync_profile_department_permissions_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.sync_profile_department_permissions(OLD.profile_id);
    RETURN OLD;
  END IF;

  PERFORM private.sync_profile_department_permissions(NEW.profile_id);
  IF TG_OP = 'UPDATE' AND OLD.profile_id IS DISTINCT FROM NEW.profile_id THEN
    PERFORM private.sync_profile_department_permissions(OLD.profile_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER sync_department_permissions_after_assignment
AFTER INSERT OR UPDATE OR DELETE ON public.profile_department_roles
FOR EACH ROW EXECUTE FUNCTION private.sync_profile_department_permissions_trigger();

CREATE OR REPLACE FUNCTION private.prevent_self_profile_access_edits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND (
       NEW.role IS DISTINCT FROM OLD.role
       OR NEW.permissions IS DISTINCT FROM OLD.permissions
       OR NEW.active IS DISTINCT FROM OLD.active
       OR NEW.email IS DISTINCT FROM OLD.email
     ) THEN
    RAISE EXCEPTION 'Team access must be changed from Users and Permissions';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER prevent_self_profile_access_edits
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.prevent_self_profile_access_edits();

CREATE OR REPLACE FUNCTION public.admin_set_profile_department_roles(p_profile_id uuid, p_role_ids text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role_count integer;
BEGIN
  IF p_profile_id IS NULL OR p_role_ids IS NULL OR cardinality(p_role_ids) = 0 THEN
    RAISE EXCEPTION 'A user and at least one department role are required';
  END IF;

  SELECT count(*) INTO v_role_count
  FROM public.department_roles
  WHERE id = ANY(p_role_ids) AND active;

  IF v_role_count <> cardinality(p_role_ids) THEN
    RAISE EXCEPTION 'One or more department roles are invalid';
  END IF;

  DELETE FROM public.profile_department_roles WHERE profile_id = p_profile_id;

  INSERT INTO public.profile_department_roles (profile_id, department_role_id, is_primary)
  SELECT p_profile_id, role_id, ordinal = 1
  FROM unnest(p_role_ids) WITH ORDINALITY AS selected(role_id, ordinal);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_profile_department_roles(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_department_roles(uuid, text[]) TO service_role;

INSERT INTO public.profile_department_roles (profile_id, department_role_id, is_primary)
SELECT p.id, assignment.role_id, assignment.is_primary
FROM (
  SELECT lower(trim(full_name)) AS person, 'direction_owner' AS role_id, true AS is_primary FROM public.profiles WHERE lower(trim(full_name)) = 'kevin' AND active
  UNION ALL SELECT lower(trim(full_name)), 'ops_lead', true FROM public.profiles WHERE lower(trim(full_name)) = 'juan' AND active
  UNION ALL SELECT lower(trim(full_name)), 'video_editor', false FROM public.profiles WHERE lower(trim(full_name)) = 'juan' AND active
  UNION ALL SELECT lower(trim(full_name)), 'onboarding_specialist', true FROM public.profiles WHERE lower(trim(full_name)) = 'diego' AND active
  UNION ALL SELECT lower(trim(full_name)), 'funnels_websites_a2p', true FROM public.profiles WHERE lower(trim(full_name)) = 'muhammad' AND active
  UNION ALL SELECT lower(trim(full_name)), 'automation_integrations', true FROM public.profiles WHERE lower(trim(full_name)) = 'hanzala.ghl' AND active
  UNION ALL SELECT lower(trim(full_name)), 'a2p_intake', true FROM public.profiles WHERE lower(trim(full_name)) = 'daniel' AND active
  UNION ALL SELECT lower(trim(full_name)), 'media_buyer_meta', true FROM public.profiles WHERE lower(trim(full_name)) = 'sardul' AND active
  UNION ALL SELECT lower(trim(full_name)), 'google_gbp_specialist', true FROM public.profiles WHERE lower(trim(full_name)) = 'gaurav' AND active
  UNION ALL SELECT lower(trim(full_name)), 'video_editor', true FROM public.profiles WHERE lower(trim(full_name)) = 'joseph' AND active
) AS assignment(person, role_id, is_primary)
JOIN public.profiles p ON lower(trim(p.full_name)) = assignment.person
ON CONFLICT (profile_id, department_role_id) DO UPDATE SET is_primary = EXCLUDED.is_primary;

UPDATE public.profiles
SET active = false, permissions = '{}'::jsonb
WHERE lower(trim(full_name)) = 'rida'
   OR regexp_replace(lower(full_name), '\s+', '', 'g') = 'muhammad(mb)';

DO $function$
DECLARE
  profile_row record;
BEGIN
  FOR profile_row IN SELECT id FROM public.profiles LOOP
    PERFORM private.sync_profile_department_permissions(profile_row.id);
  END LOOP;

  IF (SELECT count(DISTINCT profile_id) FROM public.profile_department_roles) < 9 THEN
    RAISE EXCEPTION 'Expected at least nine active roster assignments; review the account-to-roster mapping';
  END IF;
END;
$function$;

GRANT SELECT ON public.departments, public.department_roles, public.profile_department_roles TO authenticated;
