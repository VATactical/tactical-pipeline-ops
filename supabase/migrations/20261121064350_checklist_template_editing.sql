-- Checklist template editing (Mi empresa → Checklist). Operations admins only.
-- Template changes apply to new clients; apply_checklist_template_steps() pushes them to active
-- clients on request without touching steps that are already completed.

create or replace function private.require_operations_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('operations_admin') then
    raise exception 'Only operations admins can edit the checklist template' using errcode = '42501';
  end if;
end;
$$;

-- Moves every step at or after p_from one position down (sort_order is unique).
create or replace function private.checklist_template_make_room(p_from integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.workflow_step_templates set sort_order = sort_order + 100000 where sort_order >= p_from;
  update public.workflow_step_templates set sort_order = sort_order - 99999 where sort_order >= 100000;
end;
$$;

create or replace function public.save_checklist_template_step(
  p_step_key text, p_title_es text, p_title_en text, p_phase text, p_department_id text, p_evidence text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  key text := nullif(trim(coalesce(p_step_key, '')), '');
  base text;
  role text;
  phase_rank int;
  target int;
begin
  perform private.require_operations_admin();
  if char_length(trim(coalesce(p_title_es, ''))) < 3 then raise exception 'Write the step in Spanish'; end if;
  if p_phase not in ('prep', 'call', 'build', 'launch', 'post') then raise exception 'Unknown phase'; end if;
  if p_evidence not in ('required', 'optional', 'none') then raise exception 'Unknown evidence mode'; end if;
  select legacy_app_role into role from public.departments where id = p_department_id and active;
  if role is null then raise exception 'Unknown department'; end if;
  if role not in ('onboarding_media', 'automation_funnels', 'user_admin', 'superadmin') then role := 'onboarding_media'; end if;

  if key is not null then
    update public.workflow_step_templates
      set title_es = trim(p_title_es), title_en = coalesce(nullif(trim(p_title_en), ''), trim(p_title_es)),
          phase = p_phase, department_id = p_department_id, owner_role = role, evidence = p_evidence
      where step_key = key;
    if not found then raise exception 'Step not found'; end if;
    return key;
  end if;

  -- New step: a readable unique key, placed at the end of its phase.
  base := left(trim(both '_' from regexp_replace(lower(coalesce(nullif(trim(p_title_en), ''), p_title_es)), '[^a-z0-9]+', '_', 'g')), 40);
  if base = '' then base := 'step'; end if;
  key := base;
  while exists (select 1 from public.workflow_step_templates where step_key = key) loop
    key := base || '_' || substr(md5(random()::text), 1, 4);
  end loop;
  phase_rank := array_position(array['prep', 'call', 'build', 'launch', 'post'], p_phase);
  select coalesce(max(sort_order), 0) + 1 into target from public.workflow_step_templates
    where array_position(array['prep', 'call', 'build', 'launch', 'post'], phase) <= phase_rank;
  perform private.checklist_template_make_room(target);
  insert into public.workflow_step_templates (step_key, sort_order, phase, department_id, owner_role, title_es, title_en, evidence)
  values (key, target, p_phase, p_department_id, role, trim(p_title_es), coalesce(nullif(trim(p_title_en), ''), trim(p_title_es)), p_evidence);
  return key;
end;
$$;

-- Swaps a step with its neighbour (p_direction -1 = up, 1 = down). Returns the keys that moved.
create or replace function public.move_checklist_template_step(p_step_key text, p_direction integer)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  mine int;
  other_key text;
  other int;
begin
  perform private.require_operations_admin();
  select sort_order into mine from public.workflow_step_templates where step_key = p_step_key;
  if mine is null then raise exception 'Step not found'; end if;
  if p_direction < 0 then
    select step_key, sort_order into other_key, other from public.workflow_step_templates where sort_order < mine order by sort_order desc limit 1;
  else
    select step_key, sort_order into other_key, other from public.workflow_step_templates where sort_order > mine order by sort_order limit 1;
  end if;
  if other_key is null then return array[]::text[]; end if;
  update public.workflow_step_templates set sort_order = -1 where step_key = p_step_key;
  update public.workflow_step_templates set sort_order = mine where step_key = other_key;
  update public.workflow_step_templates set sort_order = other where step_key = p_step_key;
  return array[p_step_key, other_key];
end;
$$;

create or replace function public.delete_checklist_template_step(p_step_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_operations_admin();
  delete from public.workflow_step_templates where step_key = p_step_key;
  if not found then raise exception 'Step not found'; end if;
end;
$$;

-- Pushes template steps to every active (not archived) client. Steps that exist in the template are
-- added where missing and refreshed where not completed yet; steps no longer in the template are
-- removed only where not completed (completed ones stay as history).
create or replace function public.apply_checklist_template_steps(p_step_keys text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  added int := 0;
  updated int := 0;
  removed int := 0;
  n int;
begin
  perform private.require_operations_admin();
  insert into public.client_workflow_steps (client_id, step_key, title, title_en, phase, department_id, owner_role, owner_name, sort_order, evidence)
  select c.id, t.step_key, t.title_es, t.title_en, t.phase, t.department_id, t.owner_role, d.name_es, t.sort_order, t.evidence
  from public.workflow_step_templates t
  join public.departments d on d.id = t.department_id
  cross join public.clients c
  where t.step_key = any(p_step_keys) and not c.archived
  on conflict (client_id, step_key) do nothing;
  get diagnostics added = row_count;

  update public.client_workflow_steps s
    set title = t.title_es, title_en = t.title_en, phase = t.phase, department_id = t.department_id,
        owner_role = t.owner_role, owner_name = d.name_es, sort_order = t.sort_order, evidence = t.evidence, updated_at = now()
  from public.workflow_step_templates t
  join public.departments d on d.id = t.department_id
  where s.step_key = t.step_key and t.step_key = any(p_step_keys) and not s.completed
    and s.client_id in (select id from public.clients where not archived)
    and (s.title, s.title_en, s.phase, s.department_id, s.owner_role, s.sort_order, s.evidence)
        is distinct from (t.title_es, t.title_en, t.phase, t.department_id, t.owner_role, t.sort_order, t.evidence);
  get diagnostics n = row_count;
  updated := n;

  delete from public.client_workflow_steps s
  where s.step_key = any(p_step_keys) and not s.completed
    and not exists (select 1 from public.workflow_step_templates t where t.step_key = s.step_key)
    and s.client_id in (select id from public.clients where not archived)
    and not exists (select 1 from public.client_step_evidence e where e.step_id = s.id);
  get diagnostics removed = row_count;

  return jsonb_build_object('added', added, 'updated', updated, 'removed', removed);
end;
$$;

revoke all on function public.save_checklist_template_step(text, text, text, text, text, text) from public, anon;
revoke all on function public.move_checklist_template_step(text, integer) from public, anon;
revoke all on function public.delete_checklist_template_step(text) from public, anon;
revoke all on function public.apply_checklist_template_steps(text[]) from public, anon;
grant execute on function public.save_checklist_template_step(text, text, text, text, text, text) to authenticated;
grant execute on function public.move_checklist_template_step(text, integer) to authenticated;
grant execute on function public.delete_checklist_template_step(text) to authenticated;
grant execute on function public.apply_checklist_template_steps(text[]) to authenticated;
revoke all on function private.require_operations_admin() from public, anon, authenticated;
revoke all on function private.checklist_template_make_room(integer) from public, anon, authenticated;
