-- Client lifecycle board (replaces the Trello board "Facebook Onboarding and Launch").
--   * public.lifecycle_board_stages: the columns, editable by operations admins.
--   * clients.board_stage / board_position: where each client card sits.
--   * public.move_client_on_board: drag & drop; a column can advance the client status
--     (Lead Tracking -> ADS LIVE, Cruise Control -> CRUISE CONTROL). Moving back never downgrades.
--   * Changing the status elsewhere (client page) moves the card forward to the matching column.
--   * public.create_board_client: quick "add a card" from a column, with the next client code.

create table if not exists public.lifecycle_board_stages (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  name_en text not null default '' check (char_length(name_en) <= 120),
  owner_hint text not null default '' check (char_length(owner_hint) <= 80),
  sort_order integer not null,
  sets_status text check (sets_status in ('ADS LIVE', 'CRUISE CONTROL')),
  color text not null default 'slate' check (color in ('slate', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.lifecycle_board_stages (key, name, name_en, owner_hint, sort_order, sets_status, color) values
  ('onboarding_access',   'Onboarding y accesos',                     'Client Onboarding & Access',                    'CSM',                          10,  null,             'blue'),
  ('ghl_setup',           'Configuración de GHL y onboarding',        'Setting Up GHL and Onboarding',                 'GHL',                          20,  null,             'blue'),
  ('strategy_call',       'Llamada de estrategia (dossier)',          'Marketing Strategy Call (Dossier Optimization)', 'Media Buying y CSM',           30,  null,             'teal'),
  ('awaiting_content',    'Esperando guion y contenido',              'Awaiting Script and Content',                   'Editor, CSM y Media Buyer',    40,  null,             'amber'),
  ('creative_production', 'Producción de creativos y video',          'Creative & Video Production',                   'Editor',                       50,  null,             'amber'),
  ('landing_page',        'Landing page',                             'Landing Page',                                  'Experto GHL',                  60,  null,             'purple'),
  ('lp_content_check',    'Revisión de landing y contenido',          'Landing Page + Content Check',                  'Media Buyer',                  70,  null,             'purple'),
  ('campaign_blocked',    'Campaña bloqueada (restricciones)',        'Campaign Blocked (Restrictions)',               'Media Buying',                 80,  null,             'red'),
  ('final_review',        'Meta Ads: revisión final antes de lanzar', 'Meta Ads & Campaign Launch (Final Review)',     'Media Buying',                 90,  null,             'orange'),
  ('lead_tracking',       'Seguimiento de leads y rendimiento',       'Lead Tracking & Performance',                   'Media Buying y CSM',          100, 'ADS LIVE',       'green'),
  ('cruise_control',      'Cruise Control',                           'Moved To Cruise Control!',                      'CSM',                         110, 'CRUISE CONTROL', 'teal')
on conflict (key) do nothing;

alter table public.lifecycle_board_stages enable row level security;
revoke all on public.lifecycle_board_stages from anon;
grant select, insert, update on public.lifecycle_board_stages to authenticated;

drop policy if exists "Team reads board stages" on public.lifecycle_board_stages;
create policy "Team reads board stages" on public.lifecycle_board_stages
  for select to authenticated using ((select private.current_app_role()) is not null);
drop policy if exists "Operations admin adds board stages" on public.lifecycle_board_stages;
create policy "Operations admin adds board stages" on public.lifecycle_board_stages
  for insert to authenticated with check ((select private.has_permission('operations_admin')));
drop policy if exists "Operations admin edits board stages" on public.lifecycle_board_stages;
create policy "Operations admin edits board stages" on public.lifecycle_board_stages
  for update to authenticated
  using ((select private.has_permission('operations_admin')))
  with check ((select private.has_permission('operations_admin')));

alter table public.clients
  add column if not exists board_stage text not null default 'onboarding_access'
    references public.lifecycle_board_stages(key) on update cascade,
  add column if not exists board_position double precision not null default 0,
  add column if not exists board_stage_changed_at timestamptz not null default now();
create index if not exists clients_board_stage_idx on public.clients(board_stage, board_position);

-- Placement taken from the Trello board on 2026-11-19. Statuses are left as they are.
update public.clients c
set board_stage = m.stage, board_position = m.pos, board_stage_changed_at = now()
from (values
  ('C16', 'onboarding_access', 1), ('C12', 'awaiting_content', 1), ('C25', 'creative_production', 1),
  ('C18', 'landing_page', 1), ('C21', 'final_review', 1),
  ('C8', 'lead_tracking', 1), ('C17', 'lead_tracking', 2), ('C23', 'lead_tracking', 3),
  ('C3', 'cruise_control', 1), ('C4', 'cruise_control', 2), ('C22', 'cruise_control', 3),
  ('C19', 'cruise_control', 4), ('C10', 'cruise_control', 5)
) as m(code, stage, pos)
where c.code = m.code;

-- Clients not on the Trello board start in the first column, ordered by code.
update public.clients c
set board_position = 100 + coalesce((substring(c.code from '^C([0-9]+)$'))::int, 0)
where c.board_stage = 'onboarding_access'
  and c.code not in ('C16');

-- Board fields are not dossier edits: keep them out of the dossier audit (moves log their own entry).
create or replace function private.capture_client_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
                    'gbp_access_confirmed', 'funnel_live', 'meta_campaign_live', 'onboarding_completed',
                    'board_stage', 'board_position', 'board_stage_changed_at')
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
$$;

-- Status changed elsewhere (client page, pause/resume): move the card forward to the column
-- linked to the new status, never backwards.
create or replace function private.sync_board_stage_from_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target text;
  v_current_order integer;
  v_target_order integer;
begin
  if new.status is not distinct from old.status or new.board_stage is distinct from old.board_stage then
    return new;
  end if;
  if new.status not in ('ADS LIVE', 'CRUISE CONTROL') then
    return new;
  end if;
  select key, sort_order into v_target, v_target_order
  from public.lifecycle_board_stages
  where sets_status = new.status and not archived
  order by sort_order limit 1;
  select sort_order into v_current_order from public.lifecycle_board_stages where key = new.board_stage;
  if v_target is not null and coalesce(v_current_order, 0) < v_target_order then
    new.board_stage := v_target;
    new.board_stage_changed_at := now();
    new.board_position := coalesce((select max(board_position) from public.clients where board_stage = v_target), 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_board_stage_from_status on public.clients;
create trigger sync_board_stage_from_status
  before update of status on public.clients
  for each row execute function private.sync_board_stage_from_status();

-- Drag & drop. p_position is the fractional position computed by the board between its neighbours.
-- A move to another column is logged in the client audit; reordering inside a column is not.
create or replace function public.move_client_on_board(p_client_id text, p_stage text, p_position double precision)
returns public.clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_stage public.lifecycle_board_stages;
  v_old_stage text;
  v_old_status text;
  v_new_status text;
  v_actor_name text;
  v_actor_role text;
begin
  if not private.has_permission('clients_edit') then
    raise exception 'No tienes permiso para mover clientes.' using errcode = '42501';
  end if;
  select * into v_client from public.clients where id = p_client_id for update;
  if not found or v_client.archived then
    raise exception 'Cliente no encontrado o archivado.';
  end if;
  select * into v_stage from public.lifecycle_board_stages where key = p_stage and not archived;
  if not found then
    raise exception 'Esa columna no existe.';
  end if;

  v_old_stage := v_client.board_stage;
  v_old_status := v_client.status;
  v_new_status := v_client.status;
  if v_stage.sets_status = 'ADS LIVE' and v_old_status in ('ONBOARDING', 'A2P SUBMITTED') then
    v_new_status := 'ADS LIVE';
  elsif v_stage.sets_status = 'CRUISE CONTROL' then
    if v_old_status in ('ONBOARDING', 'A2P SUBMITTED') then
      raise exception 'Para pasar a Cruise Control el cliente debe tener los ADS activos (ADS LIVE). Muévelo primero a «%».',
        coalesce((select name from public.lifecycle_board_stages where sets_status = 'ADS LIVE' and not archived order by sort_order limit 1), 'ADS LIVE');
    elsif v_old_status = 'ADS LIVE' then
      v_new_status := 'CRUISE CONTROL';
    end if;
  end if;

  update public.clients
  set board_stage = v_stage.key,
      board_position = coalesce(p_position, 0),
      board_stage_changed_at = case when v_old_stage is distinct from v_stage.key then now() else board_stage_changed_at end,
      status = v_new_status,
      ads_launched_on = case when v_new_status = 'ADS LIVE' and v_old_status <> 'ADS LIVE'
                             then coalesce(ads_launched_on, current_date) else ads_launched_on end,
      updated_at = now()
  where id = p_client_id
  returning * into v_client;

  if v_old_stage is distinct from v_stage.key then
    select coalesce(full_name, 'Usuario'), role into v_actor_name, v_actor_role
    from public.profiles where id = (select auth.uid());
    insert into public.client_audit_log (client_id, actor_id, actor_name, actor_role, action, changed_fields, summary)
    values (p_client_id, (select auth.uid()), coalesce(v_actor_name, 'Sistema'), coalesce(v_actor_role, 'system'), 'board_moved',
            case when v_new_status is distinct from v_old_status then array['board_stage', 'status'] else array['board_stage'] end,
            'Movió la tarjeta a «' || v_stage.name || '»'
              || case when v_new_status is distinct from v_old_status then ' (estado: ' || v_new_status || ')' else '' end);
  end if;
  return v_client;
end;
$$;
revoke all on function public.move_client_on_board(text, text, double precision) from public, anon;
grant execute on function public.move_client_on_board(text, text, double precision) to authenticated;

-- "Add a card" from a column: reserves the next client code (or uses the one given) and creates
-- the client in that column. The onboarding checklist is seeded by the existing insert trigger.
create or replace function public.create_board_client(p_business_name text, p_stage text, p_code text default null)
returns public.clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(nullif(btrim(coalesce(p_code, '')), ''));
  v_name text := btrim(coalesce(p_business_name, ''));
  v_stage public.lifecycle_board_stages;
  v_client public.clients;
begin
  if not private.has_permission('clients_create') then
    raise exception 'No tienes permiso para crear clientes.' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    raise exception 'Escribe el nombre del negocio.';
  end if;
  select * into v_stage from public.lifecycle_board_stages where key = p_stage and not archived;
  if not found then
    raise exception 'Esa columna no existe.';
  end if;
  if v_stage.sets_status is not null then
    raise exception 'Los clientes nuevos se crean en una columna de onboarding, antes del lanzamiento.';
  end if;
  if v_code is null then
    v_code := public.reserve_next_client_code();
  elsif v_code !~ '^[A-Z0-9-]{1,20}$' then
    raise exception 'Código inválido.';
  elsif exists (select 1 from public.clients where upper(code) = v_code) then
    raise exception 'Ese código ya está asignado a otro cliente.' using errcode = '23505';
  end if;

  insert into public.clients (id, code, business_name, legal_name, status, assigned_role, intake_source,
                              board_stage, board_position, board_stage_changed_at)
  values (gen_random_uuid()::text, v_code, v_name, v_name, 'ONBOARDING', 'onboarding_media', 'manual',
          v_stage.key, coalesce((select max(board_position) from public.clients where board_stage = v_stage.key), 0) + 1, now())
  returning * into v_client;
  return v_client;
end;
$$;
revoke all on function public.create_board_client(text, text, text) from public, anon;
grant execute on function public.create_board_client(text, text, text) to authenticated;
