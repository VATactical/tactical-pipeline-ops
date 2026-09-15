create table if not exists public.eod_daily_status (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  work_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'working_late', 'submitted')),
  current_task text not null default ''
    check (char_length(current_task) <= 500),
  expected_report_time time,
  slack_notice text not null default ''
    check (char_length(slack_notice) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date)
);

create index if not exists eod_daily_status_work_date_status_idx
  on public.eod_daily_status(work_date, status);
create index if not exists eod_daily_status_user_id_idx
  on public.eod_daily_status(user_id);

alter table public.eod_daily_status enable row level security;
grant select, insert, update on public.eod_daily_status to authenticated;
grant usage, select on sequence public.eod_daily_status_id_seq to authenticated;

drop policy if exists "Users and operations admins read EOD daily status" on public.eod_daily_status;
create policy "Users and operations admins read EOD daily status"
on public.eod_daily_status for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_permission('operations_admin'))
);

drop policy if exists "Users create own EOD daily status" on public.eod_daily_status;
create policy "Users create own EOD daily status"
on public.eod_daily_status for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.has_permission('eod_reports'))
);

drop policy if exists "Users update own EOD daily status" on public.eod_daily_status;
create policy "Users update own EOD daily status"
on public.eod_daily_status for update to authenticated
using (
  user_id = (select auth.uid())
  and (select private.has_permission('eod_reports'))
)
with check (
  user_id = (select auth.uid())
  and (select private.has_permission('eod_reports'))
);

comment on table public.eod_daily_status is
  'Daily EOD compliance status. work_date and the 20:00 cutoff use the superadmin (Kevin) timezone.';
