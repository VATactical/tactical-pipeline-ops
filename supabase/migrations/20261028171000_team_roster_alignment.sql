-- Align the active team roster with the latest approved roster table.
-- Preserve previous profile fields and assignments so account changes remain reversible.

CREATE TABLE IF NOT EXISTS private.profile_roster_adjustment_backup (
  profile_id uuid PRIMARY KEY,
  full_name text,
  active boolean NOT NULL,
  permissions jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO private.profile_roster_adjustment_backup (profile_id, full_name, active, permissions)
SELECT id, full_name, active, permissions
FROM public.profiles
WHERE lower(email) IN (
  'nxueta@gmail.com',
  'mhahsan890@gmail.com',
  'hanzala.ghl@gmail.com',
  'jhosepenrique322@gmail.com',
  'olamiposiogunkolade@gmail.com',
  'icawnicmedia@gmail.com'
)
ON CONFLICT (profile_id) DO NOTHING;

UPDATE public.profiles
SET full_name = CASE lower(email)
  WHEN 'nxueta@gmail.com' THEN 'Juan Manzueta'
  WHEN 'mhahsan890@gmail.com' THEN 'Muhammad Ahsan'
  WHEN 'hanzala.ghl@gmail.com' THEN 'Hanzla Amjad'
  WHEN 'jhosepenrique322@gmail.com' THEN 'Jhosep'
  ELSE full_name
END
WHERE lower(email) IN (
  'nxueta@gmail.com',
  'mhahsan890@gmail.com',
  'hanzala.ghl@gmail.com',
  'jhosepenrique322@gmail.com'
);

-- The current roster lists Media Buying as vacant / in trial and no longer lists Daniel.
-- Deactivate these accounts reversibly; preserve role assignments and all work history.
UPDATE public.profiles
SET active = false, permissions = '{}'::jsonb
WHERE lower(email) IN ('icawnicmedia@gmail.com', 'olamiposiogunkolade@gmail.com')
  AND active;

CREATE TABLE IF NOT EXISTS private.department_role_roster_backup (
  department_role_id text PRIMARY KEY,
  title_es text NOT NULL,
  title_en text NOT NULL,
  description_es text NOT NULL,
  description_en text NOT NULL,
  active boolean NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO private.department_role_roster_backup (
  department_role_id, title_es, title_en, description_es, description_en, active
)
SELECT id, title_es, title_en, description_es, description_en, active
FROM public.department_roles
WHERE id IN (
  'ops_lead',
  'onboarding_specialist',
  'funnels_websites_a2p',
  'automation_integrations',
  'google_gbp_specialist',
  'video_editor',
  'media_buyer_meta',
  'a2p_intake'
)
ON CONFLICT (department_role_id) DO NOTHING;

UPDATE public.department_roles
SET title_es = 'Operaciones / CSM / Community Manager',
    title_en = 'Operations / CSM / Community Manager',
    description_es = 'Retención de clientes, llamadas, auditoría diaria de GHL y reportes de Cruise Control.',
    description_en = 'Client retention, calls, daily GHL audits, and Cruise Control reporting.'
WHERE id = 'ops_lead';

UPDATE public.department_roles
SET title_es = 'Onboarding',
    title_en = 'Onboarding'
WHERE id = 'onboarding_specialist';

UPDATE public.department_roles
SET title_es = 'GHL / Funnels',
    title_en = 'GHL / Funnels',
    description_es = 'Configura funnels, landing pages y sitios web.',
    description_en = 'Builds funnels, landing pages, and websites.'
WHERE id = 'funnels_websites_a2p';

UPDATE public.department_roles
SET title_es = 'Automatizaciones / Big 5',
    title_en = 'Automations / Big 5',
    description_es = 'Configura Big 5, Retell AI, Make y CAPI.',
    description_en = 'Configures Big 5, Retell AI, Make, and CAPI.'
WHERE id = 'automation_integrations';

UPDATE public.department_roles
SET title_es = 'Google / GBP',
    title_en = 'Google / GBP'
WHERE id = 'google_gbp_specialist';

UPDATE public.department_roles
SET title_es = 'Video',
    title_en = 'Video'
WHERE id = 'video_editor';

UPDATE public.department_roles
SET title_es = 'Media Buying',
    title_en = 'Media Buying',
    description_es = 'Vacante / en prueba.',
    description_en = 'Vacant / in trial.'
WHERE id = 'media_buyer_meta';

-- A2P intake is no longer a function in the current roster. Keep its row and assignments for history.
UPDATE public.department_roles
SET active = false
WHERE id = 'a2p_intake' AND active;
