-- Keep the lifecycle board consistent with the client status:
-- * ADS LIVE / CRUISE CONTROL move the card forward to the column that sets that status (as before).
-- * ADS LIVE or ADS PAUSED on a card sitting in Cruise Control move it back to Lead Tracking,
--   because Cruise Control means status CRUISE CONTROL.
create or replace function private.sync_board_stage_from_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target text;
  v_current_order integer;
  v_current_sets text;
  v_target_order integer;
  v_wanted text;
begin
  if new.status is not distinct from old.status or new.board_stage is distinct from old.board_stage then
    return new;
  end if;
  if new.status not in ('ADS LIVE', 'ADS PAUSED', 'CRUISE CONTROL') then
    return new;
  end if;
  v_wanted := case when new.status = 'ADS PAUSED' then 'ADS LIVE' else new.status end;
  select key, sort_order into v_target, v_target_order
  from public.lifecycle_board_stages
  where sets_status = v_wanted and not archived
  order by sort_order limit 1;
  select sort_order, sets_status into v_current_order, v_current_sets from public.lifecycle_board_stages where key = new.board_stage;
  if v_target is null or new.board_stage = v_target then
    return new;
  end if;
  if (new.status in ('ADS LIVE', 'CRUISE CONTROL') and coalesce(v_current_order, 0) < v_target_order)
     or (new.status in ('ADS LIVE', 'ADS PAUSED') and v_current_sets = 'CRUISE CONTROL') then
    new.board_stage := v_target;
    new.board_stage_changed_at := now();
    new.board_position := coalesce((select max(board_position) from public.clients where board_stage = v_target), 0) + 1;
  end if;
  return new;
end;
$function$;
