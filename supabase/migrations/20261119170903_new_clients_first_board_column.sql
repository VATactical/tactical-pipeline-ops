-- New clients (any source: Clients page, GHL onboarding webhook, manual SQL) land automatically in
-- the first open column of the lifecycle board, at the bottom of the list. Only an explicit column
-- (create_board_client from a board column) overrides it.
alter table public.clients alter column board_stage drop default;

create or replace function private.place_new_client_on_board()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.board_stage is null then
    select key into new.board_stage
    from public.lifecycle_board_stages
    where not archived
    order by sort_order, key
    limit 1;
  end if;
  if new.board_position is null or new.board_position = 0 then
    new.board_position := coalesce((select max(board_position) from public.clients where board_stage = new.board_stage), 0) + 1;
  end if;
  new.board_stage_changed_at := coalesce(new.board_stage_changed_at, now());
  return new;
end;
$$;

drop trigger if exists place_new_client_on_board on public.clients;
create trigger place_new_client_on_board
  before insert on public.clients
  for each row execute function private.place_new_client_on_board();
