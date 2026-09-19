create or replace function public.replace_eod_time_entries(
  p_report_id bigint,
  p_work_date date,
  p_entries jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total numeric;
begin
  if not exists (
    select 1 from public.eod_reports
    where id = p_report_id
      and user_id = (select auth.uid())
      and report_date = p_work_date
  ) then
    raise exception 'EOD report not found or not owned by the current user';
  end if;

  select coalesce(sum((entry->>'hours')::numeric), 0)
  into v_total
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) entry;

  if v_total > 24 then
    raise exception 'Daily hours cannot exceed 24';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) entry
    where coalesce((entry->>'hours')::numeric, 0) <= 0
       or char_length(btrim(coalesce(entry->>'memo', ''))) not between 1 and 500
  ) then
    raise exception 'Each time entry needs valid hours and a memo';
  end if;

  delete from public.time_entries
  where user_id = (select auth.uid()) and work_date = p_work_date;

  insert into public.time_entries(user_id, eod_report_id, work_date, hours, memo)
  select (select auth.uid()), p_report_id, p_work_date,
         (entry->>'hours')::numeric, btrim(entry->>'memo')
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) entry;
end;
$$;

revoke all on function public.replace_eod_time_entries(bigint, date, jsonb) from public, anon;
grant execute on function public.replace_eod_time_entries(bigint, date, jsonb) to authenticated;
