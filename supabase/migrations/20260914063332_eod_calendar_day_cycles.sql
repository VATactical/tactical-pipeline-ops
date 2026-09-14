alter table public.eod_reports drop constraint if exists eod_reports_period_check;

update public.eod_reports as report
set period_start = report.report_date::timestamp at time zone coalesce(profile.timezone, 'America/Managua'),
    period_end = ((report.report_date + 1)::timestamp at time zone coalesce(profile.timezone, 'America/Managua')) - interval '1 millisecond'
from public.profiles as profile
where profile.id = report.user_id;

alter table public.eod_reports
  alter column period_start drop default,
  alter column period_end drop default;

alter table public.eod_reports add constraint eod_reports_period_check
  check (
    period_end > period_start
    and period_end - period_start between interval '22 hours 55 minutes' and interval '25 hours 5 minutes'
  );

comment on column public.eod_reports.period_start is 'Inclusive start (00:00) of the report date in the user timezone.';
comment on column public.eod_reports.period_end is 'Inclusive end (23:59:59.999) of the report date in the user timezone.';
